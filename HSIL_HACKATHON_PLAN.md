# Heali: Pre-Clinical Intelligence Layer
## Harvard Health Systems Innovation Lab Hackathon 2026
### April 10-11, 2026

---

## The Pitch

> "Heali watches the patient continuously, understands them visually and verbally in their own language, predicts deterioration before it becomes a crisis, and when a crisis approaches — it plugs into the health system itself. For the first time, a district health officer can see high-risk patients in real time, not after they show up in an emergency room."

---

## Team

| Name | Role | Responsibilities |
|------|------|------------------|
| **Abishek** | Architect | System architecture, backend APIs, AI agent orchestration, FHIR integration, Gemini pipeline, database design, deployment |
| **Nanda** | Accessibility & UI/UX | Accessible design (WCAG compliance), multilingual UI, responsive layouts, elderly-friendly typography, color contrast, screen reader support |
| **Rishika** | UI/UX & Usability Testing | User flow testing, usability heuristics, patient persona testing, edge case identification, demo script rehearsal |
| **Darsana** | Testing & Creative Director | End-to-end testing, demo video production, pitch deck design, visual branding, hackathon presentation delivery |

---

## What Heali Is

Heali is a **multimodal AI health companion** that serves as a Pre-Clinical Intelligence Layer bridging patients and physicians. It uses:

- **Native audio streaming** with Gemini Live for real-time voice interaction
- **Multilingual support** (English, Hindi/Hinglish, Spanish, Kannada)
- **Camera-based** pill verification, food logging, prescription reading, and visual symptom analysis
- **6 specialized AI agents** coordinated by a root agent (Guardian, Interpreter, Insights, Onboarding, Booking, Exercise)

**Stack**: React 18 (Vite) + FastAPI + Google ADK + Gemini 2.0 + SQLite/Firestore

---

## Features: Previous (Existing)

These features were built before the hackathon enhancements:

| Feature | Description |
|---------|-------------|
| Voice Guardian | Real-time voice companion using Gemini Live native audio streaming |
| Medication Management | Schedule tracking, pill verification via camera, adherence logging |
| Vitals Tracking | Blood pressure, blood sugar, weight logging with trend analysis |
| Food Logging | Camera-based meal scanning + manual logging with nutrition analysis |
| Prescription/Report Scanner | OCR-based extraction from prescriptions and lab reports |
| Exercise Coaching | Camera-based posture detection for guided workouts |
| Family Dashboard | Caregiver linking with family code system, adherence monitoring |
| Doctor Booking | Appointment scheduling with nearby clinic search |
| Multilingual Support | Full voice + UI support for English, Hindi, Spanish, Kannada |
| Predictive Health Analytics | Rule-based + LLM health risk pattern detection |
| Emergency Detection | Binary red-line keyword matching with negation awareness |
| Family Alerts | Automated SMS/call alerts to caregivers on health concerns |

---

## Features: Current (Hackathon Enhancements)

### Feature 1: 3-Tier Safety Alert System + Audit Log
**Status**: COMPLETE

**What it does**: Transforms the binary emergency detection (red_line/not) into a medico-legally auditable Green/Amber/Red tiered alert system.

| Tier | Trigger | Action |
|------|---------|--------|
| **RED** | `red_line` severity (chest pain, stroke, etc.) | Emergency services + family alert + full audit log |
| **AMBER** | `urgent` / `moderate` severity (fever, dizziness, etc.) | Family + CHW alert + first-aid guidance |
| **GREEN** | `mild` severity | Log + nudge, continue guidance |

**Key files**:
- `agents/guardian/tools.py` — Enhanced `initiate_emergency_protocol()` with 3-tier logic
- `app/api/alerts.py` — CHW webhook + alert history API
- `src/pages/FamilyDashboard.tsx` — Safety Alert History section with tier-colored badges

**API endpoints**:
- `GET /api/alerts/history` — Audit trail with tier/date filtering
- `POST /api/alerts/chw` — Community Health Worker notification webhook

---

### Feature 2: Clinical Brief + FHIR R4 Export
**Status**: COMPLETE

**What it does**: Auto-generates a structured clinical summary from ALL patient data (profile, medications, adherence, vitals, food, prescriptions, reports, safety logs, symptoms). Exportable as a FHIR R4 Bundle for any hospital EHR.

**Clinical Brief includes**:
- Patient demographics (name, age, conditions, allergies, blood type)
- Medication list with adherence score and missed doses
- Vital sign summaries with trends (BP, blood sugar)
- Recent symptoms
- Safety alert summary (red/amber/green counts)
- Emergency incident count
- Scanned document count

**FHIR R4 Bundle produces**:
- `Patient` resource
- `Observation` resources (one per vital type)
- `MedicationStatement` resources (one per active medication)
- `DiagnosticReport` resources (from scanned lab reports)

