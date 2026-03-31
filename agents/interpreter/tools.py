"""Interpreter agent tools: prescription reading, report reading, text translation,
drug interaction checking, and visual symptom analysis.

All tools support Firestore (via tool_context) with mock_data.py fallback.
"""

import asyncio
import concurrent.futures
import json
import logging
import os
from datetime import datetime, timezone

from agents.shared.drug_service import check_interactions, normalize_drug_name
from agents.shared.firestore_service import FirestoreService
from agents.shared.mock_data import PRESCRIPTIONS, REPORTS
from agents.shared.ui_tools import emit_ui_update

logger = logging.getLogger(__name__)


def _run_async(coro):
    """Run a coroutine safely regardless of whether an event loop is already running."""
    try:
        asyncio.get_running_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(asyncio.run, coro)
            return future.result(timeout=30)
    except RuntimeError:
        return asyncio.run(coro)


def _get_user_id(tool_context) -> str:
    """Extract user_id from ADK tool_context, with fallback."""
    if tool_context and hasattr(tool_context, "state"):
        return tool_context.state.get("user_id", "demo_user")
    return "demo_user"


def _use_firestore(tool_context) -> bool:
    """Check if Firestore should be used for this call."""
    fs = FirestoreService.get_instance()
    return fs.is_available and tool_context is not None


async def read_prescription(image_description: str, tool_context=None) -> dict:
    """Extract medication information from a prescription shown via camera.

    The model describes what it sees in the camera image, and this tool
    structures the extracted information and stores it for future reference.

    Args:
        image_description: A description of the prescription as seen in the camera image.
    """
    now = datetime.now(timezone.utc).isoformat()
    user_id = _get_user_id(tool_context)

    # Build structured prescription from the model's description
    prescription_data = {
        "medications": [],
        "raw_description": image_description,
        "doctor_name": "",
        "date": "",
        "extracted_at": now,
        "source": "voice_camera",
    }

    # Store in Firestore or mock
    if _use_firestore(tool_context):
        fs = FirestoreService.get_instance()
        try:
            doc_id = await fs.add_prescription(user_id, prescription_data)
            prescription_data["doc_id"] = doc_id
        except Exception:
            pass
    else:
        PRESCRIPTIONS.append(prescription_data)

    return {
        "status": "extracted",
        "raw_description": image_description,
        "stored": True,
        "instructions": (
            "Please confirm the following with the patient: "
            "medication name, dosage, frequency, and any special instructions "
            "you read from the prescription or label. "
            "For more accurate extraction, the patient can also use the Scan button."
        ),
    }


async def read_report(image_description: str, tool_context=None) -> dict:
    """Extract test results from a lab report shown via camera.

    The model describes what it sees in the camera image, and this tool
    structures the extracted information and stores it for future reference.

    Args:
        image_description: A description of the lab report as seen in the camera image.
    """
    now = datetime.now(timezone.utc).isoformat()
    user_id = _get_user_id(tool_context)

    report_data = {
        "tests": [],
        "raw_description": image_description,
        "lab_name": "",
        "date": "",
        "extracted_at": now,
        "source": "voice_camera",
    }

    if _use_firestore(tool_context):
        fs = FirestoreService.get_instance()
        try:
            doc_id = await fs.add_report(user_id, report_data)
            report_data["doc_id"] = doc_id
        except Exception:
            pass
    else:
        REPORTS.append(report_data)

    return {
        "status": "extracted",
        "raw_description": image_description,
        "stored": True,
        "instructions": (
            "Please confirm the following with the patient: "
            "test names, values, and whether any results are outside the normal range. "
            "For more accurate extraction, the patient can also use the Scan button."
        ),
    }


def translate_text(text: str, source_language: str, target_language: str) -> dict:
    """Translate text between Hindi, Spanish, and English.

    Use this when the patient needs text from a prescription, label, or
    medical document translated to their preferred language.

    Args:
        text: The text to translate.
        source_language: The source language (e.g. 'English', 'Hindi', 'Spanish').
        target_language: The target language (e.g. 'English', 'Hindi', 'Spanish').
    """
    return {
        "status": "translate",
        "original_text": text,
        "source_language": source_language,
        "target_language": target_language,
        "instruction": (
            f"Please translate the following text from {source_language} "
            f"to {target_language} and speak it to the patient: {text}"
        ),
    }


