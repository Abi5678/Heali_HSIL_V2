"""Prescription & Lab Report scanning API using Gemini Vision.

For prescriptions, extracted medications are enriched with drug interaction
data from RxNorm (name normalization) and OpenFDA (interactions/warnings).
"""

import asyncio
import base64
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

import firebase_admin.auth as fb_auth
from google import genai
from google.genai import types as genai_types

from agents.shared.constants import ANALYSIS_MODEL
from agents.shared.drug_service import check_interactions, get_drug_info, normalize_drug_name
from agents.shared.firestore_service import FirestoreService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scan", tags=["scan"])

# ---------------------------------------------------------------------------
# Auth helper (same pattern as family.py)
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
# Gemini client (non-Vertex, uses API key)
# ---------------------------------------------------------------------------

_genai_client: genai.Client | None = None


def _get_genai_client() -> genai.Client:
    """Always prefer Vertex AI for scan operations to avoid free-tier rate limits."""
    global _genai_client
    if _genai_client is None:
        gcp_project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
        if gcp_project:
            _genai_client = genai.Client(
                vertexai=True,
                project=gcp_project,
                location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
            )
        else:
            _genai_client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY", ""))
    return _genai_client


# ---------------------------------------------------------------------------
# Extraction prompts
# ---------------------------------------------------------------------------

PRESCRIPTION_PROMPT = (
    "You are a medical document scanner. Extract ALL medication details from this "
    "prescription image. For each medication found, extract:\n"
    "- name: the drug/medication name\n"
    "- dosage: strength (e.g. '500mg', '10mg')\n"
    "- frequency: how often to take (e.g. 'twice daily', 'once daily')\n"
    "- route: how to take it (e.g. 'oral', 'topical', 'injection'). Default 'oral' if not specified.\n\n"
    "Also extract:\n"
    "- doctor_name: prescribing doctor's name (or empty string if not visible)\n"
    "- date: prescription date in YYYY-MM-DD format (or empty string if not visible)\n\n"
    "Return ONLY valid JSON matching the schema. If no medications found, return empty medications array."
)

PILL_PROMPT = (
    "You are a pharmaceutical identification expert. Analyze this image of a pill or tablet. "
    "Identify:\n"
    "- pill_name: the most likely medication name based on visual characteristics\n"
    "- color: the color(s) of the pill (e.g. 'white', 'pink and white', 'yellow')\n"
    "- shape: pill shape (e.g. 'round', 'oval', 'oblong', 'capsule')\n"
    "- imprint: any text, numbers, or markings imprinted on the pill surface (empty string if none visible)\n"
    "- notes: any other identifying features (coating, scored, etc.)\n"
    "Return ONLY valid JSON matching the schema."
)

REPORT_PROMPT = (
    "You are a medical document scanner. Extract ALL test results from this lab report image. "
    "For each test found, extract:\n"
    "- name: test name (e.g. 'Hemoglobin', 'Blood Glucose', 'HbA1c')\n"
    "- value: the measured value as a string (e.g. '145', '6.5', '130/85')\n"
    "- unit: measurement unit (e.g. 'mg/dL', '%', 'mmHg')\n"
    "- reference_range: normal range (e.g. '70-100', '4.0-5.6'). Empty string if not visible.\n"
    "- status: 'normal', 'high', 'low', or 'unknown' based on reference range\n\n"
    "Also extract:\n"
    "- lab_name: laboratory name (or empty string if not visible)\n"
    "- date: report date in YYYY-MM-DD format (or empty string if not visible)\n\n"
    "Return ONLY valid JSON matching the schema. If no tests found, return empty tests array."
)

# ---------------------------------------------------------------------------
# Response schemas (for response_mime_type="application/json")
# ---------------------------------------------------------------------------

PRESCRIPTION_SCHEMA = genai_types.Schema(
    type="OBJECT",
    properties={
        "medications": genai_types.Schema(
            type="ARRAY",
            items=genai_types.Schema(
                type="OBJECT",
                properties={
                    "name": genai_types.Schema(type="STRING"),
                    "dosage": genai_types.Schema(type="STRING"),
                    "frequency": genai_types.Schema(type="STRING"),
                    "route": genai_types.Schema(type="STRING"),
                },
                required=["name", "dosage", "frequency", "route"],
            ),
        ),
        "doctor_name": genai_types.Schema(type="STRING"),
        "date": genai_types.Schema(type="STRING"),
    },
    required=["medications", "doctor_name", "date"],
)

REPORT_SCHEMA = genai_types.Schema(
    type="OBJECT",
    properties={
        "tests": genai_types.Schema(
            type="ARRAY",
            items=genai_types.Schema(
                type="OBJECT",
                properties={
                    "name": genai_types.Schema(type="STRING"),
                    "value": genai_types.Schema(type="STRING"),
                    "unit": genai_types.Schema(type="STRING"),
                    "reference_range": genai_types.Schema(type="STRING"),
                    "status": genai_types.Schema(type="STRING"),
                },
                required=["name", "value", "unit", "reference_range", "status"],
            ),
        ),
        "lab_name": genai_types.Schema(type="STRING"),
        "date": genai_types.Schema(type="STRING"),
    },
    required=["tests", "lab_name", "date"],
)

