// Voice WebSocket configuration
// Uses VITE_WS_URL env var if set, otherwise derives from current page origin.
// In dev the Vite proxy forwards /ws and /api to the backend, so same-origin works.
const _isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
const _wsProtocol = _isSecure ? "wss:" : "ws:";

// Always use the current page origin unless explicitly overridden.
// Vite proxy handles forwarding to the backend in dev; Cloud Run handles it in prod.
const _backendHost =
  import.meta.env.VITE_BACKEND_HOST ||
  (typeof window !== "undefined" ? window.location.host : "localhost:8001");

export const VOICE_WS_BASE_URL =
  import.meta.env.VITE_WS_URL || `${_wsProtocol}//${_backendHost}`;

// REST API base URL (same backend, HTTP)
const _httpProtocol = _isSecure ? "https:" : "http:";
export const REST_API_BASE_URL =
  import.meta.env.VITE_API_URL || `${_httpProtocol}//${_backendHost}`;

// Default user for demo/testing (when SKIP_AUTH_FOR_TESTING=true on backend)
export const DEFAULT_USER_ID = "demo_user";

// Audio recording settings (must match backend: audio/pcm;rate=16000)
export const AUDIO_SAMPLE_RATE = 16000;
export const AUDIO_CHANNELS = 1;

// Language persona codes matching backend PERSONA_DEFAULTS
export const LANGUAGE_PERSONAS: Record<string, { label: string; code: string }> = {
  en: { label: "English", code: "en" },
  hi: { label: "Hindi", code: "hi" },
  es: { label: "Spanish", code: "es" },
  kn: { label: "Kannada", code: "kn" },
};
