# Heali – Your AI Bestie

An AI-powered health companion that helps you manage medications, track vitals, log meals, and stay connected with your family. Speak naturally in your language—Heali is your friendly health guardian.

## Features

- **Voice Guardian** – Talk to your AI companion via voice. Supports English, Hindi, Kannada, and Spanish.
- **Medication Management** – Log medications, set reminders, and track adherence.
- **Health Tracking** – Record blood pressure, blood sugar, weight, and other vitals.
- **Food Log** – Describe or scan meals to log nutrition.
- **Exercise & Wellness** – Guided stretching and posture sessions with voice coaching.
- **Pill Check** – Verify medications using your camera.
- **Family Connection** – Share health updates and emergency alerts with caregivers.
- **Doctor Booking** – Find clinics and book appointments.

## Tech Stack

| Layer | Stack |
|-------|-------|
| Frontend | React, Vite, TypeScript, Tailwind CSS, shadcn/ui |
| Backend | FastAPI, Python 3.10+ |
| AI | Google ADK, Gemini Live (native audio) |
| Data | Firebase Auth, Firestore |

## Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+ and [uv](https://github.com/astral-sh/uv)
- **Firebase** project with Auth and Firestore
- **Gemini API** key (or Vertex AI)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/Abi5678/Heali-Your-AI-bestie.git
cd Heali-Your-AI-bestie
npm install
uv sync
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set:

- `GOOGLE_API_KEY` – Gemini API key
- `GOOGLE_CLOUD_PROJECT` – GCP project ID
- `GOOGLE_APPLICATION_CREDENTIALS` – Path to Firebase Admin SDK JSON
- `USE_FIRESTORE=true` – Enable Firestore
- `VITE_FIREBASE_*` – Firebase web config (from Firebase Console)

### 3. Run the app

**Terminal 1 – Backend**

```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
```

**Terminal 2 – Frontend**

```bash
npm run dev
```

Open **http://localhost:8082**

## Project Structure

```
├── app/                 # FastAPI backend
│   ├── main.py          # App entry, WebSocket, REST API
│   └── api/             # Routers (medications, food, family, etc.)
├── agents/              # AI agents (Google ADK)
│   ├── agent.py         # Root coordinator
│   ├── onboarding/     # First-time setup
│   ├── guardian/       # Medications, vitals, emergency
│   ├── exercise/       # Wellness sessions
│   ├── interpreter/    # Prescription/lab translation
│   ├── insights/       # Adherence, trends
│   └── booking/        # Doctor appointments
├── src/                 # React frontend
│   ├── pages/          # VoiceGuardian, Profile, Exercise, etc.
│   ├── components/
│   └── lib/
└── credentials/         # Firebase Admin SDK (gitignored)
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_API_KEY` | Gemini API key |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | Firebase Admin SDK path |
| `USE_FIRESTORE` | `true` to use Firestore |
| `SKIP_AUTH_FOR_TESTING` | `true` for local demo (no login) |
| `VITE_API_URL` | Backend URL (e.g. `http://localhost:8002`) |
| `VITE_WS_URL` | WebSocket URL (e.g. `ws://localhost:8002`) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (port 8082) |
| `npm run build` | Build for production |
| `uv run uvicorn app.main:app --port 8002` | Start backend |

## License

MIT
