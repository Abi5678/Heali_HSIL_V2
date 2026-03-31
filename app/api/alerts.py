"""Safety Alert API — CHW notification webhook + alert history audit trail."""

import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from agents.shared.firestore_service import FirestoreService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


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
        import firebase_admin.auth as fb_auth
        decoded = fb_auth.verify_id_token(token)
        return decoded["uid"]
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Token verification failed: {exc}")


# ---------------------------------------------------------------------------
# GET /api/alerts/history — Safety alert audit trail
# ---------------------------------------------------------------------------

@router.get("/history")
async def get_alert_history(
    patient_uid: str | None = None,
    tier: str | None = None,
    since: str | None = None,
    authorization: str | None = Header(None),
):
    """Return safety alert audit trail for a patient."""
    uid = _verify_token(authorization)
    patient_uid = patient_uid or uid

    fs = FirestoreService.get_instance()
    logs = await fs.get_safety_logs(patient_uid, since_date=since, tier=tier)
    return {"alerts": logs, "count": len(logs)}


# ---------------------------------------------------------------------------
# POST /api/alerts/chw — Community Health Worker notification webhook
# ---------------------------------------------------------------------------

class CHWNotification(BaseModel):
    patient_uid: str
    alert_tier: str
    symptoms: str
    message: str | None = None


@router.post("/chw")
async def notify_chw(
    body: CHWNotification,
    authorization: str | None = Header(None),
):
    """Receive a CHW notification webhook for a safety alert.

    In production this would forward to an SMS/WhatsApp gateway.
    For the hackathon demo, we log and return success.
    """
    _verify_token(authorization)

    logger.info(
        "CHW notification: patient=%s tier=%s symptoms=%s",
        body.patient_uid, body.alert_tier, body.symptoms,
    )

    # In a real deployment, this would call Twilio/WhatsApp API
    return {
        "status": "sent",
        "channel": "demo_log",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": f"CHW notified about {body.alert_tier} alert for patient {body.patient_uid}",
    }
