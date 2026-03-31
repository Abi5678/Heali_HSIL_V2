"""Heali FastAPI Application.

WebSocket server for bidirectional voice/video streaming with Gemini Live API
via Google ADK. Based on the ADK bidi-demo reference pattern.

Four-phase lifecycle:
1. Application Init: Agent, SessionService, Runner
2. Session Init: LiveRequestQueue, RunConfig
3. Bidi-Streaming: Upstream (client -> Gemini) + Downstream (Gemini -> client)
4. Termination: Graceful cleanup
"""

import asyncio
import base64
import json
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

# Load .env BEFORE any agent imports so constants.py picks up env vars
load_dotenv()

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.genai import types

from agents.agent import root_agent
from agents.shared.constants import APP_NAME, RED_LINE_KEYWORDS, NEGATION_PREFIXES
from agents.shared.firestore_service import FirestoreService

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# #region agent log
def _dbg_log(location: str, message: str, data: dict):
    import time
    payload = {"sessionId": "5959a7", "location": location, "message": message, "data": data, "timestamp": int(time.time() * 1000)}
    logger.info("[DEBUG-5959a7] %s: %s %s", location, message, data)
    try:
        path = Path(__file__).resolve().parent.parent / ".cursor" / "debug-5959a7.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception as e:
        logger.warning("[DEBUG-5959a7] Failed to write log file: %s", e)
# #endregion

# ---------------------------------------------------------------------------
# Auth — Firebase Admin SDK OR local JWT depending on USE_LOCAL_AUTH
# ---------------------------------------------------------------------------

USE_LOCAL_AUTH = os.getenv("USE_LOCAL_AUTH", "false").lower() == "true"

if not USE_LOCAL_AUTH:
    import firebase_admin
    from firebase_admin import credentials as fb_credentials
    from firebase_admin import auth as fb_auth
    from firebase_admin import messaging

    if not firebase_admin._apps:
        _cred_path = os.getenv(
            "GOOGLE_APPLICATION_CREDENTIALS", "credentials/firebase-admin-sdk.json"
        )
        try:
            firebase_admin.initialize_app(fb_credentials.Certificate(_cred_path))
            logger.info("Firebase Admin SDK initialized")
        except Exception as e:
            logger.warning(
                "Firebase Admin SDK failed to initialize: %s. Authentication features will be limited.", e
            )
else:
    logger.info("Local auth mode enabled — Firebase Admin SDK skipped")


def _verify_token(token: str) -> dict:
    """Verify token (local JWT or Firebase ID token) and return claims dict."""
    if USE_LOCAL_AUTH:
        from app.auth_local import verify_local_token
        return verify_local_token(token)
    return fb_auth.verify_id_token(token)


# ---------------------------------------------------------------------------
# Phase 1: Application Initialization
# ---------------------------------------------------------------------------

app = FastAPI(title="Heali", description="Real-time AI Health Guardian")

