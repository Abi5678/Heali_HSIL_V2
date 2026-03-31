"""Guardian agent tools: medication management, pill verification, vitals, meals,
emergency detection and protocol.

All tools support Firestore (via tool_context) with mock_data.py fallback.
"""

import asyncio
import concurrent.futures
import logging
import os
import re
from datetime import datetime, timedelta, timezone


def _run_async(coro):
    """Run a coroutine safely regardless of whether an event loop is already running."""
    try:
        asyncio.get_running_loop()
        # Already inside a running loop — offload to a dedicated thread with its own loop
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(asyncio.run, coro)
            return future.result(timeout=30)
    except RuntimeError:
        return asyncio.run(coro)

from agents.shared.firestore_service import FirestoreService
from agents.shared.mock_data import (
    ADHERENCE_LOG, MEDICATIONS, MEALS_LOG, VITALS_LOG,
    EMERGENCY_INCIDENTS, CALL_LOGS, PATIENT_PROFILE,
)
from agents.shared.constants import (
    RED_LINE_KEYWORDS,
    NEGATION_PREFIXES,
    RED_LINE_RESPONSE,
    EMERGENCY_NUMBERS,
)
from agents.shared.ui_tools import emit_ui_update


def _get_user_id(tool_context) -> str:
    """Extract user_id from ADK tool_context, with fallback."""
    if tool_context and hasattr(tool_context, "state"):
        return tool_context.state.get("user_id", "demo_user")
    return "demo_user"


def _use_firestore(tool_context) -> bool:
    """Check if Firestore should be used for this call."""
    fs = FirestoreService.get_instance()
    return fs.is_available and tool_context is not None


def get_medication_schedule(tool_context=None) -> dict:
    """Get today's medication schedule for the patient."""
    today = datetime.now().strftime("%Y-%m-%d")

    if _use_firestore(tool_context):
        user_id = _get_user_id(tool_context)
        fs = FirestoreService.get_instance()
        medications = fs.get_medications_sync(user_id)
        adherence = fs.get_adherence_log_sync(user_id, since_date=today)
    else:
        medications = MEDICATIONS
        adherence = [e for e in ADHERENCE_LOG if e["date"] == today]

    schedule = []
    for med in medications:
        # Firestore stores "dose_times"; mock data uses "times"
        times = med.get("dose_times") or med.get("times") or []
        for t in times:
            taken_entry = next(
                (
                    e
                    for e in adherence
                    if e["date"] == today
                    and e["medication"] == med["name"]
                    and e["time"] == t
                ),
                None,
            )
            schedule.append(
                {
                    "medication": med.get("name", "Unknown"),
                    "dosage": med.get("dosage", ""),
                    "scheduled_time": t,
                    "purpose": med.get("purpose", ""),
                    "taken": taken_entry["taken"] if taken_entry else False,
                }
            )
    return {"date": today, "schedule": schedule}


def log_medication_schedule(
    medication_name: str, 
    schedule_type: str, 
    dose_times: list[str], 
    rxnorm_id: str = "", 
    tool_context=None
) -> dict:
    """Log a new medication schedule and setup proactive reminders.

    Args:
        medication_name: The name of the medication (e.g., 'Aspirin', 'Metformin').
        schedule_type: Frequency, e.g., 'Daily', 'Weekly', 'PRN' (as needed).
        dose_times: List of times in format HH:MM (e.g., ['08:00', '20:00']).
        rxnorm_id: Optional RxNorm code for the drug (e.g., '1191').
    """
    user_id = _get_user_id(tool_context)
    
    if _use_firestore(tool_context):
        fs = FirestoreService.get_instance()
        try:
            fs.add_medication_sync(user_id, medication_name, schedule_type, dose_times, rxnorm_id)
        except Exception as exc:
            return {"success": False, "error": f"Failed to save to database {exc}"}
    else:
        # Mock logic fallback
        MEDICATIONS.append({
            "name": medication_name,
            "dosage": "Unknown",
            "purpose": "Unknown",
            "times": dose_times,
            "pill_description": {"color": "unknown", "shape": "unknown", "imprint": "none"}
        })

    # Schedule proactive reminders using Cloud Tasks
    from agents.shared.tasks_service import TasksService
    reminders = []
    
    # We only schedule automatic reminders for concrete times; skip PRN
    if schedule_type.lower() != "prn":
        for dose_time in dose_times:
            task_id = TasksService.schedule_reminder(user_id, medication_name, dose_time, rxnorm_id)
            if task_id:
                reminders.append(dose_time)
            
    emit_ui_update(
        "medication_logged",
        {"name": medication_name, "schedule": schedule_type},
        tool_context,
    )

    return {
        "success": True,
        "message": f"Medication '{medication_name}' logged successfully for {schedule_type} schedule.",
        "reminders_scheduled_for": reminders if reminders else "None (Mock or PRN mode)"
    }


