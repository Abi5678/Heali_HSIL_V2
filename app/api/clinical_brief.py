"""Clinical Brief API — structured clinical summaries + FHIR R4 export + risk score."""

import logging
import os

from fastapi import APIRouter, Header, HTTPException, Query

from agents.clinical_brief.tools import generate_clinical_brief, convert_to_fhir_r4

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/clinical-brief", tags=["clinical-brief"])


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
# GET /api/clinical-brief/{user_id} — Clinical brief (JSON or FHIR)
# ---------------------------------------------------------------------------

@router.get("/{user_id}")
async def get_clinical_brief(
    user_id: str,
    format: str = Query("json", description="Output format: json or fhir"),
    days: int = Query(7, description="Number of days to summarize"),
    authorization: str | None = Header(None),
):
    """Generate a clinical brief for the patient."""
    _verify_token(authorization)

    brief = await generate_clinical_brief(user_id, days=days)

    if format == "fhir":
        return convert_to_fhir_r4(brief)

    return brief


# ---------------------------------------------------------------------------
# GET /api/clinical-brief/{user_id}/risk — Re-hospitalization risk score
# ---------------------------------------------------------------------------

@router.get("/{user_id}/risk")
async def get_risk_score(
    user_id: str,
    days: int = Query(30, description="Number of days to analyze"),
    authorization: str | None = Header(None),
):
    """Get 30-day re-hospitalization risk score for a patient."""
    _verify_token(authorization)

    from agents.insights.tools import get_rehospitalization_risk
    result = await get_rehospitalization_risk(user_id=user_id, days=days)
    return result