async def check_drug_interactions(
    medication_names: list[str], tool_context=None
) -> dict:
    """Check for known drug interactions between a list of medications.

    Normalizes each drug name via RxNorm, checks the curated knowledge
    base first (instant, reliable), then supplements with OpenFDA drug
    label data for unknown pairs.

    Call this when a new prescription is scanned with multiple medications,
    or when the patient asks "can I take X with Y?"

    Args:
        medication_names: List of drug names to check pairwise interactions for.
    """
    if len(medication_names) < 2:
        return {
            "error": "Need at least two medications to check interactions.",
            "medications": medication_names,
        }

    normalized = []
    for name in medication_names:
        result = await normalize_drug_name(name)
        normalized.append(result.get("normalized_name", name))

    interaction_result = await check_interactions(medication_names)

    return {
        "medications_checked": medication_names,
        "normalized_names": normalized,
        **interaction_result,
    }


async def analyze_visual_symptom(
    image_description: str,
    body_area: str = "unspecified",
    patient_language: str = "English",
    tool_context=None,
) -> dict:
    """Analyze a visible symptom (rash, swelling, wound, discoloration) described from camera.

    The model describes what it sees via camera, and this tool provides structured
    analysis with culturally localized plain-language explanations.

    Args:
        image_description: Description of the visual symptom as seen by the model via camera.
        body_area: Body area where the symptom is observed (e.g. "left forearm", "face", "chest").
        patient_language: The patient's preferred language for the explanation.
    """
    now = datetime.now(timezone.utc).isoformat()
    user_id = _get_user_id(tool_context)

    # Use Gemini to analyze the visual symptom description
    from agents.shared.constants import ANALYSIS_MODEL

    prompt = (
        f"You are a clinical visual assessment assistant. A patient has shown a visible symptom "
        f"via camera. The model describes it as:\n\n"
        f"\"{image_description}\"\n\n"
        f"Body area: {body_area}\n"
        f"Patient language: {patient_language}\n\n"
        "Provide a structured assessment in JSON with these keys:\n"
        "- observation (string): What is visible, described in clinical terms\n"
        "- urgency (string): One of 'informational', 'monitor', 'seek-care', 'emergency'\n"
        "- possible_conditions (list of strings): 2-4 possible conditions (NOT diagnoses)\n"
        "- recommended_actions (list of strings): What the patient should do\n"
        "- plain_language_explanation (string): Simple explanation in the patient's language\n"
        "- disclaimer (string): Always include 'This is not a medical diagnosis. Please consult a healthcare provider.'\n\n"
        "IMPORTANT: You are NOT diagnosing. You are observing and suggesting possibilities. "
        "Always recommend professional medical evaluation."
    )

    analysis = {
        "observation": image_description,
        "urgency": "monitor",
        "possible_conditions": [],
        "recommended_actions": ["Consult a healthcare provider for proper evaluation"],
        "plain_language_explanation": "",
        "disclaimer": "This is not a medical diagnosis. Please consult a healthcare provider.",
    }

    try:
        from google import genai
        from google.genai import types as genai_types

        gcp_project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
        if gcp_project:
            client = genai.Client(
                vertexai=True,
                project=gcp_project,
                location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
            )
        else:
            client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY", ""))

        response = client.models.generate_content(
            model=ANALYSIS_MODEL,
            contents=[genai_types.Part.from_text(text=prompt)],
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2,
            ),
        )
        analysis = json.loads(response.text)
        # Ensure disclaimer is always present
        analysis["disclaimer"] = "This is not a medical diagnosis. Please consult a healthcare provider."
    except Exception as exc:
        logger.warning("Visual symptom LLM analysis failed: %s", exc)

    # Store as symptom entry
    symptom_entry = {
        "type": "visual_symptom",
        "body_area": body_area,
        "description": image_description,
        "observation": analysis.get("observation", ""),
        "urgency": analysis.get("urgency", "monitor"),
        "possible_conditions": analysis.get("possible_conditions", []),
        "timestamp": now,
        "date": now[:10],
    }

    if _use_firestore(tool_context):
        try:
            fs = FirestoreService.get_instance()
            await fs.add_symptom(user_id, symptom_entry)
        except Exception:
            pass

    # If urgency is emergency, trigger red alert
    if analysis.get("urgency") == "emergency":
        try:
            from agents.guardian.tools import initiate_emergency_protocol
            initiate_emergency_protocol(
                symptom_description=f"Visual emergency symptom on {body_area}: {image_description}",
                severity="red_line",
                tool_context=tool_context,
            )
        except Exception as exc:
            logger.warning("Failed to trigger emergency protocol from visual symptom: %s", exc)

    # Emit UI event
    emit_ui_update("visual_symptom_analysis", {
        "body_area": body_area,
        "urgency": analysis.get("urgency", "monitor"),
        "observation": analysis.get("observation", ""),
        "timestamp": now,
    }, tool_context)

    return {
        "status": "analyzed",
        "body_area": body_area,
        **analysis,
    }
