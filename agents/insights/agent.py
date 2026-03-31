"""Insights Agent: adherence scoring, vital trends, digests, family alerts,
predictive analytics, and patient history queries."""

from google.adk.agents import Agent

from agents.shared.constants import LIVE_MODEL
from agents.shared.prompts import INSIGHTS_INSTRUCTION
from agents.insights.tools import (
    detect_health_patterns,
    get_adherence_score,
    get_daily_digest,
    get_patient_history,
    get_rehospitalization_risk,
    get_vital_trends,
    predict_health_risks,
    send_family_alert,
    suggest_safe_recipes,
    generate_grocery_list,
    draft_dietary_plan,
)

insights_agent = Agent(
    name="insights",
    model=LIVE_MODEL,
    description=(
        "Provides health analytics, medication adherence scores, vital sign "
        "trends, daily health digests, predictive health risk analysis, "
        "patient history queries, and can send alerts to family members. "
        "Use this agent when the user asks about their adherence, health trends, "
        "a summary of their day, how they are doing this week, wants to alert "
        "their family, or asks about their past medical records."
    ),
    instruction=INSIGHTS_INSTRUCTION,
    tools=[
        get_adherence_score,
        get_vital_trends,
        get_daily_digest,
        send_family_alert,
        detect_health_patterns,
        predict_health_risks,
        get_rehospitalization_risk,
        get_patient_history,
        suggest_safe_recipes,
        generate_grocery_list,
        draft_dietary_plan,
    ],
)