def log_medication_taken(medication_name: str, tool_context=None) -> dict:
    """Log that the patient has taken a specific medication.

    Args:
        medication_name: The name of the medication that was taken (e.g. 'Metformin').
    """
    today = datetime.now().strftime("%Y-%m-%d")
    now_time = datetime.now().strftime("%H:%M")

    if _use_firestore(tool_context):
        user_id = _get_user_id(tool_context)
        fs = FirestoreService.get_instance()
        medications = fs.get_medications_sync(user_id)
    else:
        medications = MEDICATIONS

    med = next(
        (m for m in medications if m["name"].lower() == medication_name.lower()),
        None,
    )
    if not med:
        return {
            "success": False,
            "error": f"Medication '{medication_name}' not found in records.",
        }

    entry = {
        "date": today,
        "medication": med["name"],
        "time": now_time,
        "taken": True,
    }

    if _use_firestore(tool_context):
        fs.add_adherence_entry_sync(user_id, entry)
    else:
        ADHERENCE_LOG.append(entry)

    emit_ui_update(
        "medication_taken",
        {"medication": med["name"], "time": now_time},
        tool_context,
    )

    return {
        "success": True,
        "medication": med["name"],
        "dosage": med.get("dosage", ""),
        "logged_at": now_time,
    }


def verify_pill(
    pill_color: str, pill_shape: str, pill_imprint: str = "", tool_context=None
) -> dict:
    """Verify a pill shown by the patient against their medication records.

    Compare the visual description of a pill against known medications to check
    if it matches. This is a critical safety tool.

    Args:
        pill_color: The color of the pill (e.g. 'white', 'pink', 'green').
        pill_shape: The shape of the pill (e.g. 'round', 'oval', 'oblong').
        pill_imprint: Any text or numbers imprinted on the pill (e.g. '500', 'L10').
    """
    if _use_firestore(tool_context):
        user_id = _get_user_id(tool_context)
        fs = FirestoreService.get_instance()
        medications = fs.get_medications_sync(user_id)
    else:
        medications = MEDICATIONS

    matches = []
    for med in medications:
        desc = med.get("pill_description") or {}
        color_match = desc["color"].lower() == pill_color.lower()
        shape_match = desc["shape"].lower() == pill_shape.lower()
        imprint_match = (
            not pill_imprint or desc["imprint"].lower() == pill_imprint.lower()
        )
        if color_match and shape_match and imprint_match:
            matches.append(
                {
                    "medication": med["name"],
                    "dosage": med.get("dosage", ""),
                    "expected_description": desc,
                    "match": True,
                    "confidence": "high" if pill_imprint else "medium",
                }
            )
    if matches:
        emit_ui_update(
            "pill_verified",
            {
                "verified": True,
                "matches": matches,
                "message": f"Verified: {', '.join(str(m['medication']) for m in matches)}"
            },
            tool_context
        )
        return {
            "verified": True,
            "matches": matches,
            "message": (
                f"This pill matches: {', '.join(str(m['medication']) for m in matches)}. "
                "It is safe to take."
            ),
        }
        
    emit_ui_update(
        "pill_verified",
        {
            "verified": False,
            "pill_described": {
                "color": pill_color,
                "shape": pill_shape,
                "imprint": pill_imprint,
            },
            "message": "WARNING: Pill mismatch!"
        },
        tool_context
    )
    return {
        "verified": False,
        "matches": [],
        "pill_described": {
            "color": pill_color,
            "shape": pill_shape,
            "imprint": pill_imprint,
        },
        "known_medications": [
            {"name": m["name"], "expected": m["pill_description"]}
            for m in medications
        ],
        "message": (
            "WARNING: This pill does NOT match any of your prescribed medications. "
            "Do NOT take it. Please consult your doctor or pharmacist."
        ),
    }


