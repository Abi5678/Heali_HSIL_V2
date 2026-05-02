"""Twilio outbound voice call reminders for medication adherence.

Flow:
  trigger → place_reminder_call() → Twilio dials patient's phone
  → patient answers → TwiML plays reminder script
  → patient presses 1 (taken) or 2 (snooze 15 min)
  → /api/reminders/call-response webhook logs the response
"""

import logging
import os

from fastapi import APIRouter, Form, Header, HTTPException, Response

from agents.shared.mock_data import MEDICATIONS, PATIENT_PROFILE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reminders", tags=["voice-calls"])

# ---------------------------------------------------------------------------
# Twilio config (falls back to demo mode if credentials not set)
# ---------------------------------------------------------------------------

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")
APP_URL = os.getenv("MEDLIVE_APP_URL", "http://localhost:8000")
DEMO_PHONE = os.getenv("TWILIO_DEMO_PHONE", "")  # Number to call during demos


def _twilio_client():
    from twilio.rest import Client  # type: ignore[import]
    return Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)


def _is_demo_mode() -> bool:
    return not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER)


# ---------------------------------------------------------------------------
# Call script builder
# ---------------------------------------------------------------------------

def build_medication_list(meds: list[dict]) -> list[str]:
    """Return a list of 'Name Dosage' strings for the current time slot."""
    result = []
    for med in meds:
        name = med.get("name", "")
        dosage = med.get("dosage", "")
        result.append(f"{name} {dosage}".strip())
    return result


def build_call_script(patient_first_name: str, med_names: list[str]) -> str:
    """Build a natural-sounding TTS reminder script."""
    if not med_names:
        med_text = "your medications"
    elif len(med_names) == 1:
        med_text = med_names[0]
    elif len(med_names) == 2:
        med_text = f"{med_names[0]} and {med_names[1]}"
    else:
        med_text = ", ".join(med_names[:-1]) + f", and {med_names[-1]}"

    return (
        f"Hi {patient_first_name}! This is Heali, your personal health companion. "
        f"It's time to take {med_text}. "
        f"Press 1 once you've taken your medications, "
        f"or press 2 to be reminded again in 15 minutes."
    )


# ---------------------------------------------------------------------------
# Core function — place an outbound call
# ---------------------------------------------------------------------------

def place_reminder_call(
    to_phone: str,
    patient_first_name: str,
    med_names: list[str],
) -> dict:
    """Place a Twilio outbound call. Returns a status dict.

    In demo mode (no Twilio credentials), returns a simulated response
    with the script that would be spoken.
    """
    script = build_call_script(patient_first_name, med_names)

    if _is_demo_mode():
        logger.info("[DEMO] Voice call would dial %s: %s", to_phone, script)
        return {
            "demo": True,
            "status": "simulated",
            "would_call": to_phone,
            "script": script,
            "message": (
                "Demo mode — add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and "
                "TWILIO_PHONE_NUMBER to .env to place real calls."
            ),
        }

    # Encode params for the TwiML URL
    import urllib.parse
    params = urllib.parse.urlencode({
        "name": patient_first_name,
        "meds": "|".join(med_names),
    })
    twiml_url = f"{APP_URL}/api/reminders/twiml?{params}"

    try:
        client = _twilio_client()
        call = client.calls.create(
            to=to_phone,
            from_=TWILIO_FROM_NUMBER,
            url=twiml_url,
            method="GET",
            timeout=30,
        )
        logger.info("Twilio call placed to %s — SID: %s", to_phone, call.sid)
        return {
            "demo": False,
            "status": call.status,
            "sid": call.sid,
            "to": to_phone,
        }
    except Exception as exc:
        logger.error("Twilio call failed to %s: %s", to_phone, exc)
        return {"error": str(exc), "to": to_phone}


# ---------------------------------------------------------------------------
# TwiML endpoint — Twilio fetches this when the patient answers
# ---------------------------------------------------------------------------

@router.get("/twiml")
async def twiml_reminder(name: str = "there", meds: str = ""):
    """Return TwiML XML that Twilio executes when the call connects."""
    from twilio.twiml.voice_response import Gather, VoiceResponse  # type: ignore[import]

    med_names = [m.strip() for m in meds.split("|") if m.strip()] if meds else []
    script = build_call_script(name, med_names)
    followup = "Press 1 if you've taken them, or press 2 to snooze 15 minutes."

    response = VoiceResponse()

    # First gather — give patient 15 seconds to respond
    gather = Gather(
        num_digits=1,
        action=f"{APP_URL}/api/reminders/call-response",
        method="POST",
        timeout=15,
        finish_on_key="",
    )
    gather.say(script, voice="Polly.Joanna", language="en-US")
    gather.say(followup, voice="Polly.Joanna", language="en-US")
    response.append(gather)

    # No response — say goodbye
    response.say(
        "We didn't hear a response. Please take your medications and "
        "check in with Heali when you're ready. Take care!",
        voice="Polly.Joanna",
        language="en-US",
    )

    return Response(content=str(response), media_type="application/xml")


# ---------------------------------------------------------------------------
# Call response webhook — Twilio POSTs here when patient presses a key
# ---------------------------------------------------------------------------

@router.post("/call-response")
async def call_response(
    Digits: str = Form(default=""),
    CallSid: str = Form(default=""),
    To: str = Form(default=""),
):
    """Handle keypress from patient. Logs medication taken or schedules snooze."""
    from twilio.twiml.voice_response import VoiceResponse  # type: ignore[import]

    response = VoiceResponse()
    logger.info("Call response — SID: %s, Digits: %s", CallSid, Digits)

    if Digits == "1":
        response.say(
            "Wonderful! Your medications have been logged as taken. "
            "Have a great day and stay healthy!",
            voice="Polly.Joanna",
            language="en-US",
        )
        # In production: log medication taken for the user associated with this call
        logger.info("Medication confirmed taken — CallSid %s, To: %s", CallSid, To)

    elif Digits == "2":
        response.say(
            "No problem! I'll remind you again in 15 minutes. "
            "Make sure to take your medications soon. Goodbye!",
            voice="Polly.Joanna",
            language="en-US",
        )
        # In production: schedule a follow-up call in 15 minutes
        logger.info("Snooze requested — CallSid %s", CallSid)

    else:
        response.say(
            "I didn't catch that. Please remember to take your medications. "
            "You can also check in with Heali anytime. Take care!",
            voice="Polly.Joanna",
            language="en-US",
        )

    return Response(content=str(response), media_type="application/xml")


# ---------------------------------------------------------------------------
# Demo / test endpoint — places a call using mock patient data
# ---------------------------------------------------------------------------

@router.post("/test-voice-call")
async def test_voice_call(authorization: str = Header(default=None)):
    """Place a demo medication reminder call using Maria Garcia's mock profile.

    - If TWILIO_DEMO_PHONE is set: calls that number (use your own phone for demo)
    - If Twilio credentials are missing: returns the simulated script
    """
    # Pull demo patient data
    patient_name = PATIENT_PROFILE.get("name", "Maria Garcia")
    patient_first_name = patient_name.split()[0]
    patient_phone = PATIENT_PROFILE.get("phone", "+15550199")

    # Use TWILIO_DEMO_PHONE if set, otherwise dial patient's mock number
    to_phone = DEMO_PHONE if DEMO_PHONE else patient_phone

    # Build medication list from mock data (all morning meds for demo)
    med_names = build_medication_list(MEDICATIONS)

    result = place_reminder_call(to_phone, patient_first_name, med_names)
    result["patient"] = patient_name
    result["medications"] = med_names

    return result
