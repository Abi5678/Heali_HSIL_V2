# Heali — System Architecture

## Overview

Heali is a real-time AI health companion built on a cloud-native stack. Users interact via voice and camera through a React web app; audio is streamed bidirectionally over WebSockets to a FastAPI backend, which delegates to a Google ADK multi-agent system powered by Gemini Live API.

---

## High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          HEALI SYSTEM ARCHITECTURE                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│           USER / PATIENT (Browser)         │
│         React 18 + TypeScript + Vite       │
│                                            │
│   ┌──────────────┐  ┌──────────────┐       │
│   │  Microphone  │  │   Camera     │       │
│   │  (Audio In)  │  │  (Video In)  │       │
│   └──────┬───────┘  └──────┬───────┘       │
│          │                 │               │
│   Pages:                                   │
│   Dashboard · VoiceGuardian · FoodLog      │
│   Exercise · PillCheck · Prescriptions     │
│   FamilyDashboard · DoctorBooking          │
│   Profile · Reminders · Translator         │
└──────────────────┬─────────────────────────┘
                   │
                   │  WebSocket  ws://.../ws/{user_id}
                   │  REST API   https://.../api/*
                   │  Auth       Firebase ID Token (Bearer)
                   │
                   ▼
┌────────────────────────────────────────────────────────┐
│              FASTAPI BACKEND  (Python 3.11)             │
│              Deployed on Google Cloud Run               │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  WebSocket  /ws/{user_id}                        │  │
│  │  Receives: audio chunks + video frames           │  │
│  │  Sends:    audio response + UI event JSON        │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  REST Routers:                                         │
│  /api/medications  /api/food     /api/family           │
│  /api/scan         /api/avatar   /api/calling          │
│  /api/reminders    /api/tasks/*  /api/dashboard        │
│                                                        │
│  Firebase Auth token verification on all endpoints     │
└───────────────────────┬────────────────────────────────┘
                        │
           ┌────────────┴────────────┐
           │    GOOGLE ADK RUNTIME   │
           │    Agent Orchestration  │
           │                        │
           │  ┌────────────────────┐ │
           │  │    ROOT AGENT      │ │
           │  │   (Coordinator)    │ │
           │  └──────────┬─────────┘ │
           │             │           │
           └─────────────┼───────────┘
                         │
         ┌───────────────┼───────────────────────────┐
         │     SPECIALIZED SUB-AGENTS                │
         │                                           │
         │  ┌─────────────────┐  ┌────────────────┐  │
         │  │  Guardian Agent  │  │ Interpreter    │  │
         │  │  · Medications   │  │ Agent          │  │
         │  │  · Vitals        │  │ · Translation  │  │
         │  │  · Emergency     │  │ · Rx Reading   │  │
         │  │  · Pill Check    │  │ · Drug Interact│  │
         │  │  · Meal Logging  │  └────────────────┘  │
         │  └─────────────────┘                       │
         │                                           │
         │  ┌─────────────────┐  ┌────────────────┐  │
         │  │  Insights Agent  │  │ Booking Agent  │  │
         │  │  · Adherence %   │  │ · Symptom      │  │
         │  │  · Vital Trends  │  │   Triage       │  │
         │  │  · Daily Digest  │  │ · Appt Search  │  │
         │  │  · Family Alerts │  │ · Confirmation │  │
         │  └─────────────────┘  └────────────────┘  │
         │                                           │
         │  ┌─────────────────┐  ┌────────────────┐  │
         │  │  Exercise Agent  │  │ Onboarding     │  │
         │  │  · Guided 10min  │  │ Agent          │  │
         │  │  · Posture Coach │  │ · Intake Form  │  │
         │  │  · Progress Log  │  │ · Profile Save │  │
         │  └─────────────────┘  └────────────────┘  │
         └───────────────────────────────────────────┘
                         │
                         ▼
         ┌──────────────────────────────┐
         │      GEMINI LIVE API         │
         │      (Google AI)             │
         │                              │
         │  Model: gemini-live-2.5-     │
         │         flash-native-audio   │
         │                              │
         │  · Native audio streaming    │
         │  · Real-time transcription   │
         │  · Multilingual: EN/HI/KN/ES │
         │  · Tool-call execution       │
         └──────────────────────────────┘

─────────────────────────────────────────────────────────
EXTERNAL SERVICES
─────────────────────────────────────────────────────────

┌────────────┐  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐
│ Firestore  │  │ Firebase Auth   │  │ Cloud Tasks  │  │   Twilio     │
│ (Database) │  │ + FCM           │  │ (Scheduler)  │  │  (Calls)     │
│            │  │                 │  │              │  │              │
│ users/     │  │ ID Token auth   │  │ Medication   │  │ Emergency    │
│ ├ profile  │  │ Push notif (FCM)│  │ reminders →  │  │ family calls │
│ ├ meds     │  │                 │  │ FCM push     │  │              │
│ ├ vitals   │  │                 │  │              │  │              │
│ ├ meals    │  │                 │  │              │  │              │
│ ├ adherence│  │                 │  │              │  │              │
│ └ family   │  │                 │  │              │  │              │
└────────────┘  └─────────────────┘  └──────────────┘  └──────────────┘

─────────────────────────────────────────────────────────
FAMILY / CAREGIVER VIEW
─────────────────────────────────────────────────────────

┌──────────────────────────────────────────┐
│     Caregiver Browser / App              │
│     FamilyDashboard.tsx                  │
│                                          │
│  ← Adherence % (7-day compliance)        │
│  ← Latest vitals + trend charts          │
│  ← Daily health digest                  │
│  ← Emergency alerts (push + Twilio call) │
└──────────────────────────────────────────┘
```

---

## Key Data Flows

| User Action | End-to-End Path |
|-------------|-----------------|
| **Voice command** | Mic → WebSocket → FastAPI → ADK Runner → Gemini Live → tool calls → Firestore → audio + UI event → Speaker |
| **Vital log** | "My BP is 128/82" → Guardian agent → `log_vital()` → Firestore `vitals_log/` |
| **Medication reminder** | Cloud Tasks schedule → `POST /api/tasks/reminder` → FCM push → user notification |
| **Emergency detection** | Voice keyword match → Guardian agent → Twilio call + FCM alert to family |
| **Pill scan** | Camera frame → WebSocket video → Guardian `verify_pill()` → drug DB lookup → spoken response |
| **Prescription read** | Image upload → `POST /api/scan` → Gemini 2.0 Flash → extracted drug data → add to schedule |
| **Family alert** | Insights agent detects anomaly → `send_family_alert()` → FCM → Caregiver FamilyDashboard |
| **Exercise session** | Exercise Agent → step-by-step voice coaching → camera posture frames → `complete_exercise_session()` |
| **Appointment booking** | Symptom description → Booking Agent triage → nearby clinic search → `book_appointment()` |

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router, TanStack Query |
| **Backend** | FastAPI (Python 3.11), WebSockets, uvicorn |
| **AI / LLM** | Google Gemini Live API (`gemini-live-2.5-flash-native-audio`), Gemini 2.0 Flash (scan analysis) |
| **Agent Framework** | Google ADK (Agent Development Kit) — multi-agent orchestration |
| **Database** | Google Cloud Firestore |
| **Auth** | Firebase Authentication (ID tokens) |
| **Push Notifications** | Firebase Cloud Messaging (FCM) |
| **Scheduled Tasks** | Google Cloud Tasks |
| **Emergency Calls** | Twilio Voice API |
| **Deployment** | Docker (multi-stage), Google Cloud Run |

---

## Firestore Data Model

```
users/{user_id}
  ├── profile            # name, language, avatar, emergency_contact, companion_name
  ├── medications/       # name, dosage, frequency, dose_times, pill_description
  ├── adherence_log/     # date, medication, time, taken (bool)
  ├── vitals_log/        # type, value, unit, timestamp
  ├── food_logs/         # description, calories, protein, carbs, fat, date, timestamp
  ├── health_restrictions# allergies[], diet_type, current_medications
  └── family/            # linked_user_id, link_code, permissions
```

---

## Multilingual Support

Emergency detection keywords are hardcoded in four languages:

| Language | Code |
|----------|------|
| English | `en` |
| Hindi | `hi` |
| Kannada | `kn` |
| Spanish | `es` |

The active language is passed as a WebSocket query parameter (`?language=hi`) and injected into every agent's system prompt. Gemini Live handles transcription and synthesis natively in the selected language.

---

## Security

| Mechanism | Implementation |
|-----------|---------------|
| **Auth** | Firebase ID token verified on every WS connection and REST call |
| **Emergency negation** | "NOT chest pain" is not treated as an emergency (negation detection) |
| **Family authorization** | Unique one-time link codes prevent unauthorized access |
| **Input validation** | FastAPI Pydantic models; profile API whitelists allowed fields |
| **CORS** | Restricted to known frontend origins via `CORS_ALLOWED_ORIGINS` env var |
| **Secrets** | API keys via environment variables; never committed to repo |