def log_vitals(
    vital_type: str, value: str, unit: str = "", tool_context=None
) -> dict:
    """Record a vital sign measurement for the patient.

    Args:
        vital_type: The type of vital sign (e.g. 'blood_pressure', 'blood_sugar', 'weight').
        value: The measured value (e.g. '130/82', '125', '68.5').
        unit: The unit of measurement (e.g. 'mmHg', 'mg/dL', 'kg'). Optional.
    """
    if not unit:
        if vital_type in ("blood_pressure", "bloodpressure"):
            unit = "mmHg"
        elif vital_type in ("blood_sugar", "bloodsugar", "glucose"):
            unit = "mg/dL"

    today = datetime.now().strftime("%Y-%m-%d")
    now_time = datetime.now().strftime("%H:%M")

    entry = {
        "date": today,
        "time": now_time,
        "type": vital_type,
        "value": value,
        "unit": unit,
        "source": "voice_log",
    }

    if _use_firestore(tool_context):
        user_id = _get_user_id(tool_context)
        fs = FirestoreService.get_instance()
        fs.add_vitals_entry_sync(user_id, entry)
    else:
        VITALS_LOG.append(entry)

    # --- Phase 4 Power Feature: Real-time Vital Adjustment ---
    # If the patient logs an unhealthily high/low blood sugar or CGM glucose,
    # we intercept the standard response and inject a SYSTEM DIRECTIVE.
    directive = ""
    if vital_type.lower() in ("blood_sugar", "bloodsugar", "glucose", "glucose_cgm"):
        try:
            numeric_val = float(value)
            if numeric_val < 54:
                directive = (
                    f"\n\n[SYSTEM DIRECTIVE – RED ALERT: The patient's glucose is "
                    f"DANGEROUSLY LOW at {numeric_val} mg/dL (severe hypoglycemia). "
                    f"IMMEDIATELY tell them to eat fast-acting sugar (juice, glucose "
                    f"tablets, candy) NOW. If they cannot eat, call emergency services. "
                    f"This is a medical emergency.]"
                )
            elif numeric_val < 70:
                directive = (
                    f"\n\n[SYSTEM DIRECTIVE – AMBER ALERT: The patient's glucose is "
                    f"LOW at {numeric_val} mg/dL (hypoglycemia). Express concern and "
                    f"urge them to eat a snack with fast-acting carbohydrates immediately.]"
                )
            elif numeric_val > 400:
                directive = (
                    f"\n\n[SYSTEM DIRECTIVE – RED ALERT: The patient's glucose is "
                    f"DANGEROUSLY HIGH at {numeric_val} mg/dL (severe hyperglycemia). "
                    f"IMMEDIATELY advise them to seek medical care. Check for ketones "
                    f"if possible. This is a medical emergency.]"
                )
            elif numeric_val > 250:
                directive = (
                    f"\n\n[SYSTEM DIRECTIVE – AMBER ALERT: The patient's glucose is "
                    f"VERY HIGH at {numeric_val} mg/dL (hyperglycemia). Express concern, "
                    f"ask if they've taken their insulin/medication, and recommend staying "
                    f"hydrated. Suggest contacting their doctor.]"
                )
            elif numeric_val > 180:
                directive = (
                    f"\n\n[SYSTEM DIRECTIVE: The patient just logged a HIGH "
                    f"blood sugar of {numeric_val}. You must IMMEDIATELY "
                    f"express gentle concern and proactively offer to fetch "
                    f"a low-glycemic recipe using the Insights agent to help "
                    f"them stabilize, or ask if they need to contact their doctor.]"
                )
        except ValueError:
            pass

    emit_ui_update(
        "vital_logged",
        {"type": vital_type, "value": value, "unit": unit},
        tool_context,
    )

    return {
        "success": True,
        "vital_type": vital_type,
        "value": value,
        "recorded": entry,
        "recorded_at": f"{today} {now_time}",
        "message": f"Vital sign logged.{directive}"
    }


def get_cgm_status(tool_context=None) -> dict:
    """Get the patient's current CGM (Continuous Glucose Monitor) reading and trend.

    Returns the latest glucose reading, trend direction, and time-in-range
    from connected Dexcom or FreeStyle Libre devices.
    """
    from agents.shared.wearable_service import WearableService

    ws = WearableService.get_instance()

    if _use_firestore(tool_context):
        user_id = _get_user_id(tool_context)
        fs = FirestoreService.get_instance()
        readings = _run_async(fs.get_cgm_readings(user_id))
    else:
        readings = [v for v in VITALS_LOG if v.get("type") == "glucose_cgm"]

    if not readings:
        return {
            "available": False,
            "message": "No CGM device connected or no readings available.",
        }

    latest = readings[-1]
    trend_arrow = ws.calculate_trend_arrow(readings[-6:] if len(readings) >= 6 else readings)
    time_in_range = ws.calculate_time_in_range(readings)

    glucose_val = float(latest["value"])
    status = "normal"
    if glucose_val < 70:
        status = "low"
    elif glucose_val > 180:
        status = "high"

    return {
        "available": True,
        "value": latest["value"],
        "unit": "mg/dL",
        "trend": trend_arrow,
        "status": status,
        "time_in_range": time_in_range,
        "readings_today": len(readings),
        "source": latest.get("source", "cgm"),
        "message": (
            f"Current glucose: {latest['value']} mg/dL, trend: {trend_arrow}, "
            f"time in range: {time_in_range}%"
        ),
    }


