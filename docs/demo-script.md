# Heali — 4-Minute Demo Video Script

**Total runtime:** ~4 minutes
**Tone:** Warm, clear, slightly dramatic — product launch style
**Format:** Screen recording with voiceover (VO) + overlaid captions
**Music:** Calm, uplifting ambient track; subtle swell at the close

---

## [0:00 – 0:20] COLD OPEN — The Problem

> *Fade in: quiet bedroom, 6 AM. Phone notification glows on nightstand.*

**VO:** "Every day, millions of people manage multiple medications, chronic conditions, and the weight of aging — often alone. A missed dose, a misread prescription, a moment of confusion at the wrong time can have real consequences."

> *Cut to: elderly person squinting at a prescription label, unsure.*

**VO:** "What if there was a health companion that was always there — one that listens, understands, and acts?"

> *Logo appears centre-screen: **HEALI***

---

## [0:20 – 0:45] PRODUCT INTRO — What Is Heali?

> *App opens on the Welcome screen. Clean, calm UI fades in.*

**VO:** "Introducing Heali — your AI health bestie. A real-time voice companion powered by Google's Gemini Live API, designed to help you manage your health, your medications, and your family's wellbeing — in the language you're most comfortable in."

> *Language selector animates through: English → हिन्दी → ಕನ್ನಡ → Español*

**VO:** "Heali speaks your language. Whether you're in New York, Bengaluru, or Mexico City."

---

## [0:45 – 1:20] FEATURE 1 — Voice Guardian (Core Feature)

> *Navigate to the Voice Guardian page. Soft pulsing mic animation.*

**VO:** "At the heart of Heali is the Voice Guardian — a live, two-way audio AI that never sleeps."

> *User taps the mic. Session starts.*

**User (spoken):** "Heali, I just took my metformin."

> *Transcript appears on screen. Heali responds with audio.*

**Heali:** "Got it! I've logged your metformin for 8:15 AM. You're on track with your morning medications — great job!"

> *Dashboard medication card ticks green in the background.*

**VO:** "Just speak naturally. Heali logs your medications, tracks your vitals, and keeps you on schedule — no forms, no tapping, no confusion."

**User:** "My blood pressure is 128 over 82."

> *Vitals card on the dashboard updates in real time.*

**Heali:** "128 over 82 — noted! That's within a healthy range. Keep it up!"

**VO:** "Every piece of information is saved securely to your personal health profile — accessible anytime, from anywhere."

---

## [1:20 – 1:50] FEATURE 2 — Emergency Detection

> *Voice Guardian session still active. Tone shifts slightly.*

**VO:** "But Heali does more than log data. It's watching out for you."

> *User says:* "I have a terrible chest pain and I can't breathe."

**VO:** "The moment Heali detects a critical emergency — in any of four languages — it springs into action."

> *Screen flashes a red alert banner: **⚠ Emergency Detected**. Twilio call initiates. Push notification fires to a family member's phone.*

**Heali:** "I've detected a potential emergency. I'm calling emergency services and alerting your family right now. Please stay calm and stay with me."

**VO:** "Automatic emergency calls. Instant family alerts. All within seconds of a single spoken phrase — in English, Hindi, Kannada, or Spanish."

---

## [1:50 – 2:20] FEATURE 3 — Pill Check + Prescription Reading

> *Navigate to the Pill Check page. Camera activates.*

**VO:** "Not sure if you're taking the right pill? Just show it to the camera."

> *User holds a tablet up to the camera. Scanning animation plays.*

**Heali:** "That's your lisinopril 10mg. Correct pill, correct dose — good to go!"

> *Navigate to the Prescriptions page. User taps 'Upload Prescription'.*

**VO:** "And when your doctor gives you a new prescription — no need to decode the handwriting."

> *User photographs a handwritten prescription. Upload progress bar completes.*

**Heali:** "I can see this is a prescription for Amlodipine 5mg, once daily. Shall I add this to your medication schedule and check for any interactions with your current meds?"

**VO:** "Heali reads prescriptions and lab reports, checks for drug interactions, and adds new medications directly to your schedule."

---

## [2:20 – 2:50] FEATURE 4 — Family Dashboard + Caregiver View

> *Transition: a second browser tab opens — the caregiver's view.*

**VO:** "Health is a family matter. Heali's Family Dashboard gives caregivers peace of mind — without being intrusive."