PILL_SCHEMA = genai_types.Schema(
    type="OBJECT",
    properties={
        "pill_name": genai_types.Schema(type="STRING"),
        "color":     genai_types.Schema(type="STRING"),
        "shape":     genai_types.Schema(type="STRING"),
        "imprint":   genai_types.Schema(type="STRING"),
        "notes":     genai_types.Schema(type="STRING"),
    },
    required=["pill_name", "color", "shape", "imprint", "notes"],
)

# ---------------------------------------------------------------------------
# AI summary generation
# ---------------------------------------------------------------------------


async def generate_summary(extracted: dict, scan_type: str) -> dict:
    """Generate a 2-sentence patient-friendly summary + 3–5 key insights."""
    client = _get_genai_client()

    if scan_type == "prescription":
        meds = extracted.get("medications", [])
        med_lines = "\n".join(
            f"- {m['name']} {m.get('dosage', '')} {m.get('frequency', '')} "
            f"(class: {m.get('drug_class', 'unknown')})"
            for m in meds
        )
        interactions = extracted.get("drug_interactions", [])
        ix_lines = "\n".join(
            f"- {i.get('drug1', '?')} + {i.get('drug2', '?')}: {i.get('description', '')}"
            for i in interactions
            if i.get("severity") not in ("none", "")
        )
        prompt = (
            f"Prescription scanned.\n"
            f"Doctor: {extracted.get('doctor_name', 'unknown')}\n"
            f"Date: {extracted.get('date', 'unknown')}\n"
            f"Medications:\n{med_lines or 'None'}\n"
            f"Interactions:\n{ix_lines or 'None flagged'}\n\n"
            f"Write a 2-sentence patient-friendly summary, then 3–5 key insights "
            f"(what to watch for, side effects, interaction risks, food restrictions, timing tips). "
            f'Reply as JSON: {{"summary": "...", "insights": ["...", ...]}}'
        )
    else:
        tests = extracted.get("tests", [])
        abnormal = [t for t in tests if t.get("status") in ("high", "low")]
        normal_count = sum(1 for t in tests if t.get("status") == "normal")
        ab_lines = "\n".join(
            f"- {t['name']}: {t['value']} {t.get('unit', '')} [{t['status'].upper()}] "
            f"(range: {t.get('reference_range', '')})"
            for t in abnormal
        ) or "All within range"
        prompt = (
            f"Lab report scanned.\n"
            f"Lab: {extracted.get('lab_name', 'unknown')}\n"
            f"Date: {extracted.get('date', 'unknown')}\n"
            f"Tests: {len(tests)} total, {normal_count} normal, {len(abnormal)} abnormal\n"
            f"Abnormal:\n{ab_lines}\n\n"
            f"Write a 2-sentence patient-friendly summary, then 3–5 key insights "
            f"(which values need attention, what they might indicate, when to see a doctor). "
            f'Reply as JSON: {{"summary": "...", "insights": ["...", ...]}}'
        )

    try:
        resp = client.models.generate_content(
            model=ANALYSIS_MODEL,
            contents=[genai_types.Part.from_text(text=prompt)],
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.3,
            ),
        )
        import json as _json
        result = _json.loads(resp.text)
        return {"summary": result.get("summary", ""), "insights": result.get("insights", [])}
    except Exception as exc:
        logger.warning("Summary generation failed (non-blocking): %s", exc)
        return {"summary": "", "insights": []}


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------


class ScanRequest(BaseModel):
    image_b64: str
    scan_type: str  # "prescription" or "report"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/history")
