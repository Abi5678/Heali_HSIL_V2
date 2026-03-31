"""Family link code API — generate & verify 5-char codes for caregiver pairing."""

import logging
import os
import random
import string
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

import firebase_admin.auth as fb_auth
from agents.shared.firestore_service import FirestoreService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/family", tags=["family"])

# ---------------------------------------------------------------------------
# Helper: verify Firebase ID token → uid
# ---------------------------------------------------------------------------


def _skip_auth() -> bool:
    v = os.getenv("SKIP_AUTH_FOR_TESTING", "false").lower()
    return v in ("1", "true", "yes")


def _verify_token(authorization: str | None) -> str:
    """Extract and verify Firebase ID token from 'Bearer <token>' header."""
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


def _random_code(length: int = 5) -> str:
    """Generate a random N-char alphanumeric code (uppercase)."""
    chars = string.ascii_uppercase + string.digits
    return "".join(random.choices(chars, k=length))


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class VerifyCodeRequest(BaseModel):
    code: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/code/generate")
async def generate_family_code(authorization: str = Header(default=None)):
    """Generate a 5-char family link code for the authenticated parent.

    Stores the code in Firestore under `family_links/{code}` with a 24h TTL.
    Also writes `family_link_code` to the user's profile document.

    Returns: {"code": "A2B9X", "expires_at": "2025-..."}
    """
    uid = _verify_token(authorization)
    fs = FirestoreService.get_instance()

    if not fs.is_available:
        raise HTTPException(status_code=503, detail="Firestore unavailable")

    # Get parent name from existing profile (for caregiver display)
    profile = await fs.get_patient_profile(uid) or {}
    parent_name = profile.get("companion_name", "")

    code = await fs.create_family_link(uid, parent_name)

    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    return {
        "code": code,
        "expires_at": expires_at.isoformat(),
    }


@router.post("/code/verify")
async def verify_family_code(
    body: VerifyCodeRequest,
    authorization: str = Header(default=None),
):
    """Verify a family link code as a caregiver.

    Links the caregiver's UID to the parent's profile.

    Returns: {"parent_name": "...", "linked": true}
    """
    uid = _verify_token(authorization)
    fs = FirestoreService.get_instance()

    if not fs.is_available:
        raise HTTPException(status_code=503, detail="Firestore unavailable")

    try:
        result = await fs.verify_family_link(body.code.upper(), uid)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