> *Family Dashboard shows: medication adherence gauge at 87%, vitals trend chart, today's health digest.*

**VO:** "See your loved one's adherence score, latest vitals, and a daily digest — all updated in real time."

> *A push notification pops up on the caregiver's phone: "Mom missed her evening blood pressure medication."*

**Heali (notification):** "Your mom missed her 8 PM Amlodipine dose. You may want to check in."

**VO:** "Get proactive alerts when something needs attention — so you can step in before a small miss becomes a big problem."

---

## [2:50 – 3:20] FEATURE 5 — Exercise Coach + Food Log

> *Navigate to the Exercise page. A 10-minute session card is shown.*

**VO:** "Heali isn't just about medications. It's your complete wellness companion."

> *User starts a session. Exercise Coach begins.*

**Heali:** "Let's start with Box Breathing. Inhale… 2… 3… 4. Hold… 2… 3… 4. Exhale… 2… 3… 4. Perfect form!"

> *Camera posture overlay shows a gentle green silhouette — real-time feedback.*

**VO:** "Guided exercise sessions with real-time posture coaching via your camera. From breathing exercises to seated stretches — all from the comfort of home."

> *Transition to Food Log page. User taps the camera icon.*

**VO:** "Logging meals is just as simple. Take a photo or speak — Heali tracks your calories and macros automatically."

> *Photo of a meal is uploaded. Nutrition breakdown appears: 420 kcal · 28g protein · 45g carbs · 12g fat.*

**VO:** "Heali flags nutritional gaps, celebrates wins, and even suggests heart-healthy recipes tailored to your dietary restrictions."

---

## [3:20 – 3:45] TECH STACK OVERVIEW

> *Clean slide animation — the system architecture diagram fades in, components highlighting as they're mentioned.*

**VO:** "Under the hood, Heali is built on a robust, production-ready stack."

> *Frontend layer highlights.*

**VO:** "The frontend is **React 18** with **TypeScript**, styled with **Tailwind CSS** and shadcn/ui — responsive and accessible on any device."

> *Backend layer highlights.*

**VO:** "The backend runs on **FastAPI**, deployed on **Google Cloud Run**, streaming audio and video over **WebSockets** for ultra-low-latency interaction."

> *AI layer highlights.*

**VO:** "The AI brain is **Google's Gemini Live API** — native audio streaming with real-time understanding. Agent orchestration is handled by **Google ADK**, coordinating six specialised sub-agents."

> *External services highlight: Firestore, Firebase, Cloud Tasks, Twilio.*

**VO:** "Data lives in **Firestore**. Auth and push notifications through **Firebase**. Medication reminders scheduled via **Cloud Tasks**. Emergency calls routed through **Twilio**."

---

## [3:45 – 4:00] CLOSING — Call to Action

> *Return to the Welcome screen. Heali logo pulses gently. Music swells.*

**VO:** "Heali isn't just an app. It's a companion that understands your health, speaks your language, and is always by your side."

> *Final frame: tagline centred on screen.*

**VO:** "Whether you're managing your own health or caring for someone you love — Heali is here."

> *Fade to black. Logo hold.*

**VO:** "Heali. Your AI bestie."

---

## Production Notes

| Timestamp | Screen | Notes |
|-----------|--------|-------|
| 0:00–0:20 | Stock footage / B-roll | Bedroom scene, elderly person with prescription |
| 0:20–0:45 | App screen recording | Welcome → Onboarding → Language selector |
| 0:45–1:20 | App screen recording | VoiceGuardian.tsx — live session |
| 1:20–1:50 | App screen recording | VoiceGuardian — emergency alert overlay |
| 1:50–2:20 | App screen recording | PillCheck.tsx → Prescriptions.tsx |
| 2:20–2:50 | Split screen | App (patient) + second device (caregiver FamilyDashboard) |
| 2:50–3:20 | App screen recording | Exercise.tsx → FoodLog.tsx |
| 3:20–3:45 | Slide / Animation | Architecture diagram with animated callouts |
| 3:45–4:00 | App screen / Logo | Welcome screen → logo close |

### Recommended VO Pace
- Speak at ~140 words per minute
- Add 0.5s natural pauses at section transitions
- Total script word count: ~580 words → ~4 min 10 sec at 140 wpm (trim as needed)
