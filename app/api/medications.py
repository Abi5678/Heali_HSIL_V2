"""Medication CRUD endpoints: list, add, delete, log adherence."""

import logging
import os
from datetime import datetime

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from google.protobuf.timestamp_pb2 import Timestamp  # noqa: F401 (type hint)

import firebase_admin.auth as fb_auth
from agents.shared.firestore_service import FirestoreService
from agents.shared.mock_data import MEDICATIONS, ADHERENCE_LOG

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/medications", tags=["medications"])


def _skip_auth() -> bool:
    v = os.getenv("SKIP_AUTH_FOR_TESTING", "false").lower()
    return v in ("1", "true", "yes")


def _verify_token(authorization: str | None) -> str:
    """Verify Firebase token; in demo mode (SKIP_AUTH_FOR_TESTING=true) return 'demo_user'."""
    token = (authorization or "").removeprefix("Bearer ").strip()
    if _skip_auth() and (not token or token == "demo"):
        return "demo_user"
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth")
    try:
        decoded = fb_auth.verify_id_token(token)
        return decoded["uid"]
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class AddMedicationRequest(BaseModel):
    name: str
    dosage: str = ""
    purpose: str = ""
    times: list[str] = Field(default_factory=list)
    schedule_type: str = "Daily"


class TakenRequest(BaseModel):
    medication_name: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def _sanitize_for_json(obj):
    """Recursively convert non-serializable types (Firestore timestamps) to strings."""
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, datetime):
        return obj.isoformat()
    if hasattr(obj, "isoformat"):  # DatetimeWithNanoseconds, etc.
        return obj.isoformat()
    return obj


@router.get("")
async def list_medications(authorization: str = Header(default=None)):
    """Return the user's medication list."""
    uid = _verify_token(authorization)
    fs = FirestoreService.get_instance()
    if fs.is_available:
        meds = await fs.get_medications(uid)
    else:
        meds = MEDICATIONS
    return JSONResponse({"medications": _sanitize_for_json(meds)})


@router.post("")
async def add_medication(body: AddMedicationRequest, authorization: str = Header(default=None)):
    """Add a new medication to the user's list."""
    uid = _verify_token(authorization)
    fs = FirestoreService.get_instance()
    if fs.is_available:
        med_id = await fs.add_medication(
            uid, body.name, body.schedule_type, body.times, ""
        )
    else:
        med_id = f"mock_{len(MEDICATIONS) + 1}"
        MEDICATIONS.append({
            "id": med_id,
            "name": body.name,
            "dosage": body.dosage,
            "purpose": body.purpose,
            "times": body.times,
            "frequency": f"{len(body.times)}x daily",
            "pill_description": {"color": "unknown", "shape": "unknown", "imprint": ""},
        })
    logger.info("Medication added: uid=%s name=%s times=%s", uid, body.name, body.times)
    return JSONResponse({"status": "ok", "id": med_id})


@router.delete("/{med_id}")
async def delete_medication(med_id: str, authorization: str = Header(default=None)):
    """Remove a medication."""
    uid = _verify_token(authorization)
    fs = FirestoreService.get_instance()
    if fs.is_available:
        doc_ref = fs._db.collection("users").document(uid).collection("medications").document(med_id)
        doc = await doc_ref.get()
        if not doc.exists:
            raise HTTPException(status_code=404, detail="Medication not found")
        await doc_ref.delete()
    else:
        idx = next((i for i, m in enumerate(MEDICATIONS) if m.get("id") == med_id), None)
        if idx is None:
            raise HTTPException(status_code=404, detail="Medication not found")
        MEDICATIONS.pop(idx)
    logger.info("Medication deleted: uid=%s med_id=%s", uid, med_id)
    return JSONResponse({"status": "ok"})


@router.post("/taken")
async def log_taken(body: TakenRequest, authorization: str = Header(default=None)):
    """Log that a medication was taken (adherence entry)."""
    uid = _verify_token(authorization)
    today = datetime.now().strftime("%Y-%m-%d")
    now_time = datetime.now().strftime("%H:%M")
    entry = {
        "date": today,
        "medication": body.medication_name,
        "time": now_time,
        "taken": True,
    }
    fs = FirestoreService.get_instance()
    if fs.is_available:
        await fs.add_adherence_entry(uid, entry)
    else:
        ADHERENCE_LOG.append(entry)
    logger.info("Medication taken: uid=%s med=%s time=%s", uid, body.medication_name, now_time)
    return JSONResponse({"status": "ok", "logged_at": now_time})
