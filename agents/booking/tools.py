"""Booking agent tools: symptom triage, hospital lookup, slot availability, appointment booking.

All tools are async and non-blocking. Supports Firestore with mock_data.py fallback.
"""

import uuid
from datetime import datetime, timedelta, timezone

from agents.shared.firestore_service import FirestoreService
from agents.shared.mock_data import APPOINTMENTS
from agents.shared.constants import RED_LINE_KEYWORDS, NEGATION_PREFIXES

import re
import logging

logger = logging.getLogger("booking.tools")


# ---------------------------------------------------------------------------
# Helpers (same pattern as guardian/tools.py)
# ---------------------------------------------------------------------------

def _get_user_id(tool_context) -> str:
    """Extract user_id from ADK tool_context, with fallback."""
    if tool_context and hasattr(tool_context, "state"):
        return tool_context.state.get("user_id", "demo_user")
    return "demo_user"


def _use_firestore(tool_context) -> bool:
    """Check if Firestore should be used for this call."""
    fs = FirestoreService.get_instance()
    return fs.is_available and tool_context is not None


def _emit_ui(tool_context, target: str, data: dict):
    """Push a Generative UI event to a global queue for the frontend.
    
    Uses a module-level dict keyed by user_id, bypassing ADK session state
    which doesn't reliably propagate in run_live() mode.
    """
    uid = _get_user_id(tool_context)
    if uid not in BOOKING_UI_QUEUE:
        BOOKING_UI_QUEUE[uid] = []
    BOOKING_UI_QUEUE[uid].append({
        "type": "ui_update",
        "target": target,
        "data": data,
    })
    logger.info(f"[BOOKING UI] Queued '{target}' event for user {uid}")


# Global queue for booking UI events — keyed by user_id
BOOKING_UI_QUEUE: dict = {}