def initiate_food_scan(description: str, tool_context=None) -> dict:
    """Trigger the frontend to scan food via the camera. DO NOT use this to save.
    
    Call this when you see food on the camera. It will tell the frontend to 
    take a picture, analyze it for macros, and send the results back to you.
    After you receive the results, read them to the user and ask for 
    permission to save.
    
    Args:
        description: What you see (e.g. 'a plate of spaghetti').
    """
    emit_ui_update(
        "food_detected",
        {"description": description, "message": "Scanning macros..."},
        tool_context,
    )
    return {
        "success": True, 
        "message": f"Told the UI to scan '{description}'. Wait for the UI to return the macro results."
    }

def confirm_and_save_meal(
    description: str,
    meal_type: str,
    food_items: list[str],
    calories: int,
    protein_g: int,
    carbs_g: int,
    fat_g: int,
    tool_context=None
) -> dict:
    """Save a meal with full macro data AFTER the user confirms.
    
    Args:
        description: The general description of the meal.
        meal_type: The type of meal: 'breakfast', 'lunch', 'dinner', or 'snack'.
        food_items: The list of items identified.
        calories: Estimated calories.
        protein_g: Estimated protein in grams.
        carbs_g: Estimated carbs in grams.
        fat_g: Estimated fat in grams.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    entry = {
        "date": today,
        "meal_type": meal_type,
        "description": description,
        "food_items": food_items,
        "calories": calories,
        "protein_g": protein_g,
        "carbs_g": carbs_g,
        "fat_g": fat_g,
    }

    if _use_firestore(tool_context):
        user_id = _get_user_id(tool_context)
        from agents.shared.firestore_service import FirestoreService
        fs = FirestoreService.get_instance()
        _run_async(fs.add_food_log(user_id, entry))
    else:
        from agents.shared.mock_data import FOOD_LOGS
        FOOD_LOGS.append(entry)

    emit_ui_update(
        "meal_logged",
        {
            "description": description,
            "type": meal_type,
            "meal_type": meal_type,
            "calories": calories,
            "protein_g": protein_g,
            "carbs_g": carbs_g,
            "fat_g": fat_g,
            "food_items": food_items,
        },
        tool_context,
    )

    return {"success": True, "recorded": entry}


def log_symptoms(
    symptoms: str,
    severity: str = "mild",
    next_steps: str = "",
    followup_scheduled: bool = True,
    tool_context=None,
) -> dict:
    """Log patient-reported symptoms during a Voice Guardian session.

    Call this when the patient describes feeling unwell (headache, fever,
    nausea, body aches, fatigue, etc.) and you want to record it for their
    doctor. After logging, tell the patient what you noted and give them
    next steps.

    Args:
        symptoms: Description of what the patient is experiencing (e.g. 'headache and fever').
        severity: How severe — 'mild', 'moderate', or 'severe'.
        next_steps: Optional comma-separated first-aid next steps to surface in the UI.
        followup_scheduled: Whether you've committed to checking in with the patient later.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    now_time = datetime.now().strftime("%H:%M")
    user_id = _get_user_id(tool_context)

    entry = {
        "symptoms": symptoms,
        "severity": severity,
        "next_steps": next_steps,
        "followup_scheduled": followup_scheduled,
        "date": today,
        "time": now_time,
        "timestamp": datetime.now().isoformat(),
        "source": "voice_guardian",
    }

    fs = FirestoreService.get_instance()
    try:
        if hasattr(fs, "add_symptom_sync"):
            fs.add_symptom_sync(user_id, entry)
        elif _use_firestore(tool_context):
            _run_async(fs.add_symptom(user_id, entry))
        else:
            EMERGENCY_INCIDENTS.append({**entry, "type": "symptom_report"})
    except Exception as exc:
        import logging as _logging
        _logging.getLogger(__name__).warning("Failed to save symptoms for uid=%s: %s", user_id, exc)

    emit_ui_update(
        "symptom_logged",
        {
            "symptoms": symptoms,
            "severity": severity,
            "next_steps": next_steps,
            "followup_scheduled": followup_scheduled,
        },
        tool_context,
    )

    return {
        "success": True,
        "recorded": entry,
        "message": (
            f"Symptom log saved: {symptoms} ({severity}). "
            "The patient's doctor will be able to see this."
        ),
    }


