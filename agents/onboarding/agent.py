"""The Onboarding Agent."""

from google.adk.agents import Agent
from agents.shared.constants import LIVE_MODEL
from agents.shared.prompts import ONBOARDING_AGENT_INSTRUCTION
from agents.onboarding.tools import (
    restart_onboarding,
    emit_ui_update,
    complete_onboarding_and_save,
)

onboarding_agent = Agent(
    name="onboarding",
    model=LIVE_MODEL,
    description="Onboarding Specialist to conduct initial intake interview and gather preferences/allergies.",
    instruction=ONBOARDING_AGENT_INSTRUCTION,
    tools=[
        restart_onboarding,
        emit_ui_update,
        complete_onboarding_and_save,
    ],
)
