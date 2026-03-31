"""Family calling API — Two-Legged PSTN bridge via Twilio.

Flow:
1. Patient says "Call my son" → Gemini calls initiate_family_call tool
2. Tool calls POST /api/calling/initiate
3. Server dials the PATIENT's own phone via Twilio
4. When patient picks up, TwiML <Dial> bridges to the family member's phone
5. Two-way PSTN conversation — no WebRTC needed
"""

import logging
import os

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

import firebase_admin.auth as fb_auth
from agents.shared.firestore_service import FirestoreService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/calling", tags=["calling"])

# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------


def _skip_auth() -> bool:
    v = os.getenv("SKIP_AUTH_FOR_TESTING", "false").lower()
    return v in ("1", "true", "yes")


def _verify_token(authorization: str | None) -> str:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if _skip_auth() and (not token or token == "demo"):
        return "demo_user"
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid auth token")
    try:
        decoded = fb_auth.verify_id_token(token)
        return decoded["uid"]
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Token verification failed: {exc}")


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------


class CallRequest(BaseModel):
    contact_name: str  # e.g. "my son", "Carlos", "daughter"


# ---------------------------------------------------------------------------
# Twilio helpers
# ---------------------------------------------------------------------------


def _get_twilio_client():
    """Return a Twilio client if configured, else None."""
    sid = os.getenv("TWILIO_ACCOUNT_SID")
    token = os.getenv("TWILIO_AUTH_TOKEN")
    if not sid or not token:
        return None
    from twilio.rest import Client

    return Client(sid, token)


def _match_contact(profile: dict, contact_name: str) -> dict | None:
    """Fuzzy-match contact_name against the patient's emergency contact(s).

    Matches against name and relationship (case-insensitive substring).
    """
    ec = profile.get("emergency_contact")
    if not ec:
        return None

    # Support both single-contact dict and future array format
    contacts = ec if isinstance(ec, list) else [ec]

    name_lower = contact_name.lower()
    for c in contacts:
        c_name = c.get("name", "").lower()
        c_rel = c.get("relationship", "").lower()
        if name_lower in c_name or name_lower in c_rel or c_name in name_lower or c_rel in name_lower:
            return c

    return None


def _mask_phone(phone: str) -> str:
    """Mask a phone number for display: +1-555-0123 → +1-***-0123."""
    if len(phone) <= 4:
        return "****"
    return phone[:3] + "***" + phone[-4:]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/initiate")
async def initiate_call(
    body: CallRequest,
    authorization: str = Header(default=None),
):
    """Initiate a two-legged PSTN call between patient and family member.

    Leg 1: Twilio calls the patient's phone.
    Leg 2: When patient answers, TwiML <Dial> bridges to the family member.

    Returns: {call_sid, status, contact_name, contact_phone_masked}
    """
    uid = _verify_token(authorization)
    fs = FirestoreService.get_instance()

    if not fs.is_available:
        raise HTTPException(status_code=503, detail="Firestore unavailable")

    # Get patient profile to find contact + patient's own phone
    profile = await fs.get_patient_profile(uid) or {}

    # Match the requested contact
    contact = _match_contact(profile, body.contact_name)
    if not contact:
        raise HTTPException(
            status_code=404,
            detail=f"Contact '{body.contact_name}' not found in your emergency contacts.",
        )

    contact_phone = contact.get("phone", "")
    if not contact_phone:
        raise HTTPException(status_code=400, detail="Contact has no phone number.")

    # Get patient's own phone number (for Leg 1 — Twilio calls the patient)
    patient_phone = profile.get("phone", "")
    if not patient_phone:
        raise HTTPException(
            status_code=400,
            detail="Your phone number is not set in your profile. Please update your profile to enable calling.",
        )

    # Check Twilio config
    twilio_client = _get_twilio_client()
    if not twilio_client:
        raise HTTPException(
            status_code=503,
            detail="Calling service not configured. Please set up Twilio credentials.",
        )

    from_number = os.getenv("TWILIO_FROM_NUMBER", "")
    if not from_number:
        raise HTTPException(status_code=503, detail="Twilio phone number not configured.")

    # Build TwiML for Leg 2 — when patient picks up, bridge to family member
    twiml_url = (
        f"https://handler.twilio.com/twiml/EH"  # Twilio TwiML Bin placeholder
    )
    # For a production app, host a TwiML endpoint. For hackathon, use inline TwiML.
    twiml_xml = (
        f'<Response>'
        f'<Say voice="alice">Connecting you to {contact.get("name", "your family member")} now.</Say>'
        f'<Dial callerId="{from_number}">{contact_phone}</Dial>'
        f'</Response>'
    )

    try:
        call = twilio_client.calls.create(
            to=patient_phone,
            from_=from_number,
            twiml=twiml_xml,
        )
        call_sid = call.sid
        status = call.status
        logger.info(
            "Call initiated: sid=%s patient=%s contact=%s",
            call_sid, _mask_phone(patient_phone), _mask_phone(contact_phone),
        )
    except Exception as exc:
        logger.error("Twilio call failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to initiate call: {exc}")

    # Log the call
    try:
        from datetime import datetime, timezone

        await fs.add_call_log(uid, {
            "contact_name": contact.get("name", ""),
            "contact_phone": contact_phone,
            "call_sid": call_sid,
            "status": status,
            "initiated_at": datetime.now(timezone.utc).isoformat(),
            "reason": f"Voice request: {body.contact_name}",
        })
    except Exception:
        pass

@router.get("/twiml/reminder")
async def get_reminder_twiml(name: str = "there", type: str = "medication"):
    """Public endpoint for Twilio to fetch reminder instructions."""
    from fastapi.responses import Response
    
    msg = f"Hello {name}, this is Heali. Just a friendly reminder that it is time for your {type}."
    if type == "glucose":
        msg = f"Hi {name}, Heali here. Please remember to take your glucose test now."
    elif type == "meds":
        msg = f"Hello {name}, this is Heali. It is time for your medications."

    twiml = (
        f'<?xml version="1.0" encoding="UTF-8"?>'
        f'<Response>'
        f'<Pause length="1"/>'
        f'<Say voice="Polly.Amy-Neural" language="en-US">{msg}</Say>'
        f'<Pause length="1"/>'
        f'<Say voice="Polly.Amy-Neural" language="en-US">Take care and have a wonderful day.</Say>'
        f'</Response>'
    )
    return Response(content=twiml, media_type="application/xml")
