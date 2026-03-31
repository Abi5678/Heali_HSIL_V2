"""Shared constants for Heali agents."""

import os

# Primary model for bidi-streaming voice/video
LIVE_MODEL = os.getenv(
    "MEDLIVE_MODEL",
    "gemini-live-2.5-flash-native-audio",
)

# Model for non-streaming tasks (insights, analysis)
ANALYSIS_MODEL = "gemini-2.0-flash"

# Application name (used in ADK session service)
APP_NAME = "heali"

# ---------------------------------------------------------------------------
# Red Line Emergency Protocol — hardcoded safety keywords
# ---------------------------------------------------------------------------

RED_LINE_KEYWORDS = [
    # English
    "chest pain",
    "heart attack",
    "stroke",
    "seizure",
    "severe bleeding",
    "unconscious",
    "not breathing",
    "can't breathe",
    "cannot breathe",
    "choking",
    "anaphylaxis",
    "overdose",
    "fainting",
    "collapsed",
    "convulsion",
    "severe allergic reaction",
    "swelling of face",
    "swelling of throat",
    "throat closing",
    "sudden vision loss",
    "can't see",
    "coughing blood",
    "vomiting blood",
    "severe headache worst",
    "sudden numbness",
    "sudden weakness one side",
    "slurred speech",
    # Hindi / Hinglish
    "seene mein dard",
    "chhati mein dard",
    "chest mein pain",
    "heart attack",
    "saans nahi aa rahi",
    "saans nahi le pa raha",
    "saans nahi le pa rahi",
    "behosh",
    "behosh ho gaya",
    "behosh ho gayi",
    "daura pad raha",
    "daura padna",
    "khoon nikal raha",
    "bahut zyada khoon",
    "gala band ho raha",
    "gala suj gaya",
    "ankh se dikhna band",
    "khoon ki ulti",
    # Spanish
    "dolor de pecho",
    "ataque al corazon",
    "ataque al corazón",
    "derrame cerebral",
    "convulsion",
    "convulsión",
    "no puedo respirar",
    "no puede respirar",
    "se desmayo",
    "se desmayó",
    "inconsciente",
    "sangrado severo",
    "mucha sangre",
    "se esta ahogando",
    "se está ahogando",
    "reaccion alergica severa",
    "reacción alérgica severa",
    "hinchazón en la garganta",
    "vomitando sangre",
    "perdida de vision",
    "pérdida de visión",
    # Kannada (transliterated for keyword matching on transcribed text)
    "ene kaaNisuttilla",
    "usiru barutilla",
    "yenne munde hogide",
    "hrudaya aghatam",
    "pakshavayu",
    "fit bandide",
    "rakta sravavaaguttide",
]

# Regex fragments that negate a symptom (e.g. "no chest pain")
NEGATION_PREFIXES = [
    r"no\s",
    r"not\s",
    r"don'?t\s(?:have\s)?",
    r"without\s",
    r"deny\s",
    r"denied\s",
    r"never\s",
    r"isn'?t\s",
    r"no\slonger\s",
    r"doesn'?t\s",
]

RED_LINE_RESPONSE = (
    "This sounds like a medical emergency. "
    "Please call {emergency_number} immediately. "
    "I am alerting your family now. Stay calm and do not move."
)

EMERGENCY_NUMBERS = {
    "US": "911",
    "IN": "112",
    "UK": "999",
    "EU": "112",
    "AU": "000",
    "default": "911",
}