async def get_scan_history(uid: str, authorization: str = Header(default=None)):
    """Returns all saved prescriptions and lab reports for a user."""
    _verify_token(authorization)
    try:
        from agents.shared.firestore_service import FirestoreService
        fs = FirestoreService.get_instance()
        if not fs.is_available:
            return {"prescriptions": [], "reports": []}
        prescriptions = await fs.get_prescriptions(uid)
        reports = await fs.get_reports(uid)
        return {"prescriptions": prescriptions, "reports": reports}
    except Exception as exc:
        logger.error("Error fetching scan history: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("")
async def scan_document(
    body: ScanRequest,
    authorization: str = Header(default=None),
):
    """Scan a prescription or lab report image using Gemini Vision.

    Extracts structured data and stores it in Firestore.

    Returns: extracted data dict with medications or test results.
    """
    uid = _verify_token(authorization)

    if body.scan_type not in ("prescription", "report", "pill"):
        raise HTTPException(status_code=400, detail="scan_type must be 'prescription', 'report', or 'pill'")

    # Decode image
    try:
        image_bytes = base64.b64decode(body.image_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    if len(image_bytes) > 5_000_000:  # 5MB safety limit
        raise HTTPException(status_code=400, detail="Image too large (max 5MB)")

    # Select prompt + schema based on scan type
    if body.scan_type == "prescription":
        prompt = PRESCRIPTION_PROMPT
        schema = PRESCRIPTION_SCHEMA
    elif body.scan_type == "pill":
        prompt = PILL_PROMPT
        schema = PILL_SCHEMA
    else:
        prompt = REPORT_PROMPT
        schema = REPORT_SCHEMA

    # Call Gemini Vision
    try:
        client = _get_genai_client()
        response = client.models.generate_content(
            model=ANALYSIS_MODEL,
            contents=[
                genai_types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                genai_types.Part.from_text(text=prompt),
            ],
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema,
                temperature=0.1,  # Low temp for accurate extraction
            ),
        )
    except Exception as exc:
        logger.error("Gemini Vision scan failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Document scan failed: {exc}")

    # Parse response
    import json

    try:
        extracted = json.loads(response.text)
    except (json.JSONDecodeError, AttributeError) as exc:
        logger.error("Failed to parse Gemini response: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to parse scan results")

    # Add metadata
    extracted["extracted_at"] = datetime.now(timezone.utc).isoformat()
    extracted["scan_type"] = body.scan_type

    # --- Drug enrichment for prescriptions ---
    if body.scan_type == "prescription" and extracted.get("medications"):
        med_names = [m["name"] for m in extracted["medications"] if m.get("name")]
        try:
            norm_tasks = [normalize_drug_name(n) for n in med_names]
            info_tasks = [get_drug_info(n) for n in med_names]
            norm_results, info_results = await asyncio.gather(
                asyncio.gather(*norm_tasks, return_exceptions=True),
                asyncio.gather(*info_tasks, return_exceptions=True),
            )
            for i, med in enumerate(extracted["medications"]):
                if i < len(norm_results) and not isinstance(norm_results[i], Exception):
                    med["normalized_name"] = norm_results[i].get("normalized_name", med["name"])
                if i < len(info_results) and not isinstance(info_results[i], Exception):
                    drug_info = info_results[i]
                    med["drug_class"] = drug_info.get("drug_class", "")
                    med["side_effects"] = drug_info.get("common_side_effects", drug_info.get("adverse_reactions", []))
                    med["warnings"] = drug_info.get("warnings", "")

            if len(med_names) >= 2:
                interaction_result = await check_interactions(med_names)
                extracted["drug_interactions"] = interaction_result.get("interactions", [])

            # Cross-reference with patient's existing medications
            fs_check = FirestoreService.get_instance()
            if fs_check.is_available:
                existing_meds = await fs_check.get_medications(uid)
                existing_names = [m["name"] for m in existing_meds]
                all_names = list(set(med_names + existing_names))
                if len(all_names) > len(med_names):
                    cross_result = await check_interactions(all_names)
                    extracted["cross_medication_interactions"] = cross_result.get("interactions", [])
        except Exception as exc:
            logger.warning("Drug enrichment failed (non-blocking): %s", exc)

    # --- Pill identification + medication comparison ---
    if body.scan_type == "pill":
        from fastapi.responses import JSONResponse as _JSONResponse
        fs_pill = FirestoreService.get_instance()
        medications = await fs_pill.get_medications(uid) if fs_pill.is_available else []

        color = extracted.get("color", "").lower()
        shape = extracted.get("shape", "").lower()
        imprint = extracted.get("imprint", "").lower()
        pill_name = extracted.get("pill_name", "")

        matches = []
        for med in medications:
            desc = med.get("pill_description") or {}
            if (desc.get("color", "").lower() == color and
                    desc.get("shape", "").lower() == shape):
                matches.append(med["name"])
            elif pill_name and pill_name.lower() in med["name"].lower():
                matches.append(med["name"])

        verified = len(matches) > 0
        message = (
            f"This pill matches: {', '.join(matches)}. It is safe to take."
            if verified
            else "WARNING: This pill does NOT match any of your prescribed medications."
        )
        return _JSONResponse({
            "verified": verified,
            "pill_name": pill_name,
            "color": color,
            "shape": shape,
            "imprint": imprint,
            "matched_medications": matches,
            "confidence": "high" if imprint else "medium",
            "message": message,
            "ai_summary": message,
            "insights": [f"Identified as: {pill_name}", f"Color: {color}, Shape: {shape}"]
                        + ([f"Imprint: {imprint}"] if imprint else []),
        })

    # AI narrative summary + key insights
    ai = await generate_summary(extracted, body.scan_type)
    extracted["summary"] = ai["summary"]
    extracted["insights"] = ai["insights"]

    # Store in Firestore
    fs = FirestoreService.get_instance()
    doc_id = None
    if fs.is_available:
        try:
            if body.scan_type == "prescription":
                doc_id = await fs.add_prescription(uid, extracted)
            else:
                doc_id = await fs.add_report(uid, extracted)
            logger.info("Scan stored: type=%s uid=%s doc_id=%s", body.scan_type, uid, doc_id)
        except Exception as exc:
            logger.warning("Failed to store scan result: %s", exc)

    extracted["doc_id"] = doc_id
    return extracted
