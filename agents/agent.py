"""Heali Root Coordinator Agent.

Handles guardian tasks (medications, vitals, meals, pill verification, emergency,
family calls) directly via tools — avoids sub-agent routing latency in Live mode.

Delegates to sub-agents only for specialised flows:
- Interpreter: translation, prescription/label reading
- Insights: adherence scoring, trends, digests, family alerts
- Booking: symptom triage, hospital search, appointment booking
- Onboarding: first-time profile setup
- Exercise: guided wellness sessions
"""

from google.adk.agents import Agent

from agents.shared.constants import LIVE_MODEL
from agents.shared.prompts import ROOT_AGENT_INSTRUCTION
from agents.interpreter.agent import interpreter_agent
from agents.insights.agent import insights_agent
from agents.onboarding.agent import onboarding_agent
from agents.booking.agent import booking_agent
from agents.exercise.agent import exercise_agent

# Guardian tools wired directly to root agent so Live mode never needs to
# create a new session for the guardian sub-agent (which loses user context).
from agents.shared.ui_tools import navigate_to_page
from agents.guardian.tools import (
    get_medication_schedule,
    log_medication_schedule,
    log_medication_taken,
    verify_pill,
    log_vitals,
    initiate_food_scan,
    confirm_and_save_meal,
    detect_emergency_severity,
    initiate_emergency_protocol,
    initiate_family_call,
)

root_agent = Agent(
    name="heali",
    model=LIVE_MODEL,
    description="Heali health guardian coordinator",
    instruction=ROOT_AGENT_INSTRUCTION,
    tools=[
        get_medication_schedule,
        log_medication_taken,
        log_medication_schedule,
        verify_pill,
        log_vitals,
        initiate_food_scan,
        confirm_and_save_meal,
        detect_emergency_severity,
        initiate_emergency_protocol,
        initiate_family_call,
        navigate_to_page,
    ],
    sub_agents=[interpreter_agent, insights_agent, onboarding_agent, booking_agent, exercise_agent],
)