**Key files**:
- `agents/clinical_brief/tools.py` — `generate_clinical_brief()` + `convert_to_fhir_r4()`
- `app/api/clinical_brief.py` — REST endpoints
- `src/pages/ClinicalBrief.tsx` — Doctor-facing clinical brief viewer with FHIR download

**API endpoints**:
- `GET /api/clinical-brief/{user_id}` — JSON clinical brief
- `GET /api/clinical-brief/{user_id}?format=fhir` — FHIR R4 Bundle

---

### Feature 3: Re-hospitalization Risk Score
**Status**: COMPLETE

**What it does**: Predicts 30-day re-hospitalization risk (0.0-1.0) using patient data + Gemini structured reasoning. Includes rule-based fallback if LLM is unavailable.

**Input features** (all already collected by Heali):
- Medication adherence %
- Blood sugar standard deviation (vitals variance)
- Symptom frequency count
- Emergency incident count
- Amber/Red alert count
- Age + chronic conditions

**Output**: `{risk_score, risk_level, contributing_factors[], recommended_actions[]}`

**Key files**:
- `agents/insights/tools.py` — `get_rehospitalization_risk()`
- `src/components/RiskGauge.tsx` — Animated circular gauge (reusable)
- `src/pages/Dashboard.tsx` — Risk gauge widget added

**API endpoint**:
- `GET /api/clinical-brief/{user_id}/risk` — Risk score with factors

---

### Feature 4: Visual Symptom Analysis
**Status**: COMPLETE

**What it does**: Extends Heali's camera to analyze visible symptoms (rashes, swelling, wounds) using Gemini Vision with culturally localized plain-language explanations.

**Urgency levels**: `informational` | `monitor` | `seek-care` | `emergency`
- If urgency = `emergency` → auto-triggers Red alert via safety protocol
- Stores observation to `symptoms` collection
- Always includes disclaimer: "This is not a medical diagnosis"

**Key files**:
- `agents/interpreter/tools.py` — `analyze_visual_symptom()`
- `agents/interpreter/agent.py` — Tool registered
- `agents/shared/prompts.py` — ROOT + INTERPRETER instructions updated for routing

---

### Feature 5: Doctor Dashboard
**Status**: COMPLETE

**What it does**: Dedicated physician-facing clinical view consuming all new APIs. Professional, clean design without companion branding.

**Dashboard sections**:
1. Patient Header (name, age, conditions, blood type, allergies)
2. Risk Score Gauge (30-day re-hospitalization)
3. Contributing Factors + Recommended Actions
4. Medications with adherence score
5. Vital Signs with trend indicators
6. Active Safety Alerts (tier-colored)
7. Recent Symptoms
8. Scanned Documents summary
9. FHIR Export button

**Key files**:
- `src/pages/DoctorDashboard.tsx` — Full physician dashboard
- `src/components/RiskGauge.tsx` — Shared risk gauge component

**Routes**: `/doctor`, `/clinical-brief` (both in sidebar navigation)

---

## Features: Future Enhancements (Post-Hackathon Roadmap)

| Feature | Description | Impact |
|---------|-------------|--------|
| **Multi-patient Doctor Dashboard** | Support viewing multiple patients with risk-sorted list | Scale from 1:1 to population health |
| **CHW Mobile App** | Lightweight PWA for community health workers receiving Amber/Red alerts | Extend reach to rural areas |
| **SMART on FHIR Launch** | Embed Heali inside hospital EHRs as a SMART app | Direct EHR integration |
| **Wearable Integration** | Continuous vitals from smartwatches/glucose monitors | Real-time monitoring |
| **Federated Learning** | Privacy-preserving model improvement across hospital systems | Better predictions without data sharing |
| **WHO ICD-11 Coding** | Auto-code symptoms and conditions to ICD-11 | Standardized disease classification |
| **Medication Image Recognition** | Identify pills from camera without barcode | Better pill verification |
| **Voice Biomarker Detection** | Detect stress, fatigue, respiratory issues from voice patterns | Passive health monitoring |
| **Multi-language Expansion** | Add Bengali, Tamil, Arabic, Swahili | Serve more populations |
| **Discharge Summary Parser** | Auto-ingest hospital discharge summaries into patient profile | Seamless care transitions |

---

## Hackathon Challenges Addressed

From the HSIL Participant Guide:

| Challenge | How Heali Addresses It |
|-----------|----------------------|
| **#2 Diagnosis** | Visual symptom analysis, clinical brief generation, FHIR export for physician review |
| **#3 Chatbots** | Full multimodal AI companion with native audio, camera, 4 languages |
| **#8 Health Literacy** | Plain-language explanations in patient's own language, prescription reading, medication info |
| **#9 Preventive Engagement** | Re-hospitalization risk prediction, 3-tier safety alerts, proactive health pattern detection |