# CORS: allow specific origins — set CORS_ALLOWED_ORIGINS env var for production.
# Local dev defaults to localhost ports. Multiple origins are comma-separated.
_allowed_origins = [
    o.strip()
    for o in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:8001",
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize data service — SQLite (default) or Firestore
if os.getenv("USE_FIRESTORE", "false").lower() == "true":
    FirestoreService.get_instance().initialize()
else:
    FirestoreService.get_instance()  # triggers SQLiteService creation and table bootstrap

# Register local auth router when running without Firebase
if USE_LOCAL_AUTH:
    from app.auth_local import router as _local_auth_router
    app.include_router(_local_auth_router, prefix="/api/auth")


# Middleware: Set correct Cache-Control headers for all served content.
# - /assets/* (Vite hashed JS/CSS bundles) → immutable, 1 year — hash changes with content so stale = new URL
# - SPA routes (no file extension) + /static/* → no-store — browser must always fetch fresh index.html
#   so users pick up the new hashed bundle filenames after a deployment
# - Everything else (images, audio, favicon — no hash) → 1-day TTL
class CacheControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path.startswith("/static/") or "." not in path.rsplit("/", 1)[-1]:
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
        else:
            response.headers.setdefault("Cache-Control", "public, max-age=86400")
        return response


app.add_middleware(CacheControlMiddleware)

# Mount API routers
from app.api.avatar import router as avatar_router
from app.api.family import router as family_router
from app.api.reminders import router as reminders_router
from app.api.scan import router as scan_router
from app.api.calling import router as calling_router
from app.api.food import router as food_router
from app.api.medications import router as medications_router
from app.api.alerts import router as alerts_router
from app.api.clinical_brief import router as clinical_brief_router
from app.api.wearables import router as wearables_router

app.include_router(avatar_router)
app.include_router(family_router)
app.include_router(reminders_router)
app.include_router(scan_router)
app.include_router(calling_router)
app.include_router(food_router)
app.include_router(medications_router)
app.include_router(alerts_router)
app.include_router(clinical_brief_router)
app.include_router(wearables_router)

# Session service (will upgrade to Firestore-backed in Phase 3)
session_service = InMemorySessionService()

# ADK Runner
runner = Runner(
    app_name=APP_NAME,
    agent=root_agent,
    session_service=session_service,
)



# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/")
async def index():
    """Serve the modern React UI (from Vite dist)."""
    REACT_INDEX = Path(__file__).parent.parent / "dist" / "index.html"
    if REACT_INDEX.exists():
        return FileResponse(str(REACT_INDEX))
    # Fallback to legacy if dist is missing
    return JSONResponse({"status": "error", "message": "Frontend build (dist/index.html) not found. Run 'npm run build'."})


@app.get("/health")
async def health_check():
    """Cloud Run health check endpoint."""
    return {"status": "healthy", "app": APP_NAME}


def _skip_auth_for_testing() -> bool:
    """True when auth is disabled for testing. Set SKIP_AUTH_FOR_TESTING=true (or 1/yes) to bypass auth locally."""
    v = os.getenv("SKIP_AUTH_FOR_TESTING", "false").lower()
    return v in ("1", "true", "yes")


@app.get("/api/config")
async def get_public_config():
    """Public config for the frontend (e.g. VAPID key for FCM, skipAuth for testing)."""
    return {
        "vapidKey": os.getenv("VAPID_KEY", ""),
        "skipAuth": _skip_auth_for_testing(),
    }


# Legacy dashboard redirecting to new one
@app.get("/dashboard")
async def dashboard_page():
    """Redirect to new React dashboard."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/")


# ---------------------------------------------------------------------------
# Auth + Profile REST Endpoints
# ---------------------------------------------------------------------------


def _extract_uid(authorization: str | None) -> str:
    """Verify 'Bearer <idToken>' header and return Firebase UID (or demo_user when skip auth)."""
    token = (authorization or "").removeprefix("Bearer ").strip()
    if _skip_auth_for_testing() and (not token or token == "demo"):
        return "demo_user"
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    try:
        decoded = _verify_token(token)
        return decoded["uid"]
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")


@app.get("/api/auth/profile")
async def get_profile(authorization: str = Header(default=None)):
    """Return the Firestore profile for the authenticated user.

    Returns 404 if this is a first-time user (no profile yet).
    """
    uid = _extract_uid(authorization)
    fs = FirestoreService.get_instance()

    if not fs.is_available:
        from agents.shared.mock_data import PATIENT_PROFILE as _mock_profile
        profile = _mock_profile
        health = {"allergies": [], "diet_type": "", "current_medications": ""}
    else:
        profile = await fs.get_or_create_profile(uid)
        health = await fs.get_health_restrictions(uid)

    response_data = profile or {}

    # Normalize profile for Profile UI: support both React onboarding (display_name, emergency_contact_*)
    # and voice/agent onboarding (name, emergency_contact array)
    if response_data:
        response_data["display_name"] = response_data.get("display_name") or response_data.get("name")
        ec = response_data.get("emergency_contact")
        if isinstance(ec, list) and ec and not response_data.get("emergency_contact_name"):
            response_data["emergency_contact_name"] = ec[0].get("name", "")
            response_data["emergency_contact_phone"] = ec[0].get("phone", "")
        elif not response_data.get("emergency_contact_name"):
            response_data.setdefault("emergency_contact_name", "")
            response_data.setdefault("emergency_contact_phone", "")

    if health:
        # Flatten health into profile response for easier frontend pairing
        response_data["allergies"] = ", ".join(health.get("allergies", []))
        response_data["dietary_preference"] = health.get("diet_type", "")
        response_data["current_medications"] = health.get("current_medications", "")

    return JSONResponse(response_data)


@app.post("/api/auth/profile")
async def save_profile(
    body: dict,
    authorization: str = Header(default=None),
):
    """Save / update the authenticated user's profile after onboarding.

    Accepts any subset of: language, companion_name, avatar_b64, family_link_code.
    """
    uid = _extract_uid(authorization)
    fs = FirestoreService.get_instance()

    if not fs.is_available:
        logger.info("Mock mode: skipping profile save for uid=%s", uid)
        return JSONResponse({"status": "ok", "message": "Changes skipped in mock mode"})

    # Only allow safe profile fields (block internal Firestore fields)
    allowed_profile = {
        "language", "companion_name", "avatar_b64", "user_avatar_b64", "family_link_code", "display_name", "voice_name",
        "blood_type", "emergency_contact_name", "emergency_contact_phone", "primary_doctor", "conditions",
        "onboarding_complete",
    }
    filtered_profile = {k: v for k, v in body.items() if k in allowed_profile}

    if filtered_profile:
        await fs.save_user_profile(uid, filtered_profile)

    # Handle health restrictions separately per schema
    if "allergies" in body or "dietary_preference" in body or "current_medications" in body:
        # Expecting allergies as a comma separated string from the frontend form
        allergies_str = body.get("allergies", "")
        allergies = [a.strip() for a in allergies_str.split(",") if a.strip()]
        diet = body.get("dietary_preference", "")
        meds = body.get("current_medications", "")
        await fs.save_health_restrictions(uid, allergies, diet, meds)

    if not filtered_profile and "allergies" not in body and "dietary_preference" not in body and "current_medications" not in body:
        raise HTTPException(status_code=400, detail="No valid profile or health fields provided")

    return {"status": "ok", "uid": uid, "updated": list(filtered_profile.keys()) + ["health"]}


# ---------------------------------------------------------------------------
# Proactive Reminders (Cloud Tasks Webhook)
# ---------------------------------------------------------------------------


@app.post("/api/tasks/reminder")
async def handle_medication_reminder(request: Request):
    """Webhook for Google Cloud Tasks to hit when it's time to take medication."""
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    
    uid = data.get("uid")
    medication_name = data.get("medication_name")
    
    if not uid or not medication_name:
        raise HTTPException(status_code=400, detail="Missing uid or medication_name")
        
    logger.info("Processing Cloud Task reminder for %s: %s", uid, medication_name)
    
    # 1. Fetch user profile to get FCM device token
    fs = FirestoreService.get_instance()
    profile = await fs.get_patient_profile(uid)
    fcm_token = profile.get("fcm_token") if profile else None
    
    # Construct Proactive Audio Prompt
    proactive_msg = f"[SYSTEM INJECTION: The patient just opened the app from a push notification reminding them to take their {medication_name}. Proactively greet them and remind them to take it, without waiting for them to speak first.]"
    
    if not fcm_token:
        # Mock mode if no active device token is registered
        logger.warning("[MOCK PUSH] Would send push to %s => %s", uid, medication_name)
        return {"status": "mock_push_sent", "proactive_prompt": proactive_msg}
        
    # 2. Send FCM Push Notification
    message = messaging.Message(
        notification=messaging.Notification(
            title="Medication Reminder",
            body=f"It's time to take your {medication_name}.",
        ),
        data={
            "action": "open_heali",
            "proactive_prompt": proactive_msg
        },
        token=fcm_token,
    )
    
    try:
        response = messaging.send(message)
        logger.info("Successfully sent FCM message: %s", response)
        return {"status": "ok", "message_id": response}
    except Exception as e:
        logger.error("FCM sending failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Family Dashboard REST Endpoint
# ---------------------------------------------------------------------------


@app.get("/api/dashboard")
async def get_dashboard_data(
    patient_uid: str,
    authorization: str = Header(default=None),
):
    """Return live health data for the family caregiver dashboard.

    The requester must be:
    - The patient themselves (own data), OR
    - A family member who has verified a family link code for this patient.

    Returns a JSON dict with keys:
        adherence           – 7-day medication adherence score
        blood_sugar_trend   – blood sugar readings trend
        blood_pressure_trend – blood pressure readings trend
        digest              – today's digest (medications, vitals, meals)
    """
    # 1. Authenticate requester
    requester_uid = _extract_uid(authorization)

    # 2. Authorise: self-view OR family member check
    if requester_uid != patient_uid:
        fs = FirestoreService.get_instance()
        if fs.is_available:
            linked = await fs.is_family_linked(requester_uid, patient_uid)
            if not linked:
                raise HTTPException(
                    status_code=403, detail="Not linked to this patient"
                )

    # 3. Fetch live data by calling insights tools directly.
    #    We build a minimal tool_context-like object that routes Firestore
    #    queries to the correct patient UID.
    from agents.insights.tools import (
        get_adherence_score,
        get_vital_trends,
        get_daily_digest,
    )
    from agents.shared.mock_data import PATIENT_PROFILE as _mock_profile

    class _ToolCtx:
        state = {"user_id": patient_uid}

    # In demo / skip-auth mode force mock data by passing no tool_context,
    # so the insights tools bypass Firestore (which has no health records for
    # demo_user) and fall back to mock_data.py instead.
    ctx = None if _skip_auth_for_testing() else _ToolCtx()

    # Default fallback data for when Firestore has no records
    _default_adherence = {"taken": 0, "missed": 0, "total_doses": 0, "score": 0, "rating": "No data"}
    _default_trend = {"trend": "stable", "readings": [], "latest_reading": None}
    _default_digest = {"medications": {"taken": [], "missed": [], "pending": []}, "vitals_recorded": [], "meals": []}

    # Resolve patient name (Firestore profile → mock data fallback)
    patient_name = _mock_profile.get("name", "")
    fs = FirestoreService.get_instance()
    if fs.is_available:
        try:
            profile = await fs.get_patient_profile(patient_uid)
            if profile:
                patient_name = profile.get("name", profile.get("companion_name", patient_name))
        except Exception:
            pass

    try:
        adherence, blood_sugar_trend, bp_trend, digest = await asyncio.gather(
            get_adherence_score(days=7, tool_context=ctx),
            get_vital_trends("blood_sugar", days=7, tool_context=ctx),
            get_vital_trends("blood_pressure", days=7, tool_context=ctx),
            get_daily_digest(tool_context=ctx),
        )
    except Exception as exc:
        logger.warning("Dashboard data fetch failed for uid=%s: %s", patient_uid, exc)
        adherence = _default_adherence
        blood_sugar_trend = _default_trend
        bp_trend = _default_trend
        digest = _default_digest

    return JSONResponse({
        "patient_name": patient_name,
        "adherence": adherence or _default_adherence,
        "blood_sugar_trend": blood_sugar_trend or _default_trend,
        "blood_pressure_trend": bp_trend or _default_trend,
        "digest": digest or _default_digest,
    })


@app.post("/api/vitals")
async def log_vital(
    body: dict,
    authorization: str = Header(default=None),
):
    """Log a health vital (blood pressure, heart rate, etc.)"""
    uid = _extract_uid(authorization)
    fs = FirestoreService.get_instance()
    
    vital_type = body.get("type", "blood_pressure")
    value = body.get("value", "")
    unit = body.get("unit", "")
    
    entry = {
        "type": vital_type,
        "value": value,
        "unit": unit,
        "date": datetime.now().strftime("%Y-%m-%d"),
        "timestamp": datetime.now().isoformat()
    }
    
    if fs.is_available:
        await fs.add_vitals_entry(uid, entry)
    else:
        logger.info("Mock mode: skipping vital log for uid=%s", uid)
        
    return JSONResponse({"status": "ok", "entry": entry})


@app.post("/api/symptoms")
async def log_symptom(
    body: dict,
    authorization: str = Header(default=None),
):
    """Log reported symptoms from the patient during a Voice Guardian session."""
    uid = _extract_uid(authorization)
    fs = FirestoreService.get_instance()

    symptoms = body.get("symptoms", "")
    severity = body.get("severity", "mild")
    next_steps = body.get("next_steps", "")
    followup_scheduled = body.get("followup_scheduled", False)

    entry = {
        "symptoms": symptoms,
        "severity": severity,
        "next_steps": next_steps,
        "followup_scheduled": followup_scheduled,
        "date": datetime.now().strftime("%Y-%m-%d"),
        "time": datetime.now().strftime("%H:%M"),
        "timestamp": datetime.now().isoformat(),
        "source": "voice_guardian",
    }

    try:
        await fs.add_symptom(uid, entry)
        logger.info("Symptom logged for uid=%s: %s", uid, symptoms)
    except Exception as exc:
        logger.warning("Failed to save symptom for uid=%s: %s", uid, exc)

    return JSONResponse({
        "status": "ok",
        "entry": entry,
        "ui_event": {
            "target": "symptom_logged",
            "data": {
                "symptoms": symptoms,
                "severity": severity,
                "next_steps": next_steps,
                "followup_scheduled": followup_scheduled,
            }
        }
    })


# ---------------------------------------------------------------------------
# Phase 10: Appointments API
# ---------------------------------------------------------------------------


@app.get("/api/appointments")
async def get_appointments(
    patient_uid: str,
    authorization: str = Header(default=None),
):
    """Return upcoming appointments for a patient.

    Auth logic mirrors /api/dashboard.
    """
    requester_uid = _extract_uid(authorization)

    if requester_uid != patient_uid:
        fs = FirestoreService.get_instance()
        if fs.is_available:
            linked = await fs.is_family_linked(requester_uid, patient_uid)
            if not linked:
                raise HTTPException(
                    status_code=403, detail="Not linked to this patient"
                )

    # Fetch appointments
    fs = FirestoreService.get_instance()
    if fs.is_available:
        try:
            appointments = await fs.get_appointments(patient_uid)
        except Exception as exc:
            logger.warning("Appointments fetch failed for uid=%s: %s", patient_uid, exc)
            appointments = []
    else:
        from agents.shared.mock_data import APPOINTMENTS
        appointments = [a for a in APPOINTMENTS if a.get("patient_uid") == patient_uid]

    return JSONResponse({"appointments": appointments})


# ---------------------------------------------------------------------------
# Phase 2-4: WebSocket Bidi-Streaming
# ---------------------------------------------------------------------------


@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """Bidirectional voice/video streaming via WebSocket.

    Client sends JSON messages:
        {"type": "audio", "data": "<base64 PCM 16kHz mono>"}
        {"type": "image", "data": "<base64 JPEG>", "mimeType": "image/jpeg"}
        {"type": "text",  "text": "hello"}

    Server sends ADK LiveEvent JSON (contains audio, text, transcriptions, etc.)

    Query params:
        ?token={Firebase ID Token}   (required; verified server-side)
        ?persona=en|hi|kn|es          (optional; fallback if no Firestore profile)
    """
    # --- Auth gate ---
    # NOTE: websocket.accept() must be called BEFORE websocket.close() with a
    # custom code; otherwise Starlette returns HTTP 403 and the browser never
    # sees the WS close frame, so the JS onclose(4401) redirect never fires.
    token = websocket.query_params.get("token", "")
    if _skip_auth_for_testing() and (not token or token == "demo"):
        uid = user_id  # use path param as uid (client sends /ws/demo_user)
    elif not token:
        await websocket.accept()
        await websocket.close(code=4401, reason="Missing auth token")
        return
    else:
        try:
            decoded = _verify_token(token)
            uid = decoded["uid"]
        except Exception as exc:
            logger.warning("WS auth failed: %s", exc)
            await websocket.accept()
            await websocket.close(code=4401, reason="Invalid auth token")
            return

    await websocket.accept()
    session_id = str(uuid.uuid4())

    # --- Load profile from Firestore for language + companion_name ---
    fs = FirestoreService.get_instance()
    language = "English"
    companion_name = "Health Companion"
    voice_name = "Aoede" # Default
    onboarding_complete = False
    patient_name = ""
    patient_conditions = ""
    patient_medications = ""
    patient_allergies = ""
    patient_blood_type = ""
    patient_diet = ""
    patient_primary_doctor = ""
    patient_emergency_contact = ""

    if fs.is_available:
        try:
            profile = await fs.get_patient_profile(uid)
            if profile:
                language = profile.get("language", language)
                companion_name = profile.get("companion_name", companion_name)
                voice_name = profile.get("voice_name", voice_name)
                onboarding_complete = profile.get("onboarding_complete", False)
                patient_name = profile.get("display_name", "") or profile.get("name", "")
                patient_conditions = profile.get("conditions", "")
                patient_blood_type = profile.get("blood_type", "")
                patient_primary_doctor = profile.get("primary_doctor", "")
                ec_name = profile.get("emergency_contact_name", "")
                ec_phone = profile.get("emergency_contact_phone", "")
                if ec_name:
                    patient_emergency_contact = f"{ec_name} ({ec_phone})" if ec_phone else ec_name
            # Also load health restrictions (medications, allergies, diet)
            try:
                health = await fs.get_health_restrictions(uid)
                if health:
                    allergies_list = health.get("allergies", [])
                    patient_allergies = ", ".join(allergies_list) if isinstance(allergies_list, list) else str(allergies_list)
                    patient_medications = health.get("current_medications", "")
                    patient_diet = health.get("diet_type", "")
            except Exception:
                pass
        except Exception as e:
            logger.warning("Could not load profile for uid=%s: %s", uid, e)

    q_patient_name = websocket.query_params.get("patient_name")
    if q_patient_name and (_skip_auth_for_testing() or not patient_name):
        patient_name = q_patient_name
        onboarding_complete = True

    # Fallback: Trust frontend's persona query param if DB values are defaults
    persona = websocket.query_params.get("persona")
    PERSONA_DEFAULTS = {
        "hi": ("Hindi", "Heali (Balanced)", "Aoede"),
        "es": ("Spanish", "Heali (Balanced)", "Aoede"),
        "kn": ("Kannada", "Heali (Balanced)", "Aoede"),
        "en": ("English", "Heali (Balanced)", "Aoede"),
    }
    if persona and persona in PERSONA_DEFAULTS:
        fallback_lang, fallback_name, fallback_voice = PERSONA_DEFAULTS[persona]
        # In demo/skip-auth mode always trust the frontend persona param (Firestore
        # may have a stale language from a previous session that cannot be updated).
        # In auth mode only override when the DB still has the default "English".
        if language == "English" or _skip_auth_for_testing():
            language = fallback_lang
        if companion_name == "Health Companion":
            companion_name = fallback_name
        if voice_name == "Aoede":
            voice_name = fallback_voice

    logger.info(
        "WebSocket connected: uid=%s session=%s language=%s companion=%s voice=%s",
        uid, session_id, language, companion_name, voice_name
    )

    # --- Phase 2: Session Initialization ---
    session = await session_service.create_session(
        app_name=APP_NAME,
        user_id=uid,
        session_id=session_id,
        state={
            "user_id": uid,
            "session_id": session_id,
            "language": language,
            "companion_name": companion_name,
            "onboarding_complete": onboarding_complete,
            "patient_name": patient_name,
            # Health context — allows agents to personalize advice
            "patient_conditions": patient_conditions,
            "patient_medications": patient_medications,
            "patient_allergies": patient_allergies,
            "patient_blood_type": patient_blood_type,
            "patient_diet": patient_diet,
            "patient_primary_doctor": patient_primary_doctor,
            "patient_emergency_contact": patient_emergency_contact,
        },
    )

    live_request_queue = LiveRequestQueue()
    session.state["live_request_queue"] = live_request_queue

    # --- Phase 2.1: Avatar Initialization ---
    # Dispatch companion identity to frontend — frontend looks up the static asset by name
    await websocket.send_text(json.dumps({
        "target": "avatar_update",
        "companion_name": companion_name
    }))

    # --- Phase 2.5: Proactive Audio Injection ---
    # Priority: explicit query param > smart routing based on profile
    proactive_prompt = websocket.query_params.get("proactive_prompt")
    exercises_completed_param = websocket.query_params.get("exercises_completed")
    if proactive_prompt:
        logger.info("Injecting explicit proactive prompt: %s", proactive_prompt)
        _dbg_log("main.py:ws_connect", "proactive_prompt received", {"has_wellness": "WELLNESS_SESSION_START" in proactive_prompt})
    elif not onboarding_complete:
        proactive_prompt = (
            f"[SYSTEM: This is a brand-new user who has NOT completed onboarding. "
            f"Transfer them to the onboarding agent immediately. Say something brief "
            f"in {language} like 'Welcome! Let me help you get set up.' and hand off.]"
        )
        logger.info("New user detected — injecting onboarding auto-start prompt in %s", language)
    elif patient_name:
        proactive_prompt = (
            f"[SYSTEM: Welcome back! The patient's name is {patient_name}. "
            f"They have already completed onboarding. Greet them warmly by name "
            f"and ask how you can help today. Be personable.]"
        )
        logger.info("Returning user '%s' — injecting warm greeting prompt", patient_name)

    # Resume on reconnect: when Exercise page reconnects with exercises_completed=N,
    # inject instruction to resume from exercise N+1 instead of restarting.
    if proactive_prompt and "WELLNESS_SESSION_START" in proactive_prompt and exercises_completed_param:
        try:
            n = int(exercises_completed_param)
            if 1 <= n < 14:
                resume_msg = (
                    f"\n\n[SYSTEM: User reconnected. They have completed exercises 1 through {n}. "
                    f"Resume with exercise {n + 1}. Call get_next_exercise() to get the next exercise. "
                    f"Do NOT restart from Box Breathing. Do NOT re-greet.]"
                )
                proactive_prompt = proactive_prompt + resume_msg
                session.state["exercises_completed"] = n
                logger.info("Exercise resume: user completed %s, resuming from exercise %s", n, n + 1)
        except (ValueError, TypeError):
            pass

    if proactive_prompt:
        content = types.Content(
            parts=[types.Part(text=proactive_prompt)]
        )
        live_request_queue.send_content(content)

    # Wellness/exercise sessions get a calmer voice and affective dialog enabled
    # so the model naturally softens its tone to match the meditative context.
    is_wellness_session = proactive_prompt and "WELLNESS_SESSION_START" in proactive_prompt
    if is_wellness_session:
        session.state["is_wellness_session"] = True
        _dbg_log("main.py:init", "is_wellness_session set", {"session_id": session_id})
        voice_name = "Kore"  # Soft, gentle voice — best for guided wellness
        logger.info("Wellness session detected — using Kore voice + affective dialog")

    # RunConfig for native audio bidi-streaming
    # VAD: endOfSpeechSensitivity=LOW so the model commits end-of-turn with shorter
    # silence; silenceDurationMs=400ms balances latency vs allowing natural pauses.
    # For wellness sessions, increase silence_duration_ms so the agent pauses longer
    # between cues. Older adults take longer pauses when speaking and breathe heavily
    # during exercise — 400ms would cut them off. 2000ms gives time for "feedback + Are you ready?"
    silence_ms = 2000 if is_wellness_session else 400
    realtime_input_config = types.RealtimeInputConfig(
        automatic_activity_detection=types.AutomaticActivityDetection(
            end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
            silence_duration_ms=silence_ms,
        )
    )
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        realtime_input_config=realtime_input_config,
        # enable_affective_dialog lets the model adjust its vocal tone to match
        # emotional context — for wellness it naturally becomes calmer and warmer.
        enable_affective_dialog=True,
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=voice_name,  # Dynamic voice (Kore for wellness)
                )
            )
        ),
    )

    # --- Phase 3: Upstream + Downstream Tasks ---

    def _scan_red_line(text: str) -> str | None:
        """Deterministic keyword scan for life-threatening emergencies.

        Returns the matched keyword or None. Respects negation prefixes
        so "I don't have chest pain" does not trigger a false alarm.
        """
        import re
        text_lower = text.lower()
        for keyword in RED_LINE_KEYWORDS:
            if keyword in text_lower:
                prefix_group = "|".join(NEGATION_PREFIXES)
                neg_pattern = re.compile(
                    rf"(?:{prefix_group}).{{0,20}}{re.escape(keyword)}",
                    re.IGNORECASE,
                )
                if neg_pattern.search(text_lower):
                    continue
                return keyword
        return None

    # Shared state for diagnostics: downstream can log when first response arrives after audio
    upstream_audio_chunks = []

    async def upstream_task():
        """Client -> Server -> LiveRequestQueue."""
        try:
            while True:
                raw = await websocket.receive_text()
                msg = json.loads(raw)
                msg_type = msg.get("type", "")

                if msg_type == "audio":
                    try:
                        audio_bytes = base64.b64decode(msg["data"])
                    except Exception as e:
                        logger.warning("Upstream audio decode failed: %s", e)
                        continue
                    upstream_audio_chunks.append(len(audio_bytes))
                    n = len(upstream_audio_chunks)
                    if n <= 10 or n % 50 == 0:
                        logger.info(
                            "Upstream audio #%s: %s bytes (total so far: %s)",
                            n, len(audio_bytes), sum(upstream_audio_chunks),
                        )
                    if n == 500:
                        logger.warning(
                            "No response yet after 500 upstream audio chunks. "
                            "If you spoke, the model may not be replying to audio."
                        )
                    live_request_queue.send_realtime(
                        types.Blob(
                            mime_type="audio/pcm;rate=16000",
                            data=audio_bytes,
                        )
                    )

                elif msg_type == "image":
                    image_bytes = base64.b64decode(msg["data"])
                    mime = msg.get("mimeType", "image/jpeg")
                    live_request_queue.send_realtime(
                        types.Blob(mime_type=mime, data=image_bytes)
                    )

                elif msg_type == "end_turn":
                    # DEPRECATED: Gemini native audio API uses automatic activity detection (VAD).
                    # Explicit activity control (send_activity_end) is not supported and will
                    # crash the connection with APIError 1007.
                    logger.info("Received end_turn from client (ignored due to auto-VAD)")

                elif msg_type == "text":
                    user_text = msg["text"]
                    logger.info("Upstream text received (e.g. greeting): %s", user_text[:80] + "..." if len(user_text) > 80 else user_text)

                    # Intercept "stop" / "end session" in wellness — force complete_exercise_session
                    stop_words = ("stop", "okay stop", "end session", "that's enough", "i'm done", "no more", "quit", "we're done")
                    if user_text and (user_text.strip().lower() in stop_words or any(w in user_text.lower() for w in stop_words)):
                        try:
                            sess = await session_service.get_session(
                                app_name=APP_NAME, user_id=uid, session_id=session_id
                            )
                            is_wellness = sess and sess.state.get("is_wellness_session")
                            _dbg_log("main.py:text_stop", "text stop check", {"user_text": user_text[:50], "is_wellness": is_wellness, "sess_exists": sess is not None})
                            if sess and sess.state.get("is_wellness_session"):
                                from agents.exercise.tools import EXERCISE_PROGRESS
                                n = max(1, EXERCISE_PROGRESS.get(uid, sess.state.get("exercises_completed", 0)))
                                user_text = (
                                    f"[SYSTEM: USER SAID STOP. You MUST call complete_exercise_session({n}, 'User ended session') "
                                    f"immediately. Say 'No problem! You did great. Let's wrap up.' and end. Do NOT continue coaching.]"
                                )
                                _dbg_log("main.py:text_stop", "TEXT STOP INTERCEPTED", {"n": n})
                                logger.info("Exercise stop intercepted: injecting complete_exercise_session directive")
                        except Exception as e:
                            logger.warning("Failed to intercept stop for exercise: %s", e)

                    # Intercept "coach paused" nudge — replace with concise resume directive
                    if user_text and ("coach paused" in user_text.lower() or "Coach paused" in user_text):
                        user_text = (
                            "[SYSTEM: Coach paused. Resume — continue counting the rhythm. Do NOT re-introduce. Do NOT say 'Let's start with' again.]"
                        )
                        logger.info("Coach paused nudge intercepted")

                    red_line_hit = _scan_red_line(user_text)
                    if red_line_hit:
                        logger.warning(
                            "RED LINE detected in text (keyword=%s), "
                            "injecting emergency directive",
                            red_line_hit,
                        )
                        user_text = (
                            f"[SYSTEM: RED LINE EMERGENCY DETECTED — "
                            f"patient said '{red_line_hit}'. You MUST call "
                            f"initiate_emergency_protocol immediately with "
                            f"severity='red_line' and symptom_description="
                            f"'{red_line_hit}'. Do NOT provide medical advice.]"
                        )

                    # gemini-live-2.5-flash-native-audio completely ignores text input
                    # (both send_content and text/plain blob). We must synthesize the
                    # text to audio and send it as a PCM stream to force a response.
                    try:
                        import tempfile
                        import subprocess
                        import wave

                        # Use macOS native 'say' command for zero-dependency, free, offline TTS
                        # to bypass Gemini Native Audio's inability to read text inputs.
                        # On Linux (Cloud Run), we log a warning as 'say' is unavailable.
                        import shutil
                        if shutil.which("say"):
                            with tempfile.NamedTemporaryFile(suffix=".wav") as f:
                                subprocess.run(
                                    [
                                        "say", "-o", f.name,
                                        "--data-format=LEI16@16000",
                                        "--file-format=WAVE",
                                        user_text,
                                    ],
                                    check=True
                                )
                                with wave.open(f.name, "rb") as w:
                                    pcm_audio = w.readframes(w.getnframes())

                            live_request_queue.send_realtime(
                                types.Blob(
                                    mime_type="audio/pcm;rate=16000",
                                    data=pcm_audio,
                                )
                            )
                            # Pad with 500 ms of silence so VAD detects end-of-speech
                            # and triggers model inference. Without this the model may
                            # never see the end-of-turn boundary after short TTS clips.
                            _silence = bytes(int(16000 * 0.5) * 2)  # 500 ms @ 16kHz 16-bit mono
                            live_request_queue.send_realtime(
                                types.Blob(mime_type="audio/pcm;rate=16000", data=_silence)
                            )
                            logger.info("Synthesized %d bytes of PCM audio from text using macOS 'say' and sent to Gemini (+ 500ms silence pad)", len(pcm_audio))
                        else:
                            logger.warning("TTS 'say' command not found. Sending raw text to Gemini (may be ignored by native-audio model).")
                            # Fallback: send as text contents even if native-audio model ignores it
                            # This at least keeps the session history intact for the next turn.
                            live_request_queue.send_content(
                                types.Content(role="user", parts=[types.Part(text=user_text)])
                            )
                    except Exception as e:
                        logger.error("TTS conversion failed for text input: %s", e)

        except WebSocketDisconnect:
            logger.info(f"Client disconnected: uid={uid}")
        except Exception as e:
            logger.error(f"Upstream error: {e}")

    async def downstream_task():
        """LiveRequestQueue -> ADK Runner -> Client."""
        first_audio_logged = False
        gemini_ready_sent = False
        logger.info("Downstream task started, waiting for events from runner.run_live...")
        # Send ready immediately so the client can start speaking. Gemini Live native-audio
        # may not respond to text-only proactive prompts; the user's speech will trigger the first response.
        try:
            await websocket.send_text('{"type":"ready"}')
            gemini_ready_sent = True
            logger.info("Gemini Live ready signal sent to client (immediate)")
        except Exception:
            pass
        try:
            session_obj = await session_service.get_session(
                app_name=APP_NAME, 
                user_id=uid, 
                session_id=session_id
            )
            async for event in runner.run_live(
                user_id=uid,
                session_id=session_id,
                live_request_queue=live_request_queue,
                run_config=run_config,
            ):
                # 1. Check for Generative UI updates injected by tools
                # a) Session-state-based events (onboarding/guardian tools)
                session_obj = await session_service.get_session(
                    app_name=APP_NAME, user_id=uid, session_id=session_id
                )
                ui_events = session_obj.state.pop("ui_events", [])

                # b) Global-queue-based events (booking tools — bypasses ADK
                #    session state which doesn't propagate in run_live mode)
                from agents.booking.tools import BOOKING_UI_QUEUE
                booking_events = BOOKING_UI_QUEUE.pop(uid, [])
                ui_events.extend(booking_events)

                # Dedupe: same medication_logged/medication_taken in one batch → send only last; profile_preview → at most one; meal_logged → dedupe by description+type
                _seen_med_key: set[tuple[str, str]] = set()
                _seen_meal_key: set[tuple[str, str, str]] = set()
                _seen_profile_preview = False
                _seen_food_detected = False
                _deduped: list[dict] = []
                for ev in reversed(ui_events):
                    t = ev.get("target")
                    if t in ("medication_logged", "medication_taken"):
                        data = ev.get("data") or {}
                        key = (t, str(data.get("medication_name") or data.get("name") or data.get("medication") or ""))
                        if key in _seen_med_key:
                            continue
                        _seen_med_key.add(key)
                    if t == "meal_logged":
                        data = ev.get("data") or {}
                        meal_key = (t, str(data.get("description", "")), str(data.get("type", "")))
                        if meal_key in _seen_meal_key:
                            continue
                        _seen_meal_key.add(meal_key)
                    if t == "food_detected":
                        if _seen_food_detected:
                            continue
                        _seen_food_detected = True
                    if t == "profile_preview":
                        if _seen_profile_preview:
                            continue
                        _seen_profile_preview = True
                    _deduped.append(ev)
                ui_events = list(reversed(_deduped))

                if ui_events:
                    logger.info(f"Found {len(ui_events)} UI events to dispatch")
                for ui_event in ui_events:
                    try:
                        await websocket.send_text(json.dumps(ui_event))
                        logger.info(f"Dispatched UI Event: {ui_event['target']}")
                    except Exception as e:
                        logger.error(f"Failed to send UI event: {e}")
                        
                # 2. Check for onboarding completion — reconnect so the Guardian agent's
                #    warm greeting fires from the new connection (uses Firestore profile).
                reconnect_after_onboarding = session_obj.state.pop("reconnect_after_onboarding", None)
                if reconnect_after_onboarding:
                    logger.info("Onboarding complete — closing WS (4005) to trigger Guardian greeting on reconnect.")
                    try:
                        await websocket.close(code=4005, reason="onboarding_complete")
                    except Exception:
                        pass
                    return

                # 3. Check for Voice Settings Change (triggers WS Re-Init)
                new_voice = session_obj.state.pop("new_voice_name", None)
                if new_voice:
                    onboarding_complete = session_obj.state.get("onboarding_complete", True)
                    if not onboarding_complete:
                        # User is mid-onboarding — defer reconnect to avoid losing context
                        logger.info(
                            "Voice changed to %s but user is mid-onboarding; deferring 4005. "
                            "Voice will apply on next connect.",
                            new_voice,
                        )
                    else:
                        logger.info(f"Voice changed to {new_voice}. Closing WS (code 4005) to force client re-init.")
                        try:
                            await websocket.close(code=4005, reason="voice_settings_changed")
                        except Exception:
                            pass
                        return  # Break the run_live loop gracefully

                # First event means Gemini Live is connected — tell the client
                if not gemini_ready_sent:
                    try:
                        await websocket.send_text('{"type":"ready"}')
                        gemini_ready_sent = True
                        logger.info("Gemini Live ready signal sent to client")
                    except Exception:
                        pass

                # Serialize ADK event and send to client
                try:
                    # Detect event types for logging
                    has_audio = False
                    has_text = False
                    if event.content and event.content.parts:
                        for part in event.content.parts:
                            if part.inline_data:
                                has_audio = True
                            if part.text:
                                has_text = True

                    # Log transcription text for debugging duplication
                    input_tx_text = (
                        event.input_transcription.text
                        if event.input_transcription
                        else None
                    )
                    output_tx_text = (
                        event.output_transcription.text
                        if event.output_transcription
                        else None
                    )
                    # Intercept voice "stop" in wellness — inject directive for next turn
                    if input_tx_text:
                        stop_words = ("stop", "okay stop", "end session", "that's enough", "i'm done", "no more", "quit", "we're done")
                        negations = ("don't stop", "do not stop", "won't stop", "never stop", "can't stop", "cannot stop")
                        txt_lower = input_tx_text.strip().lower()
                        stop_detected = not any(neg in txt_lower for neg in negations) and (txt_lower in stop_words or any(w in txt_lower for w in stop_words))
                        if stop_detected:
                            is_wellness = session_obj and session_obj.state.get("is_wellness_session")
                            _dbg_log("main.py:voice_stop", "voice stop check", {"input_tx": input_tx_text[:80], "is_wellness": is_wellness, "session_obj": session_obj is not None})
                            try:
                                if session_obj and session_obj.state.get("is_wellness_session"):
                                    from agents.exercise.tools import EXERCISE_PROGRESS
                                    n = max(1, EXERCISE_PROGRESS.get(uid, session_obj.state.get("exercises_completed", 0)))
                                    directive = (
                                        f"[SYSTEM: USER SAID STOP. As the exercise coach, you MUST call complete_exercise_session({n}, 'User ended session') "
                                        f"immediately. Say ONLY: 'No problem! You did great today. Let's wrap up.' Then give a brief warm closing. "
                                        f"Do NOT ask 'was there anything else I can help you with'. Do NOT transfer to another agent.]"
                                    )
                                    live_request_queue.send_content(types.Content(parts=[types.Part(text=directive)]))
                                    _dbg_log("main.py:voice_stop", "VOICE STOP INTERCEPTED", {"n": n})
                                    logger.info("Exercise stop intercepted (voice): injecting complete_exercise_session directive")
                            except Exception as e:
                                logger.warning("Failed to intercept voice stop for exercise: %s", e)
                    # Diagnostic: log every input_transcription so we can confirm speech is recognized
                    if input_tx_text:
                        logger.info(
                            "input_transcription received: %s",
                            repr(input_tx_text)[:120],
                        )
                    # Log only events that indicate model response (audio or turn_complete) to reduce noise
                    if has_audio or event.turn_complete or (output_tx_text and len(output_tx_text) > 20):
                        first_after_audio = bool(upstream_audio_chunks) and (has_audio or event.turn_complete)
                        logger.info(
                            "Response event: audio=%s turn_complete=%s output_tx=%s first_after_speech=%s",
                            has_audio,
                            event.turn_complete,
                            repr(output_tx_text)[:60] if output_tx_text else None,
                            first_after_audio,
                        )


                    event_json = event.model_dump_json(
                        exclude_none=True, by_alias=True
                    )

                    # Log the first audio event's JSON to verify structure
                    if has_audio and not first_audio_logged:
                        logger.info(
                            f"SAMPLE audio event JSON (first 500 chars): "
                            f"{event_json[:500]}"
                        )
                        first_audio_logged = True

                    await websocket.send_text(event_json)

                    # CRITICAL: If turn is complete, ensure we are ready for the next one
                    # Some versions of ADK might need a tiny nudge or state reset here
                    if event.turn_complete:
                        logger.info("Turn complete - session ready for next input")
                        # We don't close the queue, just let the loop continue
                        
                except RuntimeError:
                    # WebSocket already closed — downstream task ends cleanly
                    break
                except Exception as e:
                    logger.error("Failed to send event: %s", e, exc_info=True)
                    break
        except Exception as e:
            logger.exception("Downstream error: %s", e)

    # Run upstream + downstream concurrently
    try:
        await asyncio.gather(
            upstream_task(),
            downstream_task(),
            return_exceptions=True,
        )
    finally:
        # --- Phase 4: Graceful Termination ---
        live_request_queue.close()
        logger.info(f"Session ended: uid={uid}, session={session_id}")