def _build_negation_pattern(keyword: str):
    """Build a regex that matches a negated form of a keyword."""
    neg_alts = "|".join(NEGATION_PREFIXES)
    return re.compile(rf"(?:{neg_alts}){re.escape(keyword)}", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Mock Data: Boston / Dorchester area clinics
# ---------------------------------------------------------------------------

# Hardcoded user location: Dorchester, MA
_USER_LAT, _USER_LNG = 42.2843, -71.0660

_HOSPITALS = {
    "codman_sq_health": {
        "hospital_id": "codman_sq_health",
        "name": "Codman Square Health Center",
        "address": "637 Washington St, Dorchester, MA 02124",
        "phone": "(617) 822-8271",
        "distance_miles": 0.8,
        "departments": ["general_physician", "urgent_care", "endocrinology", "cardiology"],
    },
    "bmc_primary": {
        "hospital_id": "bmc_primary",
        "name": "Boston Medical Center — Primary Care",
        "address": "725 Albany St, Boston, MA 02118",
        "phone": "(617) 638-8000",
        "distance_miles": 3.2,
        "departments": ["general_physician", "cardiology", "neurology", "orthopedics", "pulmonology", "gastroenterology"],
    },
    "dorchester_house": {
        "hospital_id": "dorchester_house",
        "name": "DotHouse Health",
        "address": "1353 Dorchester Ave, Dorchester, MA 02122",
        "phone": "(617) 288-3230",
        "distance_miles": 1.5,
        "departments": ["general_physician", "urgent_care", "dermatology"],
    },
    "beth_israel": {
        "hospital_id": "beth_israel",
        "name": "Beth Israel Deaconess Medical Center",
        "address": "330 Brookline Ave, Boston, MA 02215",
        "phone": "(617) 667-7000",
        "distance_miles": 5.1,
        "departments": ["cardiology", "neurology", "orthopedics", "endocrinology", "gastroenterology", "pulmonology"],
    },
}

# Department-to-keyword mapping for triage
_SYMPTOM_DEPARTMENT_MAP = {
    "cardiology": [
        "heart", "palpitation", "palpitations", "irregular heartbeat",
        "high blood pressure", "hypertension", "racing heart",
    ],
    "endocrinology": [
        "diabetes", "blood sugar", "thyroid", "insulin", "hormone",
        "weight gain unexplained", "excessive thirst",
    ],
    "orthopedics": [
        "joint", "knee", "hip", "shoulder", "back pain", "fracture",
        "sprain", "arthritis", "bone", "ankle", "wrist", "elbow",
    ],
    "neurology": [
        "migraine", "tremor", "memory loss", "confusion", "tingling",
        "nerve", "vertigo",
    ],
    "gastroenterology": [
        "stomach", "abdomen", "abdominal", "digestive", "diarrhea",
        "constipation", "acid reflux", "heartburn", "bloating", "nausea",
    ],
    "pulmonology": [
        "breathing", "asthma", "wheezing", "lung", "persistent cough",
        "shortness of breath",
    ],
    "dermatology": [
        "skin", "rash", "eczema", "acne", "itching", "mole", "lesion",
    ],
    "urgent_care": [
        "urgent", "fever", "infection", "cut", "wound", "burn",
        "vomiting", "food poisoning",
    ],
}


# ---------------------------------------------------------------------------
# Tool 1: Triage Symptoms
# ---------------------------------------------------------------------------

async def triage_symptoms(symptoms: str, tool_context=None) -> dict:
    """Analyze spoken symptoms to determine the appropriate department.

    Checks for RED LINE emergencies first. If an emergency is detected,
    returns is_emergency=True — the agent must NOT book and must route to
    the emergency protocol instead.

    Args:
        symptoms: The user's description of their symptoms.
    """
    symptoms_lower = symptoms.lower()
    logger.info(f"[BOOKING] triage_symptoms called with: {symptoms[:80]}")

    # 1. RED LINE check — deterministic safety
    for keyword in RED_LINE_KEYWORDS:
        if keyword in symptoms_lower:
            neg_pattern = _build_negation_pattern(keyword)
            if neg_pattern.search(symptoms_lower):
                continue  # negated
            _emit_ui(tool_context, "booking_emergency", {
                "keyword": keyword,
                "message": "This sounds like a medical emergency. Please call 911 immediately.",
            })
            return {
                "is_emergency": True,
                "matched_keyword": keyword,
                "department": "emergency",
                "urgency": "red_line",
                "reasoning": (
                    f"Detected emergency keyword '{keyword}'. "
                    "Do NOT book an appointment. Route to emergency protocol immediately."
                ),
            }

    # 2. Match symptoms to a specialist department
    best_department = "general_physician"
    best_score = 0
    matched_keyword = None

    for dept, keywords in _SYMPTOM_DEPARTMENT_MAP.items():
        for kw in keywords:
            if kw in symptoms_lower:
                # Score by keyword length (more specific = higher priority)
                score = len(kw)
                if score > best_score:
                    best_score = score
                    best_department = dept
                    matched_keyword = kw

    # Determine urgency
    urgent_words = ["severe", "intense", "extreme", "unbearable", "worst", "sudden", "acute"]
    urgency = "routine"
    for uw in urgent_words:
        if uw in symptoms_lower:
            urgency = "soon"
            break

    department_labels = {
        "general_physician": "General Physician",
        "urgent_care": "Urgent Care",
        "cardiology": "Cardiologist",
        "endocrinology": "Endocrinologist",
        "orthopedics": "Orthopedic Specialist",
        "neurology": "Neurologist",
        "gastroenterology": "Gastroenterologist",
        "pulmonology": "Pulmonologist",
        "dermatology": "Dermatologist",
    }

    return {
        "is_emergency": False,
        "department": best_department,
        "department_label": department_labels.get(best_department, best_department),
        "urgency": urgency,
        "matched_keyword": matched_keyword,
        "reasoning": (
            f"Based on the symptoms described, a {department_labels.get(best_department, best_department)} "
            f"would be the most appropriate. Urgency: {urgency}."
        ),
    }


# ---------------------------------------------------------------------------
# Tool 2: Find Nearby Hospitals
# ---------------------------------------------------------------------------

async def find_nearby_hospitals(department: str, tool_context=None) -> dict:
    """Find the 3 closest clinics/hospitals for the given department.

    Hardcoded to Dorchester, MA area. Returns realistic Boston-area clinics.

    Args:
        department: The department/specialty needed (e.g. 'general_physician', 'cardiology').
    """
    # Filter hospitals that have the requested department
    logger.info(f"[BOOKING] find_nearby_hospitals called with department: {department}")
    matching = []
    for h in _HOSPITALS.values():
        if department in h["departments"]:
            matching.append({
                "hospital_id": h["hospital_id"],
                "name": h["name"],
                "address": h["address"],
                "phone": h["phone"],
                "distance_miles": h["distance_miles"],
                "department": department,
            })

    # If no exact match, fall back to all hospitals (for general_physician)
    if not matching:
        for h in sorted(_HOSPITALS.values(), key=lambda x: x["distance_miles"]):
            matching.append({
                "hospital_id": h["hospital_id"],
                "name": h["name"],
                "address": h["address"],
                "phone": h["phone"],
                "distance_miles": h["distance_miles"],
                "department": "general_physician",
            })

    # Sort by distance, return top 3
    matching.sort(key=lambda x: x["distance_miles"])
    closest = matching[:3]

    _emit_ui(tool_context, "booking_hospitals", {
        "department": department,
        "hospitals": closest,
    })

    return {
        "location": "Dorchester, MA",
        "department": department,
        "hospitals": closest,
        "total_found": len(closest),
    }


# ---------------------------------------------------------------------------
# Tool 3: Get Available Slots
# ---------------------------------------------------------------------------

async def get_available_slots(hospital_id: str, tool_context=None) -> dict:
    """Return 2-3 available appointment time slots for the given hospital.

    Returns mock slots for tomorrow and the day after.

    Args:
        hospital_id: The ID of the hospital to check slots for.
    """
    hospital = _HOSPITALS.get(hospital_id)
    logger.info(f"[BOOKING] get_available_slots called for: {hospital_id}")
    if not hospital:
        return {"error": f"Unknown hospital: {hospital_id}", "slots": []}

    now = datetime.now(timezone.utc)
    tomorrow = now + timedelta(days=1)
    day_after = now + timedelta(days=2)

    # Generate mock slots based on hospital
    slot_templates = {
        "codman_sq_health": [
            {"time": "09:30 AM", "doctor": "Dr. Priya Sharma"},
            {"time": "02:00 PM", "doctor": "Dr. James Chen"},
            {"time": "11:00 AM", "doctor": "Dr. Priya Sharma"},
        ],
        "bmc_primary": [
            {"time": "10:00 AM", "doctor": "Dr. Michael Torres"},
            {"time": "03:30 PM", "doctor": "Dr. Anika Patel"},
        ],
        "dorchester_house": [
            {"time": "08:30 AM", "doctor": "Dr. Sarah Kim"},
            {"time": "01:00 PM", "doctor": "Dr. David Okafor"},
            {"time": "04:00 PM", "doctor": "Dr. Sarah Kim"},
        ],
        "beth_israel": [
            {"time": "11:30 AM", "doctor": "Dr. Elizabeth Warren-Hughes"},
            {"time": "02:30 PM", "doctor": "Dr. Rajesh Gupta"},
        ],
    }

    templates = slot_templates.get(hospital_id, [
        {"time": "10:00 AM", "doctor": "Dr. Smith"},
        {"time": "02:00 PM", "doctor": "Dr. Johnson"},
    ])

    slots = []
    dates = [tomorrow, day_after]
    for i, template in enumerate(templates[:3]):
        date = dates[i % len(dates)]
        slots.append({
            "slot_id": f"slot_{hospital_id}_{i+1}",
            "date": date.strftime("%A, %B %d, %Y"),
            "date_iso": date.strftime("%Y-%m-%d"),
            "time": template["time"],
            "doctor_name": template["doctor"],
        })

    _emit_ui(tool_context, "booking_slots", {
        "hospital_name": hospital["name"],
        "slots": slots,
    })

    return {
        "hospital_id": hospital_id,
        "hospital_name": hospital["name"],
        "slots": slots,
    }


# ---------------------------------------------------------------------------
# Tool 4: Book Appointment
# ---------------------------------------------------------------------------

async def book_appointment(
    hospital_id: str,
    time_slot_id: str,
    patient_uid: str = "",
    tool_context=None,
) -> dict:
    """Confirm and save an appointment booking.

    Saves the appointment to Firestore subcollection users/{uid}/appointments
    or to the in-memory mock data as fallback.

    Args:
        hospital_id: The ID of the hospital.
        time_slot_id: The ID of the selected time slot.
        patient_uid: The patient's user ID (falls back to tool_context).
    """
    uid = patient_uid or _get_user_id(tool_context)
    logger.info(f"[BOOKING] book_appointment called: hospital={hospital_id}, slot={time_slot_id}, uid={uid}")

    # Resolve hospital and slot info
    hospital = _HOSPITALS.get(hospital_id)
    if not hospital:
        return {"success": False, "error": f"Unknown hospital: {hospital_id}"}

    # Get the slot details
    slots_result = await get_available_slots(hospital_id, tool_context)
    selected_slot = None
    for slot in slots_result.get("slots", []):
        if slot["slot_id"] == time_slot_id:
            selected_slot = slot
            break

    if not selected_slot:
        return {"success": False, "error": f"Time slot {time_slot_id} not found for {hospital['name']}"}

    appointment_id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc)

    appointment = {
        "appointment_id": appointment_id,
        "hospital_id": hospital_id,
        "hospital_name": hospital["name"],
        "hospital_address": hospital["address"],
        "hospital_phone": hospital["phone"],
        "date": selected_slot["date"],
        "date_iso": selected_slot["date_iso"],
        "time": selected_slot["time"],
        "doctor_name": selected_slot["doctor_name"],
        "status": "confirmed",
        "booked_at": now.isoformat(),
        "patient_uid": uid,
    }

    # Persist
    if _use_firestore(tool_context):
        fs = FirestoreService.get_instance()
        await fs.add_appointment(uid, appointment)
    else:
        APPOINTMENTS.append(appointment)

    _emit_ui(tool_context, "booking_confirmed", appointment)

    return {
        "success": True,
        "appointment_id": appointment_id,
        "confirmation": (
            f"Your appointment is confirmed at {hospital['name']} "
            f"on {selected_slot['date']} at {selected_slot['time']} "
            f"with {selected_slot['doctor_name']}. "
            f"Address: {hospital['address']}. Phone: {hospital['phone']}."
        ),
        "appointment": appointment,
    }