def log_otc_medication(
    name: str,
    dose: str = "",
    reason: str = "",
    tool_context=None,
) -> dict:
    """Log an over-the-counter (OTC) or shelf medicine as a one-time intake event.

    Call this when the patient mentions taking a medicine that is NOT on their
    regular prescription schedule (e.g. Aspirin, Panadol, Ibuprofen, antacid,
    cough syrup, vitamin). This logs it as a one-time event — it does NOT add
    it to their medication schedule.

    Use the following decision logic:
    1. Call get_medication_schedule to check if the medicine is prescribed.
    2. If it IS prescribed -> use log_medication_taken instead.
    3. If it is NOT in the schedule -> call this function.

    Args:
        name: Name of the OTC medicine (e.g. 'Aspirin', 'Panadol 500mg').
        dose: Dose taken, if mentioned (e.g. '500mg', '1 tablet'). Optional.
        reason: Why they took it, if mentioned (e.g. 'headache', 'fever'). Optional.
    """
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    now_time = now.strftime("%H:%M")
    user_id = _get_user_id(tool_context)

    entry = {
        "name": name,
        "dose": dose,
        "reason": reason,
        "date": today,
        "time": now_time,
        "timestamp": now.isoformat(),
        "source": "otc",
        "one_time": True,
    }

    fs = FirestoreService.get_instance()
    try:
        if hasattr(fs, "add_otc_log_sync"):
            fs.add_otc_log_sync(user_id, entry)
        elif _use_firestore(tool_context):
            _run_async(fs.add_otc_log(user_id, entry))
        else:
            MEALS_LOG.append({**entry, "type": "otc_intake"})
    except Exception as exc:
        import logging as _logging
        _logging.getLogger(__name__).warning("Failed to save OTC log for uid=%s: %s", user_id, exc)

    emit_ui_update(
        "otc_medication_logged",
        {
            "name": name,
            "dose": dose,
            "reason": reason,
            "time": now_time,
        },
        tool_context,
    )

    return {
        "success": True,
        "recorded": entry,
        "message": (
            f"One-time OTC intake logged: {name}"
            + (f" {dose}" if dose else "")
            + (f" for {reason}" if reason else "")
            + ". This has NOT been added to the regular medication schedule."
        ),
    }


# ---------------------------------------------------------------------------
# Real-time Medication Information
# ---------------------------------------------------------------------------


def get_medication_info(drug_name: str, tool_context=None) -> dict:
    """Return real-time drug information: purpose, side effects, warnings,
    and interactions with the patient's current medications.

    Call this when the user asks about a specific medication by name — e.g.
    "what is Metformin for?", "side effects of Lisinopril", "can I take
    Ibuprofen with my other meds?". Do NOT navigate away; answer inline.

    Args:
        drug_name: Name of the medication to look up (brand or generic).
    """
    from agents.shared.drug_service import get_drug_info, check_interactions

    info = _run_async(get_drug_info(drug_name))

    # Cross-check interactions with the patient's existing medications
    if _use_firestore(tool_context):
        user_id = _get_user_id(tool_context)
        fs = FirestoreService.get_instance()
        existing = fs.get_medications_sync(user_id)
    else:
        existing = MEDICATIONS

    existing_names = [m["name"] for m in existing]
    all_drugs = [drug_name] + [n for n in existing_names if n.lower() != drug_name.lower()]
    interactions: dict = {}
    if len(all_drugs) > 1:
        try:
            interactions = _run_async(check_interactions(all_drugs))
        except Exception:
            pass

    emit_ui_update("medication_info", {"drug": drug_name, "info": info}, tool_context)
    return {**info, "interactions_with_current_meds": interactions}


# ---------------------------------------------------------------------------
# Emergency Detection & Protocol
# ---------------------------------------------------------------------------


def _build_negation_pattern(keyword: str) -> re.Pattern:
    """Build a regex that matches a negated form of a keyword."""
    prefix_group = "|".join(NEGATION_PREFIXES)
    pattern = rf"(?:{prefix_group}).{{0,20}}{re.escape(keyword)}"
    return re.compile(pattern, re.IGNORECASE)