# ---------------------------------------------------------------------------
# Phase 4 Power Feature: Caregiver Approval Workflow
# ---------------------------------------------------------------------------

@app.post("/api/family/plans/{plan_id}/approve")
async def approve_dietary_plan(plan_id: str):
    """Webhook for family members to approve a drafted dietary plan.
    
    In a full production environment, this would verify a caregiver JWT
    and update the Firestore document status from 'draft' to 'approved'.
    For the hackathon, we simulate the approval and could theoretically 
    push a WebSocket status update to the active patient session.
    """
    logger.info(f"Caregiver approved dietary plan: {plan_id}")
    
    # Mocking the Firestore update
    # fs = FirestoreService.get_instance()
    # await fs.update_dietary_plan_status(plan_id, "approved")
    
    return {
        "success": True, 
        "plan_id": plan_id, 
        "new_status": "approved",
        "message": "The dietary plan has been successfully approved by the caregiver."
    }



# ---------------------------------------------------------------------------
# React SPA: Serve Vite build output for production deployment
# ---------------------------------------------------------------------------

REACT_DIR = Path(__file__).parent.parent / "dist"
# Also check /app/dist as a fallback for Cloud Run container path
if not REACT_DIR.exists():
    REACT_DIR = Path("/app/dist")

logger.info("React dist dir: %s (exists=%s)", REACT_DIR, REACT_DIR.exists())

if REACT_DIR.exists():
    # Serve static assets (JS, CSS, images) from Vite build
    _assets_dir = REACT_DIR / "assets"
    logger.info("Assets dir: %s (exists=%s)", _assets_dir, _assets_dir.exists())
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="react-assets")
        logger.info("Mounted /assets from %s", _assets_dir)

    @app.get("/{full_path:path}")
    async def serve_react(full_path: str):
        """Catch-all: serve React SPA for all non-API/non-WS routes."""
        file_path = REACT_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        # index.html must never be cached — after a new deployment the hashed
        # JS/CSS bundle filenames change, and a stale index.html would still
        # reference the old (now-missing) filenames.
        return FileResponse(
            str(REACT_DIR / "index.html"),
            headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
        )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=False,
    )
