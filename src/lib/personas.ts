import healiBalanced from "@/assets/heali_balanced.png";
import healiCalm from "@/assets/heali_calm.png";
import healiEnergetic from "@/assets/heali_energetic.png";
import healiInformative from "@/assets/heali_informative.png";

export interface Persona {
  id: string;
  name: string;
  title: string;
  language: string;
  languageCode: string;
  avatar: string;
  greeting: string;
  description: string;
  /** Optional role label (e.g. "VOICE COMPANION") for onboarding voice cards. */
  role?: string;
  /** Gemini voice name for backend (e.g. Aoede, Kore). Used when saving profile from onboarding. */
  voiceName?: string;
}

/** Voice-centric Heali options for the onboarding select step. */
export const HEALI_VOICES: Persona[] = [
  {
    id: "heali-balanced",
    name: "Heali (Balanced)",
    title: "Voice · Balanced",
    role: "VOICE COMPANION",
    language: "English",
    languageCode: "en",
    avatar: healiBalanced,
    greeting: "Hello, I'm Heali. I'm here to support you.",
    description: "A warm, familiar voice that provides steady support.",
    voiceName: "Aoede",
  },
  {
    id: "heali-calm",
    name: "Heali (Calm)",
    title: "Voice · Calm",
    role: "VOICE COMPANION",
    language: "English",
    languageCode: "en",
    avatar: healiCalm,
    greeting: "It's okay. Take a deep breath. I'm with you.",
    description: "A soothing, gentle voice designed to reduce health anxiety.",
    voiceName: "Kore",
  },
  {
    id: "heali-energetic",
    name: "Heali (Energetic)",
    title: "Voice · Energetic",
    role: "VOICE COMPANION",
    language: "English",
    languageCode: "en",
    avatar: healiEnergetic,
    greeting: "You've got this! Let's hit that goal today!",
    description: "An upbeat, motivational voice to keep you moving.",
    voiceName: "Puck",
  },
  {
    id: "heali-informative",
    name: "Heali (Informative)",
    title: "Voice · Informative",
    role: "VOICE COMPANION",
    language: "English",
    languageCode: "en",
    avatar: healiInformative,
    greeting: "Today's data shows good progress. Let's review the plan.",
    description: "A clear, authoritative voice for direct health insights.",
    voiceName: "Charon",
  },
];

export interface OnboardingState {
  persona: Persona | null;
  customName?: string;
  customAvatar?: string;
  completed: boolean;
}

const STORAGE_KEY = "heali_onboarding";
const LEGACY_STORAGE_KEY = "medlive_onboarding";

export function getOnboardingState(): OnboardingState {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        localStorage.setItem(STORAGE_KEY, legacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        raw = legacy;
      }
    }
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse onboarding state:", e);
  }
  return { persona: null, completed: false };
}

export function saveOnboardingState(state: OnboardingState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearOnboarding() {
  localStorage.removeItem(STORAGE_KEY);
}