def detect_emergency_severity(user_message: str, tool_context=None) -> dict:
    """Detect whether the user's message describes a Red Line emergency.

    Uses hardcoded keyword matching with negation awareness.
    This is a DETERMINISTIC safety check — not LLM-decided.

    Args:
        user_message: The text of what the user said (transcript).
    """
    message_lower = user_message.lower()

    for keyword in RED_LINE_KEYWORDS:
        if keyword in message_lower:
            # Check if the keyword is negated
            neg_pattern = _build_negation_pattern(keyword)
            if neg_pattern.search(message_lower):
                continue  # Negated — skip this keyword
            return {
                "is_red_line": True,
                "matched_keyword": keyword,
                "suggested_severity": "red_line",
            }

    # Not a red line — check for moderate/mild symptom keywords
    symptom_indicators = [
        "dizzy", "nausea", "headache", "fever", "vomiting",
        "weak", "tired", "pain", "swelling", "rash", "cough",
        "short of breath", "blurry vision", "numbness",
    ]
    for indicator in symptom_indicators:
        if indicator in message_lower:
            return {
                "is_red_line": False,
                "matched_keyword": indicator,
                "suggested_severity": "moderate",
            }

    return {
        "is_red_line": False,
        "matched_keyword": None,
        "suggested_severity": "mild",
    }


def _map_severity_to_tier(severity: str) -> str:
    """Map severity string to 3-tier alert level: red, amber, green."""
    if severity == "red_line":
        return "red"
    if severity in ("urgent", "moderate"):
        return "amber"
    return "green"


def _map_tier_to_action(tier: str) -> str:
    """Map alert tier to action taken."""
    if tier == "red":
        return "emergency_protocol"
    if tier == "amber":
        return "family_chw_alert"
    return "logged_nudge"


def _build_safety_log(
    tier: str, symptom_description: str, severity: str,
    vitals: list, notified: list, now: str,
) -> dict:
    """Build a SafetyLog entry for the audit trail."""
    vitals_at_time = []
    for v in vitals[-5:]:  # last 5 readings
        vitals_at_time.append({
            "type": v.get("type", "vital"),
            "value": str(v.get("value", "?")),
            "unit": v.get("unit", ""),
        })
    return {
        "timestamp": now,
        "alert_tier": tier,
        "trigger_source": "voice_guardian",
        "symptoms": symptom_description,
        "original_severity": severity,
        "vitals_at_time": vitals_at_time,
        "action_taken": _map_tier_to_action(tier),
        "human_notified": notified,
        "patient_acknowledged": False,
        "resolution": None,
    }


def _persist_safety_log(user_id: str, log: dict, tool_context) -> None:
    """Persist a safety log entry to storage."""
    try:
        fs = FirestoreService.get_instance()
        fs.add_safety_log_sync(user_id, log)
    except Exception:
        pass


