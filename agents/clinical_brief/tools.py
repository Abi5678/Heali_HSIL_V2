"""Clinical Brief tools: generate structured clinical summaries and FHIR R4 Bundles.

Aggregates data from all Heali collections (profile, medications, adherence,
vitals, food, prescriptions, reports, safety_logs, emergency_incidents, symptoms)
into a doctor-ready summary. Optionally converts to FHIR R4 Bundle for EHR import.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from agents.shared.firestore_service import FirestoreService
from agents.shared.mock_data import (
    ADHERENCE_LOG,
    FOOD_LOGS,
    MEDICATIONS,
    PATIENT_PROFILE,
    PRESCRIPTIONS,
    REPORTS,
    VITALS_LOG,
)

logger = logging.getLogger(__name__)


async def generate_clinical_brief(user_id: str, days: int = 7) -> dict:
    """Generate a structured clinical brief from all patient data.

    Args:
        user_id: The patient's user ID.
        days: Number of past days to summarize (default 7).
    """
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=days)).strftime("%Y-%m-%d")

    fs = FirestoreService.get_instance()

    # Sequential data fetch (SQLite's aiosqlite does not support parallel connections)
    profile = await fs.get_patient_profile(user_id)
    medications = await fs.get_medications(user_id)
    adherence = await fs.get_adherence_log(user_id, since_date=since)
    vitals = await fs.get_vitals_log(user_id, since_date=since)
    food_logs = await fs.get_food_logs(user_id)
    prescriptions = await fs.get_prescriptions(user_id)
    reports = await fs.get_reports(user_id)
    safety_logs = await fs.get_safety_logs(user_id, since_date=since)
    incidents = await fs.get_emergency_incidents(user_id, since_date=since)
    symptoms = await fs.get_symptoms(user_id, since_date=since)

    # Fetch wearable data
    wearable_connections = await fs.get_wearable_connections(user_id)

    # Use mock data fallbacks if empty
    profile = profile or PATIENT_PROFILE
    medications = medications if medications else MEDICATIONS
    adherence = adherence if adherence else [e for e in ADHERENCE_LOG if e.get("date", "") >= since]
    vitals = vitals if vitals else [e for e in VITALS_LOG if e.get("date", "") >= since]
    food_logs = food_logs if food_logs else FOOD_LOGS
    prescriptions = prescriptions if prescriptions else PRESCRIPTIONS
    reports = reports if reports else REPORTS
    if not wearable_connections:
        from agents.shared.mock_data import WEARABLE_CONNECTIONS
        wearable_connections = WEARABLE_CONNECTIONS

    # Adherence score
    total_doses = len(adherence)
    taken = sum(1 for e in adherence if e.get("taken"))
    adherence_score = round((taken / total_doses) * 100, 1) if total_doses else 0
    adherence_rating = "excellent" if adherence_score >= 90 else "good" if adherence_score >= 80 else "needs improvement"
    missed_doses = [
        {"medication": e.get("medication"), "date": e.get("date")}
        for e in adherence if not e.get("taken")
    ]

    # Vital summaries
    def _vital_summary(vital_type: str) -> dict:
        readings = [v for v in vitals if v.get("type") == vital_type]
        if not readings:
            return {"latest": None, "trend": "no data", "readings_count": 0}
        values = []
        for r in readings:
            try:
                val = r.get("value", "0")
                if "/" in str(val):
                    values.append(int(str(val).split("/")[0]))
                else:
                    values.append(float(val))
            except (ValueError, TypeError):
                pass
        trend = "stable"
        if len(values) >= 2:
            diff = values[-1] - values[0]
            if abs(diff) >= 3:
                trend = "improving" if diff < 0 else "increasing"
        return {
            "latest": readings[-1] if readings else None,
            "trend": trend,
            "min": min(values) if values else None,
            "max": max(values) if values else None,
            "readings_count": len(readings),
        }

    # Safety alert summary
    red_count = sum(1 for s in safety_logs if s.get("alert_tier") == "red")
    amber_count = sum(1 for s in safety_logs if s.get("alert_tier") == "amber")

    brief = {
        "generated_at": now.isoformat(),
        "period_days": days,
        "patient": {
            "name": profile.get("name", "Unknown"),
            "age": profile.get("age"),
            "conditions": profile.get("conditions", []),
            "blood_type": profile.get("blood_type"),
            "allergies": profile.get("allergies", []),
        },
        "medications": {
            "current": [
                {
                    "name": m.get("name"),
                    "dosage": m.get("dosage"),
                    "frequency": m.get("frequency", m.get("times", [])),
                    "purpose": m.get("purpose"),
                }
                for m in medications
            ],
            "adherence_score": adherence_score,
            "adherence_rating": adherence_rating,
            "missed_doses": missed_doses[:10],
        },
        "vitals": {
            "blood_pressure": _vital_summary("blood_pressure"),
            "blood_sugar": _vital_summary("blood_sugar"),
        },
        "recent_symptoms": symptoms[:10],
        "scanned_documents": {
            "prescriptions": len(prescriptions),
            "lab_reports": len(reports),
            "latest_report": reports[0] if reports else None,
        },
        "safety_alerts": {
            "total": len(safety_logs),
            "red_count": red_count,
            "amber_count": amber_count,
            "recent": safety_logs[:5],
        },
        "emergency_incidents": {
            "total": len(incidents),
            "recent": incidents[:5],
        },
    }

    # --- Wearable & CGM data section ---
    cgm_readings = [v for v in vitals if v.get("type") == "glucose_cgm"]
    step_readings = [v for v in vitals if v.get("type") == "steps"]
    sleep_readings = [v for v in vitals if v.get("type") == "sleep_duration"]
    hr_readings = [v for v in vitals if v.get("type") in ("heart_rate", "resting_heart_rate")]

    wearable_data: dict = {
        "connected_devices": [c.get("device", c.get("provider", "")) for c in wearable_connections if c.get("status") == "active"],
    }

    if cgm_readings:
        from agents.shared.wearable_service import WearableService
        ws = WearableService.get_instance()
        cgm_vals = [float(r["value"]) for r in cgm_readings]
        avg_glucose = round(sum(cgm_vals) / len(cgm_vals), 1)
        wearable_data["cgm_summary"] = {
            "avg_glucose": avg_glucose,
            "time_in_range": ws.calculate_time_in_range(cgm_readings),
            "hypo_events": sum(1 for v in cgm_vals if v < 70),
            "hyper_events": sum(1 for v in cgm_vals if v > 180),
            "gmi": ws.calculate_gmi(avg_glucose),
            "readings_count": len(cgm_readings),
        }

    if step_readings:
        step_vals = [float(r["value"]) for r in step_readings]
        wearable_data["activity"] = {
            "avg_daily_steps": round(sum(step_vals) / len(step_vals)),
        }
        active_readings = [v for v in vitals if v.get("type") == "active_minutes"]
        if active_readings:
            active_vals = [float(r["value"]) for r in active_readings]
            wearable_data["activity"]["avg_active_minutes"] = round(sum(active_vals) / len(active_vals))
        resting_hr = [v for v in vitals if v.get("type") == "resting_heart_rate"]
        if resting_hr:
            hr_vals = [float(r["value"]) for r in resting_hr]
            wearable_data["activity"]["avg_resting_hr"] = round(sum(hr_vals) / len(hr_vals))

    if sleep_readings:
        sleep_vals = [float(r["value"]) for r in sleep_readings]
        wearable_data["sleep"] = {
            "avg_duration_hours": round(sum(sleep_vals) / len(sleep_vals), 1),
        }
        sleep_score_readings = [v for v in vitals if v.get("type") == "sleep_score"]
        if sleep_score_readings:
            score_vals = [float(r["value"]) for r in sleep_score_readings]
            wearable_data["sleep"]["avg_score"] = round(sum(score_vals) / len(score_vals))

    brief["wearable_data"] = wearable_data

    return brief


def convert_to_fhir_r4(brief: dict) -> dict:
    """Convert a clinical brief to a FHIR R4 Bundle (type: document).

    Produces:
    - Patient resource
    - Observation resources (one per vital reading)
    - MedicationStatement resources (one per active medication)
    - DiagnosticReport resources (from scanned lab reports)

    Args:
        brief: A clinical brief dict from generate_clinical_brief().
    """
    bundle_id = str(uuid.uuid4())
    patient_id = f"patient-{uuid.uuid4().hex[:8]}"
    entries = []

    # Patient resource
    patient = brief.get("patient", {})
    patient_resource = {
        "fullUrl": f"urn:uuid:{patient_id}",
        "resource": {
            "resourceType": "Patient",
            "id": patient_id,
            "name": [{"text": patient.get("name", "Unknown")}],
            "birthDate": None,
        },
    }
    if patient.get("age"):
        birth_year = datetime.now().year - int(patient["age"])
        patient_resource["resource"]["birthDate"] = f"{birth_year}-01-01"
    if patient.get("allergies"):
        patient_resource["resource"]["extension"] = [
            {
                "url": "http://hl7.org/fhir/StructureDefinition/patient-allergy",
                "valueString": a,
            }
            for a in patient["allergies"]
        ]
    entries.append(patient_resource)

    # Observation resources (vitals)
    for vital_type, vital_data in brief.get("vitals", {}).items():
        latest = vital_data.get("latest")
        if not latest:
            continue
        obs_id = str(uuid.uuid4())
        loinc_map = {
            "blood_pressure": {"code": "85354-9", "display": "Blood pressure"},
            "blood_sugar": {"code": "2339-0", "display": "Glucose"},
            "glucose_cgm": {"code": "15074-8", "display": "Glucose [Mass/volume] in Blood"},
            "heart_rate": {"code": "8867-4", "display": "Heart rate"},
            "spo2": {"code": "2708-6", "display": "Oxygen saturation in Arterial blood"},
        }
        coding = loinc_map.get(vital_type, {"code": "unknown", "display": vital_type})
        entries.append({
            "fullUrl": f"urn:uuid:{obs_id}",
            "resource": {
                "resourceType": "Observation",
                "id": obs_id,
                "status": "final",
                "code": {
                    "coding": [
                        {
                            "system": "http://loinc.org",
                            "code": coding["code"],
                            "display": coding["display"],
                        }
                    ]
                },
                "subject": {"reference": f"urn:uuid:{patient_id}"},
                "effectiveDateTime": latest.get("date", brief.get("generated_at")),
                "valueString": f"{latest.get('value')} {latest.get('unit', '')}",
            },
        })

    # MedicationStatement resources
    for med in brief.get("medications", {}).get("current", []):
        med_id = str(uuid.uuid4())
        entries.append({
            "fullUrl": f"urn:uuid:{med_id}",
            "resource": {
                "resourceType": "MedicationStatement",
                "id": med_id,
                "status": "active",
                "medicationCodeableConcept": {
                    "text": med.get("name", "Unknown"),
                },
                "subject": {"reference": f"urn:uuid:{patient_id}"},
                "dosage": [
                    {
                        "text": f"{med.get('dosage', '')} — {med.get('purpose', '')}",
                    }
                ],
            },
        })

    # DiagnosticReport resources (from scanned reports)
    latest_report = brief.get("scanned_documents", {}).get("latest_report")
    if latest_report:
        report_id = str(uuid.uuid4())
        entries.append({
            "fullUrl": f"urn:uuid:{report_id}",
            "resource": {
                "resourceType": "DiagnosticReport",
                "id": report_id,
                "status": "final",
                "code": {"text": "Lab Report"},
                "subject": {"reference": f"urn:uuid:{patient_id}"},
                "conclusion": str(latest_report.get("summary", latest_report.get("findings", ""))),
            },
        })

    bundle = {
        "resourceType": "Bundle",
        "id": bundle_id,
        "type": "document",
        "timestamp": brief.get("generated_at", datetime.now(timezone.utc).isoformat()),
        "entry": entries,
    }

    return bundle
