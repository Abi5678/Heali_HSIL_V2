"""Guardian Agent: medication management, pill verification, vitals, meals, emergency protocol."""

from google.adk.agents import Agent

from agents.shared.constants import LIVE_MODEL
from agents.shared.prompts import GUARDIAN_INSTRUCTION
from agents.guardian.tools import (
    get_medication_schedule,
    log_medication_schedule,
    log_medication_taken,
    log_otc_medication,
    log_symptoms,
    verify_pill,
    get_medication_info,
    log_vitals,
    get_cgm_status,
    initiate_food_scan,
    confirm_and_save_meal,
    detect_emergency_severity,
    initiate_emergency_protocol,
    initiate_family_call,
)

guardian_agent = Agent(
    name="guardian",
    model=LIVE_MODEL,
    description=(
        "Manages medications, verifies pills via camera, provides real-time drug "
        "information (side effects, purpose, interactions), logs vital signs, "
        "monitors CGM glucose readings from Dexcom/FreeStyle Libre, "
        "tracks meals, handles emergency detection and first-aid protocol, "
        "and places family phone calls. "
        "Use this agent when the user asks about their medication schedule, "
        "wants to know about a specific drug or its side effects/interactions, "
        "wants to verify a pill, report vitals, check their glucose/CGM status, "
        "log food, reports any symptoms, or wants to call a family member."
    ),
    instruction=GUARDIAN_INSTRUCTION,
    tools=[
        get_medication_schedule,
        log_medication_schedule,
        log_medication_taken,
        log_otc_medication,
        log_symptoms,
        verify_pill,
        get_medication_info,
        log_vitals,
        get_cgm_status,
        initiate_food_scan,
        confirm_and_save_meal,
        detect_emergency_severity,
        initiate_emergency_protocol,
        initiate_family_call,
    ],
)