---

## Team Work Breakdown

### Abishek (Architect) — Technical Implementation

**Before Hackathon (Done)**:
- [x] Set up local-first development (SQLite, no GCP costs)
- [x] Implement 3-Tier Safety Alert system with audit logging
- [x] Build Clinical Brief generator + FHIR R4 converter
- [x] Implement Re-hospitalization Risk Score (Gemini + rule-based fallback)
- [x] Add Visual Symptom Analysis to interpreter agent
- [x] Build Doctor Dashboard with all data integrations
- [x] Fix aiosqlite connection handling for production stability
- [x] Fix auth token flow for skipAuth/local mode
- [x] Register all new API routes and sidebar navigation

**During Hackathon**:
- [ ] Deploy to cloud for live demo (Railway/Fly.io)
- [ ] Seed demo data for compelling patient scenarios
- [ ] Stress-test all API endpoints
- [ ] Support team with any technical blockers
- [ ] Handle live demo during presentation

---

### Nanda (Accessibility & UI/UX) — Design & Accessibility

**Before Hackathon**:
- [ ] Audit all new pages (Clinical Brief, Doctor Dashboard) for WCAG 2.1 AA compliance
- [ ] Ensure all tier-colored badges have sufficient contrast ratios
- [ ] Test with screen readers (VoiceOver/NVDA) on key flows
- [ ] Verify responsive layouts on mobile, tablet, desktop
- [ ] Ensure font sizes are elderly-friendly (min 16px body, 14px labels)
- [ ] Review Risk Gauge for color-blind accessibility (add patterns/labels)
- [ ] Verify all form inputs have proper labels and ARIA attributes

**During Hackathon**:
- [ ] Polish UI based on usability testing feedback from Rishika
- [ ] Ensure demo flows look polished on presentation display
- [ ] Quick-fix any visual issues found during rehearsal

**Key files to review**:
- `src/pages/DoctorDashboard.tsx` — Professional clinical styling
- `src/pages/ClinicalBrief.tsx` — Data-dense layout
- `src/pages/FamilyDashboard.tsx` — Safety alert history section
- `src/components/RiskGauge.tsx` — SVG gauge accessibility
- `tailwind.config.ts` — Theme colors and spacing

---

### Rishika (UI/UX & Usability Testing) — Testing & User Flows

**Before Hackathon**:
- [ ] Create test personas: elderly diabetic patient, family caregiver, physician
- [ ] Test complete patient flow: onboarding → voice chat → dashboard → clinical brief
- [ ] Test physician flow: Doctor Dashboard → review risk → view alerts → download FHIR
- [ ] Test family flow: Family Dashboard → view safety alert history
- [ ] Test emergency flow: say "chest pain" → verify Red alert triggers → check audit log
- [ ] Test Amber flow: say "I feel dizzy" → verify Amber alert → check family notification
- [ ] Document any UX friction points with screenshots
- [ ] Verify multilingual flows (switch language in voice → check UI updates)
- [ ] Test FHIR download button — verify valid JSON bundle downloads

**During Hackathon**:
- [ ] Run through the full demo script 3x before presentation
- [ ] Time the demo (aim for 5-7 minutes)
- [ ] Identify backup paths if any demo step fails
- [ ] Be ready to switch to backup scenarios

**Test script template**:
```
1. Open Heali → show Welcome page
2. Navigate to Voice Guardian → say "I have a headache and feel dizzy"
   → Verify Amber alert appears
3. Navigate to Dashboard → show Risk Gauge
4. Navigate to Doctor Dashboard → show clinical overview + FHIR export
5. Navigate to Clinical Brief → show full summary + download FHIR
6. Navigate to Family Dashboard → show Safety Alert History
7. Back to Voice → say "I have severe chest pain"
   → Verify Red alert triggers, emergency number shown
8. Check alert history → verify both alerts logged
```

---

### Darsana (Testing & Creative Director) — QA, Pitch & Presentation

**Before Hackathon**:
- [ ] End-to-end testing of all 5 new features
- [ ] Test edge cases: empty data, no internet, slow API responses
- [ ] Design pitch deck (8-10 slides):
  1. Problem: patients fall through cracks between clinic visits
  2. Solution: Heali as Pre-Clinical Intelligence Layer
  3. Demo: live walkthrough (3-4 minutes)
  4. Architecture: system diagram showing patient ↔ Heali ↔ physician flow
  5. Safety: 3-tier alert system with audit trail
  6. Interoperability: FHIR R4 export for any EHR
  7. Prediction: re-hospitalization risk score
  8. Impact: metrics and scalability vision
  9. Team
  10. Q&A
- [ ] Create 60-second elevator pitch script
- [ ] Design system architecture diagram for slides
- [ ] Record backup demo video (in case live demo fails)