def initiate_emergency_protocol(
    symptom_description: str, severity: str, tool_context=None
) -> dict:
    """Initiate emergency response based on detected severity using 3-tier alerts.

    Tiers:
      RED   (red_line)          → call emergency services + family alert + full audit
      AMBER (urgent/moderate)   → family + CHW alert + first-aid guidance
      GREEN (mild)              → log + nudge, continue guidance

    Args:
        symptom_description: What the user described (e.g. "chest pain").
        severity: One of "red_line", "urgent", "moderate", "mild".
    """
    now = datetime.now(timezone.utc).isoformat()
    user_id = _get_user_id(tool_context)
    tier = _map_severity_to_tier(severity)
    is_red_line = tier == "red"

    # Fetch recent vitals for red/amber tiers
    recent_vitals: list = []
    if tier in ("red", "amber"):
        if _use_firestore(tool_context):
            try:
                fs_vitals = FirestoreService.get_instance()
                since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
                recent_vitals = _run_async(fs_vitals.get_vitals_log(user_id, since_date=since))
            except Exception:
                pass
        else:
            recent_vitals = list(VITALS_LOG)

    # Build incident record
    incident = {
        "symptom": symptom_description,
        "severity": severity,
        "alert_tier": tier,
        "is_red_line": is_red_line,
        "action_taken": _map_tier_to_action(tier),
        "alert_sent": tier in ("red", "amber"),
        "timestamp": now,
    }
    if recent_vitals:
        incident["recent_vitals"] = recent_vitals

    # Store incident
    if _use_firestore(tool_context):
        try:
            fs = FirestoreService.get_instance()
            fs.add_emergency_incident_sync(user_id, incident)
        except Exception:
            pass
    else:
        EMERGENCY_INCIDENTS.append(incident)

    # ── RED TIER ──────────────────────────────────────────────────────────
    if tier == "red":
        vitals_summary = ""
        if recent_vitals:
            last = recent_vitals[-1]
            vitals_summary = (
                f" Latest vitals on record: {last.get('type', 'vital')} = "
                f"{last.get('value', '?')} {last.get('unit', '')} ({last.get('date', '')})."
            )

        emergency_number = EMERGENCY_NUMBERS.get("default", "911")
        message = RED_LINE_RESPONSE.format(emergency_number=emergency_number)

        # Send high-priority family alert
        from agents.insights.tools import send_family_alert

        notified = []
        try:
            alert_result = _run_async(send_family_alert(
                alert_type="emergency",
                message=(
                    f"EMERGENCY: {symptom_description}. "
                    f"Patient instructed to call {emergency_number}.{vitals_summary}"
                ),
                tool_context=tool_context,
            ))
            if isinstance(alert_result, dict):
                notified = alert_result.get("notified", [])
        except Exception:
            pass

        # Persist safety log
        safety_log = _build_safety_log(tier, symptom_description, severity, recent_vitals, notified, now)
        _persist_safety_log(user_id, safety_log, tool_context)

        # Emit UI event
        emit_ui_update("safety_alert", {
            "tier": "red",
            "symptom": symptom_description,
            "emergency_number": emergency_number,
            "timestamp": now,
            "log": safety_log,
        }, tool_context)

        return {
            "action": "call_emergency",
            "alert_tier": "red",
            "message": message,
            "emergency_number": emergency_number,
            "alert_sent": True,
            "interrupt_audio": True,
            "recent_vitals": recent_vitals,
            "safety_log": safety_log,
        }

    # ── AMBER TIER ────────────────────────────────────────────────────────
    elif tier == "amber":
        from agents.insights.tools import send_family_alert

        notified = []
        try:
            alert_result = _run_async(send_family_alert(
                alert_type="warning",
                message=(
                    f"HEALTH ALERT: {symptom_description}. "
                    f"Severity: {severity}. Monitoring advised."
                ),
                tool_context=tool_context,
            ))
            if isinstance(alert_result, dict):
                notified = alert_result.get("notified", [])
        except Exception:
            pass

        # Persist safety log
        safety_log = _build_safety_log(tier, symptom_description, severity, recent_vitals, notified, now)
        _persist_safety_log(user_id, safety_log, tool_context)

        # Emit UI event
        emit_ui_update("safety_alert", {
            "tier": "amber",
            "symptom": symptom_description,
            "timestamp": now,
            "log": safety_log,
        }, tool_context)

        return {
            "action": "first_aid_guidance",
            "alert_tier": "amber",
            "symptom": symptom_description,
            "severity": severity,
            "alert_sent": True,
            "message": (
                f"The patient reports: {symptom_description}. "
                "This requires attention. Provide calm first-aid guidance. "
                "Recommend they see a doctor soon. "
                "Do NOT diagnose any condition."
            ),
            "safety_log": safety_log,
        }

    # ── GREEN TIER ────────────────────────────────────────────────────────
    else:
        # Persist safety log (audit trail even for mild)
        safety_log = _build_safety_log(tier, symptom_description, severity, [], [], now)
        _persist_safety_log(user_id, safety_log, tool_context)

        # Emit UI event
        emit_ui_update("safety_alert", {
            "tier": "green",
            "symptom": symptom_description,
            "timestamp": now,
            "log": safety_log,
        }, tool_context)

        return {
            "action": "first_aid_guidance",
            "alert_tier": "green",
            "symptom": symptom_description,
            "severity": severity,
            "alert_sent": False,
            "message": (
                f"The patient reports: {symptom_description}. "
                "Provide calm, reassuring guidance. "
                "Recommend they monitor symptoms. "
                "Do NOT diagnose any condition."
            ),
            "safety_log": safety_log,
        }


# ---------------------------------------------------------------------------
# Family Calling — Two-Legged PSTN Bridge
# ---------------------------------------------------------------------------


def _match_contact(profile: dict, contact_name: str) -> dict | None:
    """Fuzzy-match contact_name against the patient's emergency contact(s)."""
    ec = profile.get("emergency_contact")
    if not ec:
        return None
    contacts = ec if isinstance(ec, list) else [ec]
    name_lower = contact_name.lower()
    for c in contacts:
        c_name = c.get("name", "").lower()
        c_rel = c.get("relationship", "").lower()
        if (
            name_lower in c_name
            or name_lower in c_rel
            or c_name in name_lower
            or c_rel in name_lower
        ):
            return c
    return None


