"""Booking Agent: symptom triage, hospital search, slot availability, appointment booking."""

from google.adk.agents import Agent

from agents.shared.constants import LIVE_MODEL
from agents.shared.prompts import BOOKING_AGENT_INSTRUCTION
from agents.booking.tools import (
    triage_symptoms,
    find_nearby_hospitals,
    get_available_slots,
    book_appointment,
)

booking_agent = Agent(
    name="booking",
    model=LIVE_MODEL,
    description=(
        "Helps patients book doctor appointments. Triages symptoms to determine "
        "the right specialist, finds nearby clinics in Boston/Dorchester area, "
        "checks available time slots, and books confirmed appointments. "
        "Use this agent when the user wants to see a doctor, book an appointment, "
        "find a clinic or hospital, or needs a specialist referral."
    ),
    instruction=BOOKING_AGENT_INSTRUCTION,
    tools=[
        triage_symptoms,
        find_nearby_hospitals,
        get_available_slots,
        book_appointment,
    ],
)