**During Hackathon**:
- [ ] Lead presentation delivery
- [ ] Manage Q&A — route technical questions to Abishek
- [ ] Ensure smooth transitions between demo and slides
- [ ] Handle timing (strict hackathon limits)

**Pitch key messages**:
1. "Heali is not a chatbot. It's a clinical intelligence layer."
2. "Every alert is auditable. Every interaction is logged."
3. "FHIR R4 means it plugs into ANY hospital system."
4. "The risk score predicts crises BEFORE they happen."
5. "It speaks the patient's language — literally."

---

## Architecture Overview

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Patient     │◄───►│      Heali       │◄───►│   Physician  │
│  (Voice/Cam)  │     │   (Gemini ADK)   │     │  (Dashboard) │
└──────────────┘     └────────┬─────────┘     └──────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
        │  Guardian  │  │ Insights  │  │Interpreter │
        │  (Safety)  │  │ (Analysis)│  │(Docs/Lang) │
        └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
              │               │               │
              └───────────────┼───────────────┘
                              │
                    ┌─────────▼─────────┐
                    │    Data Layer      │
                    │  SQLite/Firestore  │
                    │  Safety Logs       │
                    │  Clinical Briefs   │
                    │  FHIR R4 Bundles   │
                    └───────────────────┘
```

---

## File Summary

### New Files Created (7)
| File | Purpose |
|------|---------|
| `agents/clinical_brief/__init__.py` | Clinical brief module init |
| `agents/clinical_brief/tools.py` | Clinical brief generator + FHIR R4 converter |
| `app/api/clinical_brief.py` | Clinical brief + risk score REST API |
| `app/api/alerts.py` | Safety alert history + CHW webhook API |
| `src/pages/ClinicalBrief.tsx` | Clinical brief viewer page |
| `src/pages/DoctorDashboard.tsx` | Physician dashboard |
| `src/components/RiskGauge.tsx` | Reusable animated risk gauge |

### Modified Files (15)
| File | Changes |
|------|---------|
| `agents/shared/firestore_service.py` | Added safety_log + symptoms + incidents read/write methods |
| `agents/shared/sqlite_service.py` | Added `safety_logs` table, new methods, fixed aiosqlite connection bug |
| `agents/guardian/tools.py` | 3-tier `initiate_emergency_protocol()` with SafetyLog persistence |
| `agents/insights/tools.py` | Added `get_rehospitalization_risk()` |
| `agents/insights/agent.py` | Registered risk tool |
| `agents/interpreter/tools.py` | Added `analyze_visual_symptom()` |
| `agents/interpreter/agent.py` | Registered visual symptom tool, updated description |
| `agents/shared/prompts.py` | Updated INTERPRETER + ROOT routing for visual symptoms |
| `agents/shared/ui_tools.py` | Added `/doctor`, `/clinical-brief` to valid routes |
| `app/main.py` | Registered alerts + clinical_brief routers |
| `src/App.tsx` | Added `/doctor`, `/clinical-brief` routes |
| `src/lib/api.ts` | Added `getClinicalBrief`, `getRiskScore`, `getAlertHistory` |
| `src/pages/Dashboard.tsx` | Added risk gauge widget |
| `src/pages/FamilyDashboard.tsx` | Added safety alert history section |
| `src/components/AppSidebar.tsx` | Added Clinical Brief + Doctor View nav items |
| `src/contexts/AuthContext.tsx` | Fixed getIdToken skipAuth priority |

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install
pip install -r requirements.txt  # or: uv sync

# 2. Set environment
cp .env.example .env
# Ensure: GOOGLE_API_KEY, USE_FIRESTORE=false, SKIP_AUTH_FOR_TESTING=true

# 3. Build + Run (single server)
npm run build && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# 4. Open http://localhost:8000
```

---

## Verification Checklist

### Backend
- [ ] `curl http://localhost:8000/api/clinical-brief/demo_user` → JSON clinical brief
- [ ] `curl http://localhost:8000/api/clinical-brief/demo_user?format=fhir` → FHIR R4 Bundle
- [ ] `curl http://localhost:8000/api/clinical-brief/demo_user/risk` → Risk score
- [ ] `curl http://localhost:8000/api/alerts/history?patient_uid=demo_user` → Alert history

### Frontend
- [ ] `/doctor` → Doctor Dashboard with patient info, risk gauge, alerts
- [ ] `/clinical-brief` → Clinical brief with FHIR download button
- [ ] `/dashboard` → Risk gauge widget shows
- [ ] `/family` → Safety alert history section shows

### Voice Integration
- [ ] Say "I have severe chest pain" → Red alert + safety log
- [ ] Say "I feel dizzy and nauseous" → Amber alert + family notification
- [ ] Show skin rash on camera → Visual symptom analysis triggers
- [ ] Say "show me my clinical brief" → Routes to clinical brief page