def initiate_family_call(
    contact_name: str, reason: str = "", tool_context=None
) -> dict:
    """Place a phone call to a family member on behalf of the patient.

    Uses a Two-Legged PSTN bridge: Twilio first calls the patient's own phone,
    then when they pick up, bridges the call to the family member.

    Args:
        contact_name: Who to call — a name or relationship (e.g. 'my son', 'Carlos', 'daughter').
        reason: Why the call is being placed (e.g. 'patient requested', 'emergency').
    """
    now = datetime.now(timezone.utc).isoformat()
    user_id = _get_user_id(tool_context)

    # Resolve patient profile and contact
    if _use_firestore(tool_context):
        fs = FirestoreService.get_instance()
        profile = fs.get_patient_profile_sync(user_id) or {}
    else:
        profile = PATIENT_PROFILE

    contact = _match_contact(profile, contact_name)
    if not contact:
        return {
            "success": False,
            "message": (
                f"I couldn't find a contact matching '{contact_name}' in your records. "
                "Please check the name or relationship and try again."
            ),
        }

    contact_phone = contact.get("phone", "")
    contact_display = contact.get("name", contact_name)
    if not contact_phone:
        return {
            "success": False,
            "message": f"No phone number on file for {contact_display}.",
        }

    # Build FaceTime URLs (audio and video)
    # facetime-audio:// for voice call, facetime:// for video
    facetime_audio_url = f"facetime-audio://{contact_phone}"
    facetime_video_url = f"facetime://{contact_phone}"

    # Emit UI event — frontend will open FaceTime on the patient's Apple device
    from agents.shared.ui_tools import emit_ui_update
    emit_ui_update("family_call", {
        "contact_name": contact_display,
        "contact_phone": contact_phone,
        "facetime_url": facetime_audio_url,
        "facetime_video_url": facetime_video_url,
        "reason": reason or f"Voice request: {contact_name}",
    }, tool_context)

    # Log the call
    call_log = {
        "contact_name": contact_display,
        "contact_phone": contact_phone,
        "call_sid": "facetime",
        "status": "initiated",
        "initiated_at": now,
        "reason": reason or f"Voice request: {contact_name}",
    }
    if _use_firestore(tool_context):
        try:
            fs.add_call_log_sync(user_id, call_log)
        except Exception:
            pass
    else:
        CALL_LOGS.append(call_log)

    return {
        "success": True,
        "contact_name": contact_display,
        "contact_phone_masked": contact_phone[:3] + "***" + contact_phone[-4:],
        "message": (
            f"Opening FaceTime to {contact_display} now."
        ),
    }
def set_health_reminder(
    reminder_type: str,
    reminder_time: str,
    voice_enabled: bool = True,
    tool_context=None,
) -> dict:
    """Schedule or update a health reminder (meds, glucose, lunch, dinner).

    Args:
        reminder_type: The type of reminder: 'meds', 'glucose', 'lunch', or 'dinner'.
        reminder_time: The time for the reminder in HH:MM format (24-hour, e.g. '08:00', '19:30').
        voice_enabled: Whether to receive a proactive phone call for this reminder.
    """
    user_id = _get_user_id(tool_context)
    fs = FirestoreService.get_instance()
    
    # Normalize time
    if len(reminder_time) == 4 and reminder_time[1] == ":":
        reminder_time = "0" + reminder_time
        
    try:
        # Get current prefs to avoid overwriting unrelated ones
        # For simplicity in this tool, we'll just set the target reminder
        kwargs = {
            "reminder_meds_enabled": reminder_type == "meds",
            "reminder_glucose_enabled": reminder_type == "glucose",
            "reminder_lunch_enabled": reminder_type == "lunch",
            "reminder_dinner_enabled": reminder_type == "dinner",
            "voice_reminders_enabled": voice_enabled,
            "timezone": "UTC", # Default, should ideally be from context
        }
        
        if reminder_type == "meds": kwargs["reminder_meds_enabled"] = True
        elif reminder_type == "glucose": 
            kwargs["reminder_glucose_enabled"] = True
            kwargs["glucose_reminder_time"] = reminder_time
        elif reminder_type == "lunch":
            kwargs["reminder_lunch_enabled"] = True
            kwargs["lunch_reminder_time"] = reminder_time
        elif reminder_type == "dinner":
            kwargs["reminder_dinner_enabled"] = True
            kwargs["dinner_reminder_time"] = reminder_time
            
        _run_async(fs.save_reminder_preferences(user_id, **kwargs))
        
        emit_ui_update(
            "reminder_set",
            {"type": reminder_type, "time": reminder_time, "voice": voice_enabled},
            tool_context,
        )
        
        return {
            "success": True,
            "message": f"Okay, I've set a {reminder_type} reminder for {reminder_time}. " + 
                       ("I will call you on your phone then." if voice_enabled else "I'll send you a push notification.")
        }
    except Exception as e:
        logger.error("Failed to set reminder: %s", e)
        return {"success": False, "error": str(e)}
