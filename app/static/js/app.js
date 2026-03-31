/**
 * Heali WebSocket Client & UI Controller (Phase 4)
 *
 * Handles:
 * - Firebase Auth gate (redirect to auth.html if not signed in)
 * - WebSocket connection with real Firebase UID + ID token
 * - Audio recording (microphone) and playback (Gemini responses)
 * - Camera frame capture for pill verification
 * - Streaming transcript accumulation
 * - Custom avatar + companion name from localStorage
 * - Hero avatar tap to start/stop listening
 * - Chat-active body class triggers layout transition
 */

import { AudioRecorder } from "./audio-recorder.js";
import { AudioPlayer } from "./audio-player.js";
import { CameraManager } from "./camera.js";

// ---------------------------------------------------------------------------
// Auth gate — must be signed in before anything else
// ---------------------------------------------------------------------------

const uid = localStorage.getItem("heali_uid");
const idToken = localStorage.getItem("heali_id_token");

if (!uid || !idToken) {
  window.location.href = "/static/auth.html";
  // halt execution while redirect happens
  throw new Error("Redirecting to auth");
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let websocket = null;
let audioRecorder = null;
let audioPlayer = null;
let cameraManager = null;

let isConnected = false;
let isListening = false;
let hasGreeted = false;
let isGeminiReady = false;   // true after server sends {type:"ready"}
let pendingGreeting = false; // true if user tapped before Gemini was ready
let cameraInterval = null;
let upstreamFlushIntervalId = null; // cleared in stopListening

// Streaming transcript: track the current "live" agent bubble
let currentAgentBubble = null;
let accumulatedAgentText = "";

// Same for user (input_transcription is also cumulative)
let currentUserBubble = null;
let accumulatedUserText = "";

// Track current UI mode to avoid redundant DOM thrashing on every audio chunk
let currentStatusMode = "";

// Active agent tracking
let currentActiveAgent = "";
let agentBadgeHideTimer = null;

// Ambient camera mode (continuous vision, distinct from pill-only camera)
let isAmbientCameraActive = false;
let ambientCameraInterval = null;

// Debounced scroll — batches scrollTop updates to one per animation frame
let _scrollPending = false;
function scheduleTranscriptScroll() {
  if (_scrollPending) return;
  _scrollPending = true;
  requestAnimationFrame(() => {
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
    _scrollPending = false;
  });
}

// ---------------------------------------------------------------------------
// Locale strings
// ---------------------------------------------------------------------------

const LOCALE = {
  en: {
    listening: "Listening...", speaking: "Speaking...", tapToSpeak: "Tap to speak",
    you: "You", disconnected: "Disconnected",
    pill: "Verify Pill", appts: "My Appointments", doctor: "Call Doctor", sos: "Emergency",
  },
  hi: {
    listening: "Sun raha hoon...", speaking: "Bol raha hoon...", tapToSpeak: "Bolne ke liye tap karein",
    you: "Aap", disconnected: "Disconnected",
    pill: "Goli Jaanchen", appts: "Meri Appointments", doctor: "Doctor ko Call", sos: "Emergency",
  },
  es: {
    listening: "Escuchando...", speaking: "Hablando...", tapToSpeak: "Toca para hablar",
    you: "Tú", disconnected: "Desconectado",
    pill: "Verificar Pastilla", appts: "Mis Citas", doctor: "Llamar Doctor", sos: "Emergencia",
  },
  kn: {
    listening: "ಆಲಿಸುತ್ತಿದ್ದೇನೆ...", speaking: "ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ...", tapToSpeak: "ಮಾತನಾಡಲು ಟ್ಯಾಪ್ ಮಾಡಿ",
    you: "ನೀವು", disconnected: "ಸಂಪರ್ಕ ಕಡಿತ",
    pill: "ಮಾತ್ರೆ ಪರಿಶೀಲಿಸಿ", appts: "ನನ್ನ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್", doctor: "ವೈದ್ಯರಿಗೆ ಕರೆ ಮಾಡಿ", sos: "ತುರ್ತು",
  },
};

const LANG_TO_LOCALE = {
  "English": LOCALE.en,
  "Hindi": LOCALE.hi,
  "Spanish": LOCALE.es,
  "Kannada": LOCALE.kn,
};

const LANG_TO_GREETING = {
  "English": "Hello! How can I help you today?",
  "Hindi": "Namaste! Main aapki kaise madad kar sakti hoon?",
  "Spanish": "¡Hola! ¿En qué te ayudo?",
  "Kannada": "ನಮಸ್ಕಾರ! ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
};

// Language + companion name from localStorage (written by onboarding)
// Use `let` so applyProfileLocally() can update it live after a profile save
let language = localStorage.getItem("heali_language") || "English";
let currentLocale = LANG_TO_LOCALE[language] || LOCALE.en;

// ---------------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------------

const statusText = document.getElementById("status-text");
const transcript = document.getElementById("transcript");
const transcriptDrawer = document.getElementById("transcript-drawer");
const drawerHandle = document.getElementById("drawer-handle");
const avatarHeroTap = document.getElementById("avatar-hero-tap");
const avatarImg = document.getElementById("companion-avatar");
const avatarName = document.getElementById("companion-name");
const avatarGreeting = document.getElementById("companion-greeting");
const avatarBubble = document.getElementById("avatar-bubble");
const showPillBtn = document.getElementById("show-pill-btn");
const cameraContainer = document.getElementById("camera-container");
const closeCameraBtn = document.getElementById("close-camera-btn");
const chatTextInput = document.getElementById("chat-text-input");
const chatSendBtn = document.getElementById("chat-send-btn");
const chatMicBtn = document.getElementById("chat-mic-btn");
const liveTranslateBtn = document.getElementById("live-translate-btn");
const interpreterBanner = document.getElementById("interpreter-banner");
const agentBadgeEl = document.getElementById("agent-badge");
const agentBadgeIcon = document.getElementById("agent-badge-icon");
const agentBadgeLabel = document.getElementById("agent-badge-label");
const ambientCameraBtn = document.getElementById("ambient-camera-btn");

// ---------------------------------------------------------------------------
// Agent Badge — shows which specialist is currently responding
// ---------------------------------------------------------------------------

const AGENT_META = {
  heali: { icon: "💙", label: "Companion", agent: "companion" },
  guardian_agent: { icon: "🛡️", label: "Guardian", agent: "guardian" },
  interpreter_agent: { icon: "🌐", label: "Interpreter", agent: "interpreter" },
  insights_agent: { icon: "📊", label: "Insights", agent: "insights" },
  booking_agent: { icon: "📅", label: "Booking", agent: "booking" },
  onboarding_agent: { icon: "👋", label: "Onboarding", agent: "onboarding" },
};

function showAgentBadge(authorName) {
  if (!agentBadgeEl || !authorName) return;
  const meta = AGENT_META[authorName];
  if (!meta) return;

  // Don't flicker if same agent is already shown
  if (currentActiveAgent === authorName) return;
  currentActiveAgent = authorName;

  agentBadgeIcon.textContent = meta.icon;
  agentBadgeLabel.textContent = meta.label;
  agentBadgeEl.dataset.agent = meta.agent;
  agentBadgeEl.style.display = "inline-flex";

  // Re-trigger animation
  agentBadgeEl.classList.remove("agent-badge");
  void agentBadgeEl.offsetWidth;
  agentBadgeEl.classList.add("agent-badge");

  // Auto-hide after turn completes (will be cancelled if agent speaks again)
  if (agentBadgeHideTimer) clearTimeout(agentBadgeHideTimer);
  agentBadgeHideTimer = setTimeout(() => {
    agentBadgeEl.style.display = "none";
    currentActiveAgent = "";
  }, 5000);
}

// ---------------------------------------------------------------------------
// Initialize persona UI from localStorage
// ---------------------------------------------------------------------------

function initPersonaUI() {
  // Default voice if never set (e.g. pre-existing user before voice profile feature)
  if (!localStorage.getItem("heali_voice_name")) localStorage.setItem("heali_voice_name", "Aoede");

  const companionName = localStorage.getItem("heali_companion_name") || "Health Companion";
  const avatarB64 = localStorage.getItem("heali_avatar");

  // Set companion name
  if (avatarName) avatarName.textContent = companionName;

  // Set greeting
  const greeting = LANG_TO_GREETING[language] || LANG_TO_GREETING["English"];
  if (avatarGreeting) avatarGreeting.textContent = greeting;

  // Set custom avatar if available
  if (avatarImg && avatarB64) {
    avatarImg.src = avatarB64;
    avatarImg.style.display = "block";
    const fallback = document.getElementById("avatar-icon-fallback");
    if (fallback) fallback.style.display = "none";
  }

  // Apply localized button labels
  const lPill = document.getElementById("label-pill");
  const lAppts = document.getElementById("label-appts");
  const lDoctor = document.getElementById("label-doctor");
  const lSos = document.getElementById("label-sos");
  if (lPill) lPill.textContent = currentLocale.pill;
  if (lAppts) lAppts.textContent = currentLocale.appts;
  if (lDoctor) lDoctor.textContent = currentLocale.doctor;
  if (lSos) lSos.textContent = currentLocale.sos;
}

initPersonaUI();

// ---------------------------------------------------------------------------
// Token refresh: keep Firebase ID token fresh every 50 min
// ---------------------------------------------------------------------------

async function refreshToken() {
  if (idToken === "demo") return; // skip when using skip-auth-for-testing
  try {
    // firebase global is available from the compat SDK loaded in index.html
    const user = firebase.auth().currentUser;
    if (!user) {
      console.warn("[Heali] refreshToken: no current user, skipping");
      return;
    }
    const newToken = await user.getIdToken(/* forceRefresh= */ true);
    localStorage.setItem("heali_id_token", newToken);
    console.log("[Heali] Token refreshed successfully");
  } catch (e) {
    console.error("[Heali] Token refresh failed:", e);
    // If refresh fails, redirect to auth so user can re-sign in
    window.location.href = "/static/auth.html";
  }
}

setInterval(refreshToken, 50 * 60 * 1000);

// ---------------------------------------------------------------------------
// FCM push reminders: register token + preferences when user allows notifications
// ---------------------------------------------------------------------------

async function registerRemindersIfEnabled() {
  try {
    const res = await fetch("/api/config");
    const config = await res.json();
    const vapidKey = config.vapidKey && config.vapidKey.trim();
    if (!vapidKey) return;

    if (!("Notification" in window) || !firebase.messaging) return;
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") return;

    const reg = await navigator.serviceWorker.register("/static/firebase-messaging-sw.js", {
      scope: "/static/",
    });
    const messaging = firebase.messaging();
    const token = await messaging.getToken({
      vapidKey,
      serviceWorkerRegistration: reg,
    });
    if (!token) return;

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const registerRes = await fetch("/api/reminders/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("heali_id_token")}`,
      },
      body: JSON.stringify({
        fcm_token: token,
        reminder_meds_enabled: true,
        reminder_lunch_enabled: true,
        lunch_reminder_time: "12:00",
        timezone,
      }),
    });
    if (registerRes.ok) {
      localStorage.setItem("heali_reminders_registered", "1");
      console.log("[Heali] Reminders registered");
    }
  } catch (e) {
    console.warn("[Heali] Reminders registration skipped or failed:", e);
  }
}

// Run once after a short delay so we don't block initial load
if (typeof Promise !== "undefined" && typeof fetch !== "undefined") {
  setTimeout(registerRemindersIfEnabled, 3000);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function setStatus(text, mode = "") {
  if (statusText) statusText.textContent = text;

  // Guard: skip classList churn if mode hasn't changed (called on every audio chunk)
  if (mode === currentStatusMode) return;
  currentStatusMode = mode;

  document.body.classList.remove("listening", "speaking");
  if (mode === "listening") {
    document.body.classList.add("listening");
  } else if (mode === "active") {
    document.body.classList.add("speaking");
  }
}

/**
 * Append or stream text into the transcript drawer.
 */
function appendTranscript(text, role, streaming = false) {
  // Show chat panel when first message arrives
  if (transcriptDrawer.classList.contains("collapsed")) {
    transcriptDrawer.classList.remove("collapsed");
    document.body.classList.add("chat-active");
  }

  // Streaming text: update existing bubble with latest transcription.
  if (streaming && role === "agent" && currentAgentBubble) {
    accumulatedAgentText += text;
    const content = currentAgentBubble.querySelector(".message-content");
    if (content) content.textContent = accumulatedAgentText;
    scheduleTranscriptScroll();
    return;
  }
  if (streaming && role === "user" && currentUserBubble) {
    accumulatedUserText += text;
    const content = currentUserBubble.querySelector(".message-content");
    if (content) content.textContent = accumulatedUserText;
    scheduleTranscriptScroll();
    return;
  }

  // Create a new message row
  const row = document.createElement("div");
  row.className = `chat-message-row ${role}-row`;

  // Avatar Thumbnail
  const avatar = document.createElement("img");
  avatar.className = "chat-avatar";
  if (role === "agent") {
    const companionAvatarImg = document.getElementById("companion-avatar");
    avatar.src = companionAvatarImg ? companionAvatarImg.src : "/static/img/avatar_placeholder.png";
    avatar.onerror = function () { this.src = "/static/img/avatar_placeholder.png"; this.onerror = null; };
  } else {
    avatar.src = "/static/img/avatar_placeholder.png"; // Future feature: use actual user avatar
    avatar.onerror = function () { this.src = "/static/img/avatar_placeholder.png"; this.onerror = null; };
  }

  // Message Bubble
  const div = document.createElement("div");
  div.className = `message ${role}`;

  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = role === "user"
    ? currentLocale.you
    : (avatarName ? avatarName.textContent.split(" ")[0] : "");

  const content = document.createElement("span");
  content.className = "message-content";
  content.textContent = text;

  div.appendChild(label);
  div.appendChild(content);

  row.appendChild(avatar);
  row.appendChild(div);

  transcript.appendChild(row);
  scheduleTranscriptScroll();

  if (role === "agent") {
    currentAgentBubble = row;
    accumulatedAgentText = text;
  } else if (role === "user") {
    currentUserBubble = row;
    accumulatedUserText = text;
  }
}

// ---------------------------------------------------------------------------
// Camera Logic
// ---------------------------------------------------------------------------

async function toggleCamera() {
  if (!cameraManager) {
    cameraManager = new CameraManager("camera-video");
  }

  if (cameraManager.isActive) {
    cameraManager.stop();
    cameraContainer.classList.remove("active");
    if (cameraInterval) clearInterval(cameraInterval);
  } else {
    const started = await cameraManager.start();
    if (started) {
      cameraContainer.classList.add("active");

      cameraInterval = setInterval(() => {
        const b64 = cameraManager.captureFrameBase64();
        if (b64 && websocket && websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({ type: "image", data: b64 }));
        }
      }, 1000);

      if (!isListening) startListening();
    }
  }
}

if (showPillBtn) {
  showPillBtn.addEventListener("click", () => {
    toggleCamera();

    if (websocket && isGeminiReady) {
      websocket.send(JSON.stringify({
        type: "text",
        text: "[SYSTEM: PROACTIVE VISION MODE ENABLED. The patient is showing you a pill. Do NOT wait for them to speak. Monitor the video feed continuously. As soon as you identify a pill, describe it and call `verify_pill` immediately. If the image is unclear, instruct them to move it closer or hold it steady. Do NOT start with 'Hello' — get straight to the visual analysis.]"
      }));
    } else {
      window.pendingPillPrompt = true;
    }

    if (!isListening) {
      appendTranscript("Activating camera to show pill...", "user");
    }
  });
}

if (closeCameraBtn) {
  closeCameraBtn.addEventListener("click", toggleCamera);
}

// ---------------------------------------------------------------------------
// Book Appointment — start voice session and route to booking agent
// ---------------------------------------------------------------------------

const bookApptBtn = document.getElementById("book-appt-btn");
if (bookApptBtn) {
  bookApptBtn.addEventListener("click", () => {
    const bookingPrompt = "[SYSTEM: The patient wants to book a doctor appointment. You are now the booking agent. Ask the patient to describe their symptoms so you can triage them and find the right doctor. Use your triage_symptoms tool, then find_nearby_hospitals, then get_available_slots, and finally book_appointment once the patient confirms. Do NOT start with a generic greeting — get straight to asking about their symptoms.]";

    if (websocket && isGeminiReady) {
      websocket.send(JSON.stringify({
        type: "text",
        text: bookingPrompt
      }));
    } else {
      window.pendingBookingPrompt = bookingPrompt;
    }

    // Start listening if not already
    if (!isListening) {
      startListening();
    }

    appendTranscript("Starting appointment booking...", "user");
  });
}

// ---------------------------------------------------------------------------
// Food Logging Mode
// ---------------------------------------------------------------------------

const foodBtn = document.getElementById("log-food-btn");
const foodOverlay = document.getElementById("food-overlay");
const foodVideo = document.getElementById("food-video");
const foodCaptureBtn = document.getElementById("food-capture-btn");
const foodCloseBtn = document.getElementById("food-close-btn");
const foodResults = document.getElementById("food-results");
const foodResultsBody = document.getElementById("food-results-body");
const foodConfirmBtn = document.getElementById("food-confirm-btn");
const foodRetryBtn = document.getElementById("food-retry-btn");

let foodStream = null;
let currentFoodData = null; // Store fetched macros for saving

async function openFoodMode() {
  if (!foodOverlay) return;
  try {
    foodStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    foodVideo.srcObject = foodStream;
    foodOverlay.style.display = "flex";
    foodOverlay.classList.add("active");
    foodResults.style.display = "none";
  } catch (err) {
    console.error("Food camera error:", err);
    alert("Could not access camera for food logging.");
  }
}

function closeFoodMode() {
  if (foodStream) {
    foodStream.getTracks().forEach((t) => t.stop());
    foodStream = null;
  }
  if (foodVideo) foodVideo.srcObject = null;
  if (foodOverlay) {
    foodOverlay.style.display = "none";
    foodOverlay.classList.remove("active");
  }
}

async function performFoodScan() {
  if (!foodVideo || !foodStream) return;
  if (!scanCanvas) {
    scanCanvas = document.createElement("canvas");
  }
  scanCanvas.width = foodVideo.videoWidth || 1280;
  scanCanvas.height = foodVideo.videoHeight || 960;
  const ctx = scanCanvas.getContext("2d");
  ctx.drawImage(foodVideo, 0, 0, scanCanvas.width, scanCanvas.height);
  const dataUrl = scanCanvas.toDataURL("image/jpeg", 0.7);
  const b64 = dataUrl.split(",")[1];

  // Show loading state
  foodResults.style.display = "flex";
  foodResultsBody.innerHTML = '<p style="text-align:center;">Analyzing macros with AI...</p>';
  foodConfirmBtn.style.display = "none";
  foodRetryBtn.style.display = "none";

  try {
    const res = await fetch("/api/food/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: b64 }),
    });

    if (!res.ok) throw new Error("Failed to analyze image");

    currentFoodData = await res.json();
    renderFoodResults(currentFoodData);
  } catch (err) {
    foodResultsBody.innerHTML = `<p style="color:var(--accent);">${escHtml(err.message)}</p>`;
    foodConfirmBtn.style.display = "none";
    foodRetryBtn.style.display = "inline-block";
  }
}

function renderFoodResults(data) {
  if (data.food_items.length === 0 || data.calories === 0) {
    foodResultsBody.innerHTML = "<p>No food detected. Please try again with a clearer image.</p>";
    foodConfirmBtn.style.display = "none";
    foodRetryBtn.style.display = "inline-block";
    return;
  }

  let html = `<p><strong>Items:</strong> ${escHtml(data.food_items.join(", "))}</p>`;
  html += `<table style="width:100%; margin-top:8px;">`;
  html += `<tr><td>Calories</td><td style="text-align:right"><strong>${data.calories}</strong></td></tr>`;
  html += `<tr><td>Protein</td><td style="text-align:right">${data.protein_g}g</td></tr>`;
  html += `<tr><td>Carbs</td><td style="text-align:right">${data.carbs_g}g</td></tr>`;
  html += `<tr><td>Fat</td><td style="text-align:right">${data.fat_g}g</td></tr>`;
  html += `</table>`;

  foodResultsBody.innerHTML = html;
  foodConfirmBtn.style.display = "inline-block";
  foodRetryBtn.style.display = "inline-block";
}

async function saveFoodLog() {
  if (!currentFoodData) return;
  foodConfirmBtn.textContent = "Saving...";
  foodConfirmBtn.disabled = true;

  try {
    const res = await fetch("/api/food/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: uid, ...currentFoodData }),
    });
    if (!res.ok) throw new Error("Failed to save log");

    closeFoodMode();
    appendTranscript(`Logged ${currentFoodData.calories} calories to your journal.`, "user");

    // Notify the Live Agent about the logged food
    if (websocket && isGeminiReady) {
      const foodItemsStr = currentFoodData.food_items.join(", ");
      const prompt = `[SYSTEM: The patient just logged a meal consisting of: ${foodItemsStr}. Macros: ${currentFoodData.calories} calories, ${currentFoodData.protein_g}g protein, ${currentFoodData.carbs_g}g carbs, ${currentFoodData.fat_g}g fat. Briefly acknowledge this enthusiastically in ${language} and perhaps offer a short comment on the meal's nutritional value.]`;
      websocket.send(JSON.stringify({ type: "text", text: prompt }));

      // Auto-start listening if not already, so the agent can respond
      if (!isListening) {
        startListening();
      }
    }

  } catch (err) {
    console.error(err);
    alert("Could not save info.");
  } finally {
    foodConfirmBtn.textContent = "Log Food";
    foodConfirmBtn.disabled = false;
  }
}

if (foodBtn) foodBtn.addEventListener("click", openFoodMode);
if (foodCloseBtn) foodCloseBtn.addEventListener("click", closeFoodMode);
if (foodCaptureBtn) foodCaptureBtn.addEventListener("click", performFoodScan);
if (foodRetryBtn) foodRetryBtn.addEventListener("click", () => { foodResults.style.display = "none"; });
if (foodConfirmBtn) foodConfirmBtn.addEventListener("click", saveFoodLog);

// ---------------------------------------------------------------------------
// Document Scan Mode (single-shot high-res capture)
// ---------------------------------------------------------------------------

const scanOverlay = document.getElementById("scan-overlay");
const scanVideo = document.getElementById("scan-video");
const scanCaptureBtn = document.getElementById("scan-capture-btn");
const scanCloseBtn = document.getElementById("scan-close-btn");
const scanTypeToggle = document.getElementById("scan-type-toggle");
const scanTypeLabel = document.getElementById("scan-type-label");
const scanResults = document.getElementById("scan-results");
const scanResultsTitle = document.getElementById("scan-results-title");
const scanResultsBody = document.getElementById("scan-results-body");
const scanConfirmBtn = document.getElementById("scan-confirm-btn");
const scanRetryBtn = document.getElementById("scan-retry-btn");
const scanBtn = document.getElementById("scan-btn");

let scanStream = null;
let scanType = "prescription"; // or "report"
let scanCanvas = null;

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function openScanMode() {
  if (!scanOverlay) return;
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    scanVideo.srcObject = scanStream;
    scanOverlay.classList.add("active");
    scanResults.style.display = "none";
  } catch (err) {
    console.error("Scan camera error:", err);
    alert("Could not access camera for scanning.");
  }
}

// ---------------------------------------------------------------------------
// Live Translate Mode
// ---------------------------------------------------------------------------

let isTranslateActive = false;

function toggleLiveTranslate() {
  isTranslateActive = !isTranslateActive;

  if (isTranslateActive) {
    // Determine the target language for the banner & prompt
    // If the patient's language is English, the interpreter bridges to a
    // detected language; otherwise it bridges to English.
    const targetLang = language === "English" ? "Auto-detect" : "English";

    // Show banner
    if (interpreterBanner) {
      document.getElementById("interpreter-banner-text").textContent =
        `Interpreter Active: ${language} ↔ ${targetLang}`;
      interpreterBanner.style.display = "inline-flex";
    }


    // Build a clear routing instruction for the root agent, followed by
    // interpreter-specific behaviour rules that it will see via the shared
    // conversation history once the transfer happens.
    if (websocket && isGeminiReady) {
      const patientLang = language;
      const doctorLang = language === "English" ? "the other speaker's language (auto-detect it)" : "English";

      const prompt = `[SYSTEM: The patient has activated LIVE INTERPRETER MODE. Route to the interpreter agent for real-time translation.

You are an expert, real-time medical interpreter. You are bridging a live conversation between a patient who speaks ${patientLang} and a doctor who speaks ${doctorLang}.

CRITICAL RULES:
1. Do not answer questions, give advice, or participate in the conversation.
2. ONLY translate what is spoken.
3. If you hear ${patientLang}, immediately translate it into ${doctorLang}.
4. If you hear ${doctorLang}, immediately translate it into ${patientLang}.
5. Maintain the exact tone, urgency, and medical terminology used by the speaker.
6. Speak entirely in the first person (e.g., if the patient says "My stomach hurts", you say "My stomach hurts", NOT "The patient says their stomach hurts").
7. Continue translating every utterance until explicitly told to stop.]`;
      websocket.send(JSON.stringify({ type: "text", text: prompt }));

      // Auto-start listening so the interpreter can hear speech
      if (!isListening) {
        startListening();
      }
    }
  } else {
    // Hide banner
    if (interpreterBanner) interpreterBanner.style.display = "none";

    // Send a clear deactivation prompt that tells the interpreter agent to
    // transfer control back to the root agent so the companion resumes.
    if (websocket && isGeminiReady) {
      const companionName = localStorage.getItem("heali_companion_name") || "Health Companion";
      const prompt = `[SYSTEM: DEACTIVATE LIVE INTERPRETER MODE. The translation session has ended. You MUST transfer back to the root heali agent now by calling transfer_to_heali. Once you are the root agent again, resume your normal role as ${companionName}, the patient's health companion. Briefly acknowledge in ${language} that translation mode is off, then ask how else you can help.]`;
      websocket.send(JSON.stringify({ type: "text", text: prompt }));
    }
  }
}

if (liveTranslateBtn) {
  liveTranslateBtn.addEventListener("click", toggleLiveTranslate);
}

// ---------------------------------------------------------------------------
// Ambient Camera — continuous vision mode (agent sees & reacts proactively)
// ---------------------------------------------------------------------------

async function toggleAmbientCamera() {
  if (isAmbientCameraActive) {
    // Stop ambient camera
    isAmbientCameraActive = false;
    if (ambientCameraInterval) { clearInterval(ambientCameraInterval); ambientCameraInterval = null; }
    if (cameraManager && cameraManager.isActive) { cameraManager.stop(); }
    cameraContainer.classList.remove("active");
    if (ambientCameraBtn) {
      ambientCameraBtn.querySelector("span.material-icons").textContent = "videocam";
      ambientCameraBtn.querySelector("#label-ambient").textContent = "Show Camera";
      ambientCameraBtn.style.background = "var(--postit,#fff9c4)";
    }
    if (websocket && isGeminiReady) {
      websocket.send(JSON.stringify({ type: "text", text: "[SYSTEM: Camera has been turned off. Resume normal conversation.]" }));
    }
    console.log("[Heali] Ambient camera stopped");
    return;
  }

  // Start ambient camera
  if (!cameraManager) cameraManager = new CameraManager("camera-video");
  const started = await cameraManager.start();
  if (!started) { showToast("Could not access camera"); return; }

  isAmbientCameraActive = true;
  cameraContainer.classList.add("active");

  if (ambientCameraBtn) {
    ambientCameraBtn.querySelector("span.material-icons").textContent = "videocam_off";
    ambientCameraBtn.querySelector("#label-ambient").textContent = "Hide Camera";
    ambientCameraBtn.style.background = "#e8f5e9";
  }

  // Stream frames every 1.5s — same channel as pill verify
  ambientCameraInterval = setInterval(() => {
    const b64 = cameraManager.captureFrameBase64();
    if (b64 && websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({ type: "image", data: b64 }));
    }
  }, 1500);

  // Tell the agent camera is active so it watches proactively
  if (websocket && isGeminiReady) {
    websocket.send(JSON.stringify({
      type: "text",
      text: `[SYSTEM: PROACTIVE VISION MODE ENABLED. You can now see what the patient sees. Monitor the video feed continuously. If you notice any medical items (pills, bottles, reports) or if the patient looks unwell, IMMEDIATELY interrupt the silence to comment on it and offer help. Do NOT wait for them to speak. Your vision is your primary input during this mode.]`
    }));
  }

  if (!isListening) startListening();
  console.log("[Heali] Ambient camera started — agent is now visually aware");
}

if (ambientCameraBtn) {
  ambientCameraBtn.addEventListener("click", toggleAmbientCamera);
}

function closeScanMode() {
  if (scanStream) {
    scanStream.getTracks().forEach((t) => t.stop());
    scanStream = null;
  }
  if (scanVideo) scanVideo.srcObject = null;
  if (scanOverlay) scanOverlay.classList.remove("active");
}

function captureFrame() {
  if (!scanVideo || !scanStream) return null;
  if (!scanCanvas) {
    scanCanvas = document.createElement("canvas");
  }
  scanCanvas.width = scanVideo.videoWidth || 1280;
  scanCanvas.height = scanVideo.videoHeight || 960;
  const ctx = scanCanvas.getContext("2d");
  ctx.drawImage(scanVideo, 0, 0, scanCanvas.width, scanCanvas.height);
  // Compress to ~80% JPEG quality
  const dataUrl = scanCanvas.toDataURL("image/jpeg", 0.8);
  return dataUrl.split(",")[1];
}

async function performScan() {
  const b64 = captureFrame();
  if (!b64) return;

  // Show loading state
  scanResults.style.display = "flex";
  scanResultsTitle.textContent = "Scanning...";
  scanResultsBody.innerHTML = '<p style="text-align:center;">Extracting details with AI...</p>';
  scanConfirmBtn.style.display = "none";
  scanRetryBtn.style.display = "none";

  const token = localStorage.getItem("heali_id_token") || "";
  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token} `,
      },
      body: JSON.stringify({ image_b64: b64, scan_type: scanType }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status} `);
    }

    const data = await res.json();
    renderScanResults(data);
  } catch (err) {
    scanResultsTitle.textContent = "Scan Failed";
    scanResultsBody.innerHTML = `< p style = "color:var(--accent);" > ${escHtml(err.message)}</p > `;
    scanConfirmBtn.style.display = "none";
    scanRetryBtn.style.display = "inline-block";
  }
}

function renderScanResults(data) {
  scanConfirmBtn.style.display = "inline-block";
  scanRetryBtn.style.display = "inline-block";

  if (scanType === "prescription") {
    scanResultsTitle.textContent = "Prescription Found";
    const meds = data.medications || [];
    if (meds.length === 0) {
      scanResultsBody.innerHTML = "<p>No medications detected. Try again with a clearer image.</p>";
      return;
    }
    let html = "<table><tr><th>Medication</th><th>Dosage</th><th>Frequency</th></tr>";
    for (const m of meds) {
      html += `< tr ><td>${escHtml(m.name)}</td><td>${escHtml(m.dosage)}</td><td>${escHtml(m.frequency)}</td></tr > `;
    }
    html += "</table>";
    if (data.doctor_name) html += `< p > <strong>Doctor:</strong> ${escHtml(data.doctor_name)}</p > `;
    if (data.date) html += `< p > <strong>Date:</strong> ${escHtml(data.date)}</p > `;
    scanResultsBody.innerHTML = html;
  } else {
    scanResultsTitle.textContent = "Lab Report Found";
    const tests = data.tests || [];
    if (tests.length === 0) {
      scanResultsBody.innerHTML = "<p>No test results detected. Try again with a clearer image.</p>";
      return;
    }
    let html = "<table><tr><th>Test</th><th>Value</th><th>Range</th><th>Status</th></tr>";
    for (const t of tests) {
      const statusColor = t.status === "high" || t.status === "low" ? "var(--accent)" : "inherit";
      html += `< tr ><td>${escHtml(t.name)}</td><td>${escHtml(t.value)} ${escHtml(t.unit)}</td>`;
      html += `< td > ${escHtml(t.reference_range)}</td > `;
      html += `< td style = "color:${statusColor};font-weight:700;" > ${escHtml(t.status)}</td ></tr > `;
    }
    html += "</table>";
    if (data.lab_name) html += `< p > <strong>Lab:</strong> ${escHtml(data.lab_name)}</p > `;
    if (data.date) html += `< p > <strong>Date:</strong> ${escHtml(data.date)}</p > `;
    scanResultsBody.innerHTML = html;
  }
}

// Wire up scan buttons
if (scanBtn) {
  scanBtn.addEventListener("click", openScanMode);
}

if (scanCaptureBtn) {
  scanCaptureBtn.addEventListener("click", performScan);
}

if (scanCloseBtn) {
  scanCloseBtn.addEventListener("click", closeScanMode);
}

if (scanTypeToggle) {
  scanTypeToggle.addEventListener("click", () => {
    scanType = scanType === "prescription" ? "report" : "prescription";
    if (scanTypeLabel) scanTypeLabel.textContent = scanType === "prescription" ? "Prescription" : "Lab Report";
  });
}

if (scanConfirmBtn) {
  scanConfirmBtn.addEventListener("click", () => {
    closeScanMode();
    appendTranscript(`${scanType === "prescription" ? "Prescription" : "Lab report"} saved.`, "user");
  });
}

if (scanRetryBtn) {
  scanRetryBtn.addEventListener("click", () => {
    scanResults.style.display = "none";
  });
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const currentToken = localStorage.getItem("heali_id_token") || "";

  // Send persona code so the server can fall back to correct language/name
  // when Firestore is unavailable (e.g. demo mode)
  const langToPersona = { Hindi: "hi", Spanish: "es", Kannada: "kn", English: "en" };
  // Read fresh from localStorage so reconnect after a profile-language-change picks up the new value
  const persona = langToPersona[localStorage.getItem("heali_language") || language] || "en";

  const queryParams = {
    token: currentToken,
    persona,
  };
  const savedName = localStorage.getItem("heali_display_name");
  if (savedName) queryParams.patient_name = savedName;

  const query = new URLSearchParams(queryParams).toString();

  const url = `${protocol}//${window.location.host}/ws/${uid}?${query}`;
  websocket = new WebSocket(url);

  websocket.onopen = () => {
    console.log("[Heali] WebSocket connected to server, waiting for Gemini...");
    isConnected = true;
    setStatus("Connecting...", ""); // Gemini Live not ready yet
  };

  websocket.onmessage = (event) => {
    try {
      const adkEvent = JSON.parse(event.data);

      if (adkEvent.type === "ready") {
        console.log("[Heali] Gemini Live ready");
        isGeminiReady = true;

        if (window.pendingPillPrompt) {
          websocket.send(JSON.stringify({
            type: "text",
            text: "[SYSTEM: The patient has just opened their camera to show you a pill. Ask them to hold the pill steady in front of the camera so you can verify it. Do NOT start your response with 'Hello' or 'I can help with that' — just get straight to the instruction.]"
          }));
          window.pendingPillPrompt = false;
        }

        if (window.pendingBookingPrompt) {
          websocket.send(JSON.stringify({
            type: "text",
            text: window.pendingBookingPrompt
          }));
          window.pendingBookingPrompt = null;
        }

        if (!isListening) setStatus(currentLocale.tapToSpeak, "");
        // Do NOT create AudioPlayer here: it would run without a user gesture and
        // the AudioContext would stay suspended, so playback would never start.
        // AudioPlayer is created only in startListening() when the user taps.
        return;
      }

      // Custom Generative UI Payload Handling
      if (adkEvent.type === "ui_update") {
        console.log("[Heali] UI Update received:", adkEvent);
        handleUIUpdate(adkEvent);
        return;
      }

      // Debug: log when we get a non-ready event (so we can see if responses arrive)
      const content = adkEvent.content;
      const hasParts = content && content.parts && content.parts.length > 0;
      let hasAudio = false;
      if (hasParts) {
        for (const p of content.parts) {
          const d = p.inlineData || p.inline_data;
          if (d && (d.data != null) && (typeof d.data === "string" ? d.data.length > 0 : d.data.byteLength > 0)) hasAudio = true;
        }
        if (hasAudio || adkEvent.turnComplete || adkEvent.turn_complete) {
          console.log("[Heali] Event from server: hasAudio=" + hasAudio + " turnComplete=" + (adkEvent.turnComplete || adkEvent.turn_complete));
        }
      }

      handleADKEvent(adkEvent);
    } catch (e) {
      console.error("[Heali] Parse error:", e);
    }
  };

  websocket.onerror = (err) => {
    console.error("[Heali] WebSocket error:", err);
  };

  websocket.onclose = (event) => {
    console.log("[Heali] WebSocket closed:", event.code, event.reason);
    isConnected = false;
    isGeminiReady = false;

    // Reset translate mode — new server session won't know about it
    if (isTranslateActive) {
      isTranslateActive = false;
      if (interpreterBanner) interpreterBanner.style.display = "none";
      console.log("[Heali] Translate mode reset due to WebSocket close");
    }

    if (event.code === 4401 && uid !== "demo_user") {
      // Auth failure — token expired, redirect to auth (skip when using skip-auth-for-testing)
      console.warn("[Heali] Auth token rejected, redirecting to auth");
      localStorage.removeItem("heali_id_token");
      window.location.href = "/static/auth.html";
      return;
    }

    setStatus(currentLocale.disconnected, "");
    setTimeout(connectWebSocket, 3000);
  };
}

// ---------------------------------------------------------------------------
// Generative UI Events Handling
// ---------------------------------------------------------------------------

function handleUIUpdate(event) {
  if (event.target === "voice_update") {
    const voice = event.data?.voice || "";
    showToast(`Voice changed to ${voice}. Reconnecting...`);
  } else if (event.target === "profile_preview") {
    showToast(`Profile data saved successfully!`);
  } else if (event.target === "adherence_chart") {
    showToast("Chart data updated.");

    // ── Booking: Nearby Hospitals Card ──
  } else if (event.target === "booking_hospitals") {
    const d = event.data;
    let html = `<div class="booking-card booking-hospitals">
      <div class="booking-card-header" style="background:#e8f5e9;border-bottom:2px dashed #4caf50;">
        🏥 <strong>Nearby Clinics</strong>
        <span style="font-size:0.75rem;opacity:0.6;margin-left:8px;">${d.department?.replace(/_/g, ' ') || ''}</span>
      </div>`;
    (d.hospitals || []).forEach((h, i) => {
      html += `<div class="booking-hospital-item" style="${i > 0 ? 'border-top:1px dashed #ccc;' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${h.name}</strong>
          <span class="booking-badge" style="background:#c8e6c9;color:#2e7d32;">${h.distance_miles} mi</span>
        </div>
        <div style="font-size:0.78rem;opacity:0.6;margin-top:2px;">📍 ${h.address}</div>
        <div style="font-size:0.78rem;opacity:0.5;margin-top:1px;">📞 ${h.phone || ''}</div>
      </div>`;
    });
    html += `</div>`;
    appendBookingCard(html);

    // ── Booking: Available Slots Card ──
  } else if (event.target === "booking_slots") {
    const d = event.data;
    let html = `<div class="booking-card booking-slots">
      <div class="booking-card-header" style="background:#e3f2fd;border-bottom:2px dashed #1976d2;">
        📅 <strong>Available Appointments</strong>
        <span style="font-size:0.75rem;opacity:0.6;margin-left:8px;">${d.hospital_name || ''}</span>
      </div>`;
    (d.slots || []).forEach((s, i) => {
      html += `<div class="booking-slot-item" style="${i > 0 ? 'border-top:1px dashed #ccc;' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong style="color:#1976d2;">${s.time}</strong>
            <span style="font-size:0.82rem;opacity:0.7;margin-left:6px;">${s.date}</span>
          </div>
        </div>
        <div style="font-size:0.85rem;margin-top:3px;">👨‍⚕️ ${s.doctor_name}</div>
      </div>`;
    });
    html += `</div>`;
    appendBookingCard(html);

    // ── Booking: Confirmation Card ──
  } else if (event.target === "booking_confirmed") {
    const a = event.data;
    const html = `<div class="booking-card booking-confirmed">
      <div class="booking-card-header" style="background:#c8e6c9;border-bottom:2px dashed #2e7d32;text-align:center;">
        ✅ <strong>Appointment Confirmed!</strong>
      </div>
      <div style="padding:14px;text-align:center;">
        <div style="font-size:1.1rem;font-weight:700;">📅 ${a.date} at ${a.time}</div>
        <div style="margin-top:6px;">🏥 ${a.hospital_name}</div>
        <div style="font-size:0.82rem;opacity:0.6;">📍 ${a.hospital_address}</div>
        <div style="margin-top:6px;">👨‍⚕️ <strong>${a.doctor_name}</strong></div>
        <div style="margin-top:10px;">
          <span style="background:#c8e6c9;padding:4px 12px;border-radius:6px;font-size:0.82rem;font-weight:600;color:#2e7d32;">
            ✅ Confirmed
          </span>
        </div>
        <div style="margin-top:8px;font-size:0.78rem;opacity:0.5;">Don't forget your medications list and insurance card!</div>
      </div>
    </div>`;
    appendBookingCard(html);

    // ── Booking: Emergency Alert ──
  } else if (event.target === "booking_emergency") {
    const d = event.data;
    const html = `<div class="booking-card booking-emergency" style="animation:pulse-red 1.5s infinite;">
      <div class="booking-card-header" style="background:#ffcdd2;border-bottom:2px dashed #d32f2f;text-align:center;">
        🚨 <strong>EMERGENCY — BOOKING REFUSED</strong>
      </div>
      <div style="padding:14px;text-align:center;">
        <div style="font-size:1rem;font-weight:700;color:#d32f2f;">${d.message}</div>
        <div style="margin-top:8px;font-size:0.85rem;opacity:0.7;">
          Detected: <strong>"${d.keyword}"</strong><br>
          Agent will NOT proceed with booking.
        </div>
      </div>
    </div>`;
    appendBookingCard(html);

    // ── Pill Verification: Result Card ──
  } else if (event.target === "pill_verified") {
    const d = event.data;
    const color = d.verified ? "#4caf50" : "#d32f2f";
    const bg = d.verified ? "#e8f5e9" : "#ffebee";
    const icon = d.verified ? "✅" : "❌";

    let html = `<div class="booking-card pill-verification" style="border: 2px solid ${color};">
      <div class="booking-card-header" style="background:${bg};border-bottom:2px dashed ${color};">
        ${icon} <strong>Pill Verification</strong>
      </div>
      <div style="padding:14px;text-align:center;">
        <div style="font-size:1.1rem;font-weight:700;color:${color};">${d.message}</div>`;

    if (d.pill_described) {
      html += `<div style="margin-top:8px;font-size:0.85rem;opacity:0.7;">
        Seen: <strong>${d.pill_described.color} ${d.pill_described.shape}</strong> (${d.pill_described.imprint})
      </div>`;
    }

    html += `</div></div>`;
    appendBookingCard(html);

    // ── Meal Logging: Confirmation Card ──
  } else if (event.target === "meal_logged") {
    const d = event.data;
    const icon = "🍲";
    const bg = "#fffde7"; // Light yellow for post-it/food feel
    const color = "#fbc02d"; // Gold/Yellow

    const html = `<div class="booking-card meal-log" style="border: 2px solid ${color};">
      <div class="booking-card-header" style="background:${bg};border-bottom:2px dashed ${color};">
        ${icon} <strong>Meal Logged</strong>
        <span style="font-size:0.75rem;opacity:0.6;margin-left:8px;">${d.type || 'snack'}</span>
      </div>
      <div style="padding:14px;text-align:center;">
        <div style="font-size:1rem;font-weight:700;">${d.description}</div>
        <div style="margin-top:8px;font-size:0.82rem;opacity:0.6;">
          Added to your daily nutrition log.
        </div>
      </div>
    </div>`;
    appendBookingCard(html);

  } else {
    showToast(`Action Completed: ${event.target.replace('_', ' ')}`);
  }
}

// Insert a rich HTML card into the transcript panel
function appendBookingCard(html) {
  if (transcriptDrawer.classList.contains("collapsed")) {
    transcriptDrawer.classList.remove("collapsed");
    document.body.classList.add("chat-active");
  }
  const div = document.createElement("div");
  div.className = "message agent booking-card-wrapper";
  div.innerHTML = html;
  transcript.appendChild(div);
  scheduleTranscriptScroll();
}

function showToast(message) {
  let toast = document.getElementById("heali-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "heali-toast";
    toast.style.position = "fixed";
    toast.style.bottom = "20px";
    toast.style.left = "50%";
    toast.style.transform = "translateX(-50%)";
    toast.style.background = "var(--primary)";
    toast.style.color = "white";
    toast.style.padding = "12px 24px";
    toast.style.borderRadius = "20px";
    toast.style.zIndex = "9999";
    toast.style.boxShadow = "var(--shadow-btn)";
    toast.style.fontFamily = "var(--font-primary)";
    toast.style.transition = "opacity 0.3s";
    toast.style.pointerEvents = "none";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = "1";

  if (toast.timeoutId) clearTimeout(toast.timeoutId);
  toast.timeoutId = setTimeout(() => {
    toast.style.opacity = "0";
  }, 3000);
}

// ---------------------------------------------------------------------------
// Mood Ring — avatar border colour changes based on conversation emotional tone
// ---------------------------------------------------------------------------

const MOOD_KEYWORDS = {
  emergency: ["emergency", "chest pain", "heart attack", "seizure", "call 911", "call 112", "red line",
    "seene mein dard", "दिल का दर्द", "ಎದೆ ನೋವು", "dolor de pecho"],
  concerned: ["worried", "missed", "warning", "caution", "check with your doctor", "dangerous",
    "high blood sugar", "low blood sugar", "interaction", "alert"],
  positive: ["great", "excellent", "well done", "good job", "taken", "logged", "confirmed",
    "all set", "nicely done", "shabash", "शाबाश"],
};

function updateMoodRing(text) {
  if (!text || !avatarHeroTap) return;
  const lower = text.toLowerCase();

  if (MOOD_KEYWORDS.emergency.some(k => lower.includes(k))) {
    avatarHeroTap.dataset.mood = "emergency";
  } else if (MOOD_KEYWORDS.concerned.some(k => lower.includes(k))) {
    avatarHeroTap.dataset.mood = "concerned";
  } else if (MOOD_KEYWORDS.positive.some(k => lower.includes(k))) {
    avatarHeroTap.dataset.mood = "positive";
  } else {
    delete avatarHeroTap.dataset.mood;
  }

  // Auto-reset mood after 8 seconds unless another event updates it
  clearTimeout(avatarHeroTap._moodTimer);
  avatarHeroTap._moodTimer = setTimeout(() => {
    delete avatarHeroTap.dataset.mood;
  }, 8000);
}

// ---------------------------------------------------------------------------
// ADK Event Handling
// ---------------------------------------------------------------------------

function handleADKEvent(event) {
  // Show which agent is responding — uses ADK event author field
  const author = event.author || (event.content && event.content.role === "model" ? "heali" : null);
  if (author) showAgentBadge(author);

  const content = event.content;
  if (content && content.parts) {
    for (const part of content.parts) {
      const inlineData = part.inlineData || part.inline_data;
      const audioData = inlineData && (inlineData.data != null) ? String(inlineData.data) : null;
      if (audioData && audioData.length > 0) {
        const mimeType = (inlineData && (inlineData.mimeType || inlineData.mime_type)) || "";
        console.log("[Heali] Playing audio chunk, mime:", mimeType || "(none)", "len:", audioData.length);
        setStatus(currentLocale.speaking, "active");
        // Mute mic while agent is speaking to prevent echo feedback loop
        if (audioRecorder && !audioRecorder.isMuted) {
          audioRecorder.mute();
        }
        if (audioPlayer && audioPlayer.isInitialized) {
          audioPlayer.playBase64(audioData);
        } else {
          // Queue only; do not create AudioPlayer here (no user gesture = suspended context).
          // Player is created in startListening() on tap; it will flush this queue.
          if (!window._audioChunkQueue) window._audioChunkQueue = [];
          window._audioChunkQueue.push(audioData);
          if (window._audioChunkQueue.length === 1) {
            console.log("[Heali] Audio queued (tap to start listening to hear it)");
          }
        }
      }
    }
  }

  // Strip control chars and <ctrlNN> artifacts from transcripts before display
  function sanitizeTranscriptText(s) {
    if (typeof s !== "string") return s;
    return s
      .replace(/<ctrl\d+>/gi, "")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  }

  const inputTx = event.inputTranscription || event.input_transcription;
  if (inputTx?.text) {
    const cleanInput = sanitizeTranscriptText(inputTx.text);
    if (inputTx.finished && currentUserBubble) {
      accumulatedUserText = cleanInput;
      const content = currentUserBubble.querySelector(".message-content");
      if (content) content.textContent = accumulatedUserText;
      scheduleTranscriptScroll();
    } else {
      appendTranscript(cleanInput, "user", true);
    }
  }

  const outputTx = event.outputTranscription || event.output_transcription;
  if (outputTx?.text) {
    const cleanOutput = sanitizeTranscriptText(outputTx.text);
    if (outputTx.finished && currentAgentBubble) {
      accumulatedAgentText = cleanOutput;
      const content = currentAgentBubble.querySelector(".message-content");
      if (content) content.textContent = accumulatedAgentText;
      scheduleTranscriptScroll();
    } else {
      appendTranscript(cleanOutput, "agent", true);
    }
    updateMoodRing(cleanOutput);  // Update avatar mood based on what agent says
  }

  if (event.turnComplete || event.turn_complete) {
    currentAgentBubble = null;
    accumulatedAgentText = "";
    currentUserBubble = null;
    accumulatedUserText = "";
    // Don't flip to "listening" immediately — the ring buffer may still have
    // audio queued. audioPlayer.onDrained fires when the speaker goes quiet.
    // Fallback: if player isn't active, switch immediately.
    if (!audioPlayer || !audioPlayer.isInitialized) {
      // Unmute mic now that agent is done
      if (audioRecorder) audioRecorder.unmute();
      setStatus(currentLocale.listening, "listening");
    }
  }

  if (event.interrupted) {
    if (audioPlayer) audioPlayer.clear();
    // Unmute mic immediately on interruption
    if (audioRecorder) audioRecorder.unmute();
    currentAgentBubble = null;
    accumulatedAgentText = "";
    currentUserBubble = null;
    accumulatedUserText = "";
    setStatus(currentLocale.listening, "listening");

    // Visual interruption feedback — brief flash on avatar border
    const heroTap = document.querySelector(".avatar-hero-tap");
    if (heroTap) {
      heroTap.classList.add("interrupted");
      setTimeout(() => heroTap.classList.remove("interrupted"), 600);
    }
    console.log("[Heali] Agent interrupted by user — cleared audio and switched to listening");
  }
}

// ---------------------------------------------------------------------------
// Audio Recording
// ---------------------------------------------------------------------------

async function startListening() {
  if (isListening) return;

  if (!audioPlayer) {
    audioPlayer = new AudioPlayer();
    audioPlayer.onAudioError = (message) => {
      setStatus(message, "");
      console.warn("[Heali] Audio error:", message);
    };
    await audioPlayer.initialize();
    // Switch aura from "speaking" → "listening" only after buffer fully drains
    audioPlayer.onDrained = () => {
      // Unmute mic now that speaker buffer is empty
      if (audioRecorder) audioRecorder.unmute();
      if (isListening && document.body.classList.contains("speaking")) {
        setStatus(currentLocale.listening, "listening");
      }
    };
    // Play any chunks that arrived before we had a player (e.g. greeting response)
    const queued = window._audioChunkQueue ? window._audioChunkQueue.length : 0;
    if (queued) {
      console.log("[Heali] Flushing", queued, "queued audio chunks");
      while (window._audioChunkQueue && window._audioChunkQueue.length) {
        audioPlayer.playBase64(window._audioChunkQueue.shift());
      }
    }
  }

  try {
    // Send audio in ~50ms chunks (1600 bytes @ 16kHz) per ADK recommendation for reliable VAD/response.
    // Flush partial batches every FLUSH_INTERVAL_MS so end-of-speech is not held in the buffer
    // (otherwise the model may never see the tail of the utterance and VAD won't commit).
    const UPSTREAM_BATCH_BYTES = 1600;
    const FLUSH_INTERVAL_MS = 50;
    let upstreamBatch = [];
    let upstreamBatchBytes = 0;

    function flushUpstreamBatch() {
      if (upstreamBatch.length === 0 || !websocket || websocket.readyState !== WebSocket.OPEN) return;
      const merged = new Uint8Array(upstreamBatchBytes);
      let offset = 0;
      for (const b of upstreamBatch) {
        merged.set(new Uint8Array(b), offset);
        offset += b.byteLength;
      }
      upstreamBatch = [];
      upstreamBatchBytes = 0;
      const base64 = arrayBufferToBase64(merged.buffer);
      websocket.send(JSON.stringify({ type: "audio", data: base64 }));
    }

    audioRecorder = new AudioRecorder((audioData) => {
      if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
      const ab = audioData instanceof ArrayBuffer ? audioData : audioData.buffer;
      upstreamBatch.push(ab);
      upstreamBatchBytes += ab.byteLength;

      if (upstreamBatchBytes >= UPSTREAM_BATCH_BYTES) {
        flushUpstreamBatch();
      }
    });
    if (upstreamFlushIntervalId) clearInterval(upstreamFlushIntervalId);
    upstreamFlushIntervalId = setInterval(flushUpstreamBatch, FLUSH_INTERVAL_MS);
    await audioRecorder.start();
    console.log("[Heali] Audio recording started");
    isListening = true;
    if (chatMicBtn) chatMicBtn.classList.add("active");
    setStatus(currentLocale.listening, "listening");
  } catch (e) {
    console.error("[Heali] Microphone error:", e);
    setStatus("Mic blocked — check permissions", "");
  }
}

function stopListening() {
  if (!isListening) return;
  if (upstreamFlushIntervalId) {
    clearInterval(upstreamFlushIntervalId);
    upstreamFlushIntervalId = null;
  }
  if (audioRecorder) {
    audioRecorder.stop();
    audioRecorder = null;
  }
  // Tell the server (and Gemini) the user finished speaking so it responds to what they said.
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({ type: "end_turn" }));
  }
  isListening = false;
  if (chatMicBtn) chatMicBtn.classList.remove("active");
  setStatus(currentLocale.tapToSpeak, "");
}

function endChat() {
  stopListening();
  // Close chat panel, restore hero
  transcriptDrawer.classList.add("collapsed");
  document.body.classList.remove("chat-active");
  // Clear transcript for next session
  if (transcript) transcript.innerHTML = "";
  currentAgentBubble = null;
  accumulatedAgentText = "";
}

// ---------------------------------------------------------------------------
// DOM Events
// ---------------------------------------------------------------------------

// Hero avatar tap → start/stop listening
if (avatarHeroTap) {
  avatarHeroTap.addEventListener("click", () => {
    isListening ? stopListening() : startListening();
  });

  // Keyboard accessibility
  avatarHeroTap.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      isListening ? stopListening() : startListening();
    }
  });
}

// Chat panel handle toggle
if (drawerHandle) {
  drawerHandle.addEventListener("click", () => {
    const isCollapsed = transcriptDrawer.classList.contains("collapsed");
    transcriptDrawer.classList.toggle("collapsed");
    if (!isCollapsed) {
      // Was open, now collapsing — remove chat-active
      document.body.classList.remove("chat-active");
    }
  });
}

// Chat input block events
function sendTextMessage() {
  const text = chatTextInput.value.trim();
  if (!text || !websocket || websocket.readyState !== WebSocket.OPEN) return;

  // Stop mic if sending text
  stopListening();

  // Send to gemini
  websocket.send(JSON.stringify({ type: "text", text: text }));

  // Echo locally
  appendTranscript(text, "user", false);

  // Finalize turn
  websocket.send(JSON.stringify({ type: "end_turn" }));
  chatTextInput.value = "";
}

if (chatSendBtn) {
  chatSendBtn.addEventListener("click", sendTextMessage);
}

if (chatTextInput) {
  chatTextInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendTextMessage();
    }
  });
}

if (chatMicBtn) {
  chatMicBtn.addEventListener("click", () => {
    isListening ? stopListening() : startListening();
  });
}

// Change companion button — opens profile settings modal (non-destructive)
const changePersonaBtn = document.getElementById("change-persona-btn");
if (changePersonaBtn) {
  changePersonaBtn.addEventListener("click", openProfileModal);
}

// ---------------------------------------------------------------------------
// Page Visibility: Auto-greeting after 2h inactivity
// ---------------------------------------------------------------------------

let lastActiveTime = Date.now();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    const inactiveMs = Date.now() - lastActiveTime;
    const TWO_HOURS = 2 * 60 * 60 * 1000;

    if (inactiveMs > TWO_HOURS && websocket && websocket.readyState === WebSocket.OPEN) {
      const hour = new Date().getHours();
      const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
      const hoursAway = Math.round(inactiveMs / 3600000);

      if (!isListening) startListening();
      websocket.send(
        JSON.stringify({
          type: "text",
          text: `[SYSTEM: User just opened the app after ${hoursAway} hours. Time of day: ${period}. Start a warm ${period} health check-in in ${language}.]`,
        })
      );
      console.log(`[Heali] Auto-greeting triggered after ${hoursAway}h inactivity`);
    }

    lastActiveTime = Date.now();
  } else {
    lastActiveTime = Date.now();
  }
});

// Check-in from push notification (optional type=meds or type=lunch for context)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("checkin") === "true") {
  const reminderType = urlParams.get("type") || ""; // "meds" or "lunch" or ""
  window.addEventListener("load", () => {
    setTimeout(() => {
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        const hour = new Date().getHours();
        const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
        const typeHint =
          reminderType === "meds"
            ? " from a medication reminder"
            : reminderType === "lunch"
              ? " from a lunch reminder"
              : " from a check-in notification";
        if (!isListening) startListening();
        websocket.send(
          JSON.stringify({
            type: "text",
            text: `[SYSTEM: User opened the app${typeHint}. Time of day: ${period}. Start a warm ${period} health check-in in ${language}.]`,
          })
        );
      }
    }, 2000);
  });
}

// ---------------------------------------------------------------------------
// Profile Settings Modal
// ---------------------------------------------------------------------------

let profileModalNewAvatarB64 = null;
let profileModalSelectedLang = null;
let profileModalSelectedVoice = null;
let profileModalVoiceChanged = false;
let profileModalLangChanged = false;
let _closeProfileTimeout = null;  // guards against rapid open→close race

const COMPANION_PRESETS = {
  "English": ["Dr. Chen", "Dr. Alex", "Dr. Morgan"],
  "Hindi": ["Dr. Priya", "Dr. Rahul", "Dr. Kavya"],
  "Spanish": ["Enfermera Elena", "Dr. Carlos", "Dr. Sofia"],
  "Kannada": ["ಆರೋಗ್ಯ ಸಂಗಾತಿ", "ಡಾ. ಮೀನಾ"],
};

function openProfileModal() {
  const modal = document.getElementById("profile-modal");
  if (!modal) return;

  // Cancel any in-flight close animation so re-opening immediately works
  if (_closeProfileTimeout) {
    clearTimeout(_closeProfileTimeout);
    _closeProfileTimeout = null;
  }

  // Reset state
  profileModalNewAvatarB64 = null;
  profileModalVoiceChanged = false;
  profileModalLangChanged = false;

  // Populate fields from localStorage
  const currentLang = localStorage.getItem("heali_language") || "English";
  const currentVoice = localStorage.getItem("heali_voice_name") || "Aoede";
  const currentName = localStorage.getItem("heali_display_name") || "";
  const currentComp = localStorage.getItem("heali_companion_name") || "";
  const currentAvatarB64 = localStorage.getItem("heali_avatar") || "";

  profileModalSelectedLang = currentLang;
  profileModalSelectedVoice = currentVoice;

  const nameInput = document.getElementById("profile-name-input");
  const compInput = document.getElementById("profile-companion-input");
  if (nameInput) nameInput.value = currentName;
  if (compInput) compInput.value = currentComp;

  // Avatar preview
  const preview = document.getElementById("profile-avatar-preview");
  const fallback = document.getElementById("profile-avatar-fallback");
  if (preview && fallback) {
    if (currentAvatarB64) {
      preview.src = currentAvatarB64;
      preview.style.display = "block";
      fallback.style.display = "none";
    } else {
      preview.style.display = "none";
      fallback.style.display = "flex";
    }
  }

  // Language buttons
  document.querySelectorAll(".profile-lang-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.lang === currentLang);
  });

  // Voice buttons
  document.querySelectorAll(".profile-voice-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.voice === currentVoice);
  });

  // Companion chips
  renderCompanionChips(currentLang);

  // Demo notice
  const demoNotice = document.getElementById("profile-demo-notice");
  if (demoNotice) demoNotice.style.display = (uid === "demo_user") ? "block" : "none";

  // Clear error
  const errEl = document.getElementById("profile-error");
  if (errEl) errEl.style.display = "none";

  // Reset save button
  const saveBtn = document.getElementById("profile-save-btn");
  if (saveBtn) { saveBtn.textContent = "Save"; saveBtn.disabled = false; }

  // Slide up
  modal.style.display = "flex";
  void modal.offsetWidth; // force reflow
  modal.classList.add("open");
}

function closeProfileModal() {
  const modal = document.getElementById("profile-modal");
  if (!modal) return;
  modal.classList.remove("open");
  _closeProfileTimeout = setTimeout(() => {
    modal.style.display = "none";
    _closeProfileTimeout = null;
  }, 380);
}

function renderCompanionChips(lang) {
  const container = document.getElementById("profile-companion-chips");
  const compInput = document.getElementById("profile-companion-input");
  if (!container) return;
  container.innerHTML = "";
  const presets = COMPANION_PRESETS[lang] || COMPANION_PRESETS["English"];
  presets.forEach(name => {
    const chip = document.createElement("button");
    chip.className = "profile-chip";
    chip.type = "button";
    chip.textContent = name;
    chip.addEventListener("click", () => { if (compInput) compInput.value = name; });
    container.appendChild(chip);
  });
}

function profileSelectLang(lang) {
  profileModalSelectedLang = lang;
  profileModalLangChanged = true;
  document.querySelectorAll(".profile-lang-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.lang === lang);
  });
  renderCompanionChips(lang);
}

function profileSelectVoice(voice) {
  profileModalSelectedVoice = voice;
  profileModalVoiceChanged = true;
  document.querySelectorAll(".profile-voice-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.voice === voice);
  });
}

async function profileGenerateAvatar() {
  const genBtn = document.getElementById("profile-gen-avatar-btn");
  const msg = document.getElementById("profile-generating-msg");
  const preview = document.getElementById("profile-avatar-preview");
  const fallback = document.getElementById("profile-avatar-fallback");
  const compInput = document.getElementById("profile-companion-input");
  const companionName = compInput ? compInput.value.trim() : "Health Companion";

  const saveBtn = document.getElementById("profile-save-btn");

  if (genBtn) genBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;
  if (msg) msg.style.display = "block";

  try {
    const form = new FormData();
    form.append("companion_name", companionName || "Health Companion");
    const resp = await fetch("/api/avatar/generate", { method: "POST", body: form });
    if (!resp.ok) throw new Error("Avatar generation failed");
    const data = await resp.json();
    profileModalNewAvatarB64 = data.avatar_b64;
    if (preview && fallback) {
      preview.src = profileModalNewAvatarB64;
      preview.style.display = "block";
      fallback.style.display = "none";
    }
  } catch (e) {
    showToast("Avatar generation failed. Other fields still saveable.");
  } finally {
    if (genBtn) genBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = false;
    if (msg) msg.style.display = "none";
  }
}

function profileTriggerPhotoUpload() {
  const input = document.getElementById("profile-photo-input");
  if (input) input.click();
}

async function profileHandlePhotoUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const genBtn = document.getElementById("profile-gen-avatar-btn");
  const msg = document.getElementById("profile-generating-msg");
  const preview = document.getElementById("profile-avatar-preview");
  const fallback = document.getElementById("profile-avatar-fallback");
  const compInput = document.getElementById("profile-companion-input");
  const companionName = compInput ? compInput.value.trim() : "Health Companion";

  if (genBtn) genBtn.disabled = true;
  if (msg) { msg.textContent = "⏳ Processing photo…"; msg.style.display = "block"; }

  try {
    const form = new FormData();
    form.append("companion_name", companionName || "Health Companion");
    form.append("photo", file);
    const resp = await fetch("/api/avatar/generate", { method: "POST", body: form });
    if (!resp.ok) throw new Error("Photo avatar failed");
    const data = await resp.json();
    profileModalNewAvatarB64 = data.avatar_b64;
    if (preview && fallback) {
      preview.src = profileModalNewAvatarB64;
      preview.style.display = "block";
      fallback.style.display = "none";
    }
  } catch (e) {
    showToast("Could not process photo. Other fields still saveable.");
  } finally {
    if (genBtn) genBtn.disabled = false;
    if (msg) { msg.textContent = "⏳ Generating avatar…"; msg.style.display = "none"; }
    // Clear file input so same file can be re-selected
    event.target.value = "";
  }
}

function applyProfileLocally(payload) {
  // Persist to localStorage
  if (payload.language) localStorage.setItem("heali_language", payload.language);
  if (payload.companion_name) localStorage.setItem("heali_companion_name", payload.companion_name);
  if (payload.avatar_b64) localStorage.setItem("heali_avatar", payload.avatar_b64);
  if (payload.voice_name) localStorage.setItem("heali_voice_name", payload.voice_name);
  if (payload.display_name) localStorage.setItem("heali_display_name", payload.display_name);

  // Update live DOM
  if (payload.companion_name && avatarName) avatarName.textContent = payload.companion_name;
  if (payload.avatar_b64) {
    if (avatarImg) {
      avatarImg.src = payload.avatar_b64;
      avatarImg.style.display = "block";
      const fb = document.getElementById("avatar-icon-fallback");
      if (fb) fb.style.display = "none";
    }
  }
  if (payload.language) {
    language = payload.language;                              // update module-level var
    const newLocale = LANG_TO_LOCALE[payload.language] || LOCALE.en;
    currentLocale = newLocale;
    const greeting = LANG_TO_GREETING[payload.language] || LANG_TO_GREETING["English"];
    if (avatarGreeting) avatarGreeting.textContent = greeting;
  }
}

async function saveProfileModal() {
  const nameInput = document.getElementById("profile-name-input");
  const compInput = document.getElementById("profile-companion-input");
  const errEl = document.getElementById("profile-error");
  const saveBtn = document.getElementById("profile-save-btn");

  const displayName = nameInput ? nameInput.value.trim() : "";
  const companionName = compInput ? compInput.value.trim() : "";

  // Validate
  if (!companionName) {
    if (errEl) { errEl.textContent = "Companion name is required."; errEl.style.display = "block"; }
    return;
  }
  if (errEl) errEl.style.display = "none";

  // Build payload
  const payload = {
    companion_name: companionName,
    language: profileModalSelectedLang || localStorage.getItem("heali_language") || "English",
    voice_name: profileModalSelectedVoice || localStorage.getItem("heali_voice_name") || "Aoede",
    display_name: displayName,
  };
  if (profileModalNewAvatarB64) payload.avatar_b64 = profileModalNewAvatarB64;

  // Loading state
  if (saveBtn) { saveBtn.textContent = "Saving…"; saveBtn.disabled = true; }

  const needsReconnect = profileModalVoiceChanged || profileModalLangChanged;

  // Demo mode — skip API call
  if (uid === "demo_user") {
    applyProfileLocally(payload);
    closeProfileModal();
    showToast("Profile saved locally (demo mode)!");
    if (needsReconnect && websocket) websocket.close(1000, "profile_settings_changed");
    return;
  }

  // Auth mode — POST to server
  try {
    const token = localStorage.getItem("heali_id_token") || "";
    const resp = await fetch("/api/auth/profile", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    applyProfileLocally(payload); // always apply locally

    if (resp.status === 503) {
      closeProfileModal();
      showToast("Profile saved locally (server unavailable)");
    } else if (!resp.ok) {
      if (errEl) { errEl.textContent = `Server error ${resp.status} — saved locally.`; errEl.style.display = "block"; }
      if (saveBtn) { saveBtn.textContent = "Save"; saveBtn.disabled = false; }
      // Still close after brief pause so user sees message
      setTimeout(closeProfileModal, 1800);
    } else {
      closeProfileModal();
      showToast("Profile saved! ✅");
    }
  } catch (e) {
    applyProfileLocally(payload);
    closeProfileModal();
    showToast("Saved locally (network error)");
  }

  // Reconnect WebSocket if voice or language changed (picks up fresh localStorage)
  if (needsReconnect && websocket) {
    websocket.close(1000, "profile_settings_changed");
    // onclose handler auto-reconnects after 3s via connectWebSocket()
  }
}

// Wire profile modal DOM events
(function wireProfileModal() {
  const modal = document.getElementById("profile-modal");
  if (!modal) return;

  // Backdrop click → close (only if clicking the backdrop, not the card)
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeProfileModal();
  });

  const closeBtn = document.getElementById("profile-modal-close");
  const cancelBtn = document.getElementById("profile-cancel-btn");
  const saveBtn = document.getElementById("profile-save-btn");
  const genBtn = document.getElementById("profile-gen-avatar-btn");
  const uploadBtn = document.getElementById("profile-upload-avatar-btn");
  const photoInput = document.getElementById("profile-photo-input");

  if (closeBtn) closeBtn.addEventListener("click", closeProfileModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeProfileModal);
  if (saveBtn) saveBtn.addEventListener("click", saveProfileModal);
  if (genBtn) genBtn.addEventListener("click", profileGenerateAvatar);
  if (uploadBtn) uploadBtn.addEventListener("click", profileTriggerPhotoUpload);
  if (photoInput) photoInput.addEventListener("change", profileHandlePhotoUpload);

  document.querySelectorAll(".profile-lang-btn").forEach(btn => {
    btn.addEventListener("click", () => profileSelectLang(btn.dataset.lang));
  });
  document.querySelectorAll(".profile-voice-btn").forEach(btn => {
    btn.addEventListener("click", () => profileSelectVoice(btn.dataset.voice));
  });
})();

// ---------------------------------------------------------------------------
// Medication Schedule Modal
// ---------------------------------------------------------------------------

let _closeMedScheduleTimeout = null;
let medScheduleTimesSelected = [];

async function fetchMedications() {
  try {
    const token = localStorage.getItem("heali_id_token") || "demo";
    const resp = await fetch("/api/medications", {
      headers: { "Authorization": "Bearer " + token },
    });
    if (!resp.ok) throw new Error("Failed to fetch medications");
    const data = await resp.json();
    localStorage.setItem("heali_meds_cache", JSON.stringify(data.medications));
    return data.medications;
  } catch (e) {
    console.warn("[MedSchedule] fetch failed, using cache", e);
    const cached = localStorage.getItem("heali_meds_cache");
    return cached ? JSON.parse(cached) : [];
  }
}

function openMedScheduleModal() {
  const modal = document.getElementById("med-schedule-modal");
  if (!modal) return;
  if (_closeMedScheduleTimeout) {
    clearTimeout(_closeMedScheduleTimeout);
    _closeMedScheduleTimeout = null;
  }

  // Demo notice
  const demoNotice = document.getElementById("med-demo-notice");
  if (demoNotice) demoNotice.style.display = (uid === "demo_user") ? "block" : "none";

  // Reset add form
  medScheduleTimesSelected = [];
  renderSelectedTimes();
  const nameInput = document.getElementById("med-add-name");
  const dosageInput = document.getElementById("med-add-dosage");
  if (nameInput) nameInput.value = "";
  if (dosageInput) dosageInput.value = "";
  document.querySelectorAll(".med-time-chip").forEach(c => c.classList.remove("selected"));
  const details = document.getElementById("med-add-details");
  if (details) details.removeAttribute("open");

  modal.style.display = "flex";
  void modal.offsetWidth;
  modal.classList.add("open");

  populateMedList();
}

function closeMedScheduleModal() {
  const modal = document.getElementById("med-schedule-modal");
  if (!modal) return;
  modal.classList.remove("open");
  _closeMedScheduleTimeout = setTimeout(() => {
    modal.style.display = "none";
    _closeMedScheduleTimeout = null;
  }, 380);
}

async function populateMedList() {
  const container = document.getElementById("med-list-container");
  const emptyState = document.getElementById("med-empty-state");
  const nextDoseText = document.getElementById("med-next-dose-text");
  if (!container) return;

  container.innerHTML = '<p style="opacity:0.5;text-align:center;">Loading...</p>';
  const meds = await fetchMedications();

  if (!meds || meds.length === 0) {
    container.innerHTML = "";
    if (emptyState) emptyState.style.display = "block";
    if (nextDoseText) nextDoseText.textContent = "No medications scheduled";
    return;
  }
  if (emptyState) emptyState.style.display = "none";

  container.innerHTML = "";
  meds.forEach(med => {
    const card = document.createElement("div");
    card.className = "med-card";
    const times = (med.times || med.dose_times || []);
    const timeBadges = times.map(t => `<span class="med-time-badge">${t}</span>`).join("");
    card.innerHTML = `
      <div class="med-card-header">
        <span class="med-card-name">${med.name}</span>
        <span class="med-card-dosage">${med.dosage || ""}</span>
      </div>
      <div class="med-card-times">${timeBadges}</div>
      ${med.purpose ? `<div class="med-card-purpose">${med.purpose}</div>` : ""}
      <div class="med-card-actions">
        <button class="med-card-delete" data-med-id="${med.id || ""}" title="Remove">
          <span class="material-icons" style="font-size:16px;">delete_outline</span> Remove
        </button>
      </div>
    `;
    container.appendChild(card);
  });

  // Wire delete buttons
  container.querySelectorAll(".med-card-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const medId = btn.dataset.medId;
      if (!medId) return;
      try {
        const token = localStorage.getItem("heali_id_token") || "demo";
        await fetch(`/api/medications/${medId}`, {
          method: "DELETE",
          headers: { "Authorization": "Bearer " + token },
        });
        showToast("Medication removed");
        populateMedList();
      } catch (e) {
        showToast("Failed to remove medication");
      }
    });
  });

  // Update next dose countdown
  updateNextDoseCountdown(meds);
}

function updateNextDoseCountdown(meds) {
  const el = document.getElementById("med-next-dose-text");
  if (!el) return;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  let nearestDiff = Infinity;
  let nearestMed = "";

  meds.forEach(med => {
    (med.times || med.dose_times || []).forEach(t => {
      const [h, m] = t.split(":").map(Number);
      let diff = (h * 60 + m) - nowMins;
      if (diff < -5) diff += 1440; // next day
      if (diff < nearestDiff) {
        nearestDiff = diff;
        nearestMed = med.name;
      }
    });
  });

  if (nearestDiff === Infinity) {
    el.textContent = "No upcoming doses";
  } else if (nearestDiff <= 0) {
    el.textContent = `${nearestMed} — due now!`;
  } else {
    const hrs = Math.floor(nearestDiff / 60);
    const mins = nearestDiff % 60;
    el.textContent = `${nearestMed} — in ${hrs > 0 ? hrs + "h " : ""}${mins}m`;
  }
}

function renderSelectedTimes() {
  const container = document.getElementById("med-selected-times");
  if (!container) return;
  container.innerHTML = "";
  medScheduleTimesSelected.forEach(t => {
    const chip = document.createElement("button");
    chip.className = "med-selected-time-chip";
    chip.innerHTML = `${t} <span class="material-icons" style="font-size:14px;">close</span>`;
    chip.addEventListener("click", () => {
      medScheduleTimesSelected = medScheduleTimesSelected.filter(x => x !== t);
      document.querySelectorAll(".med-time-chip").forEach(c => {
        if (c.dataset.time === t) c.classList.remove("selected");
      });
      renderSelectedTimes();
    });
    container.appendChild(chip);
  });
}

// Wire medication schedule modal
(function wireMedScheduleModal() {
  const modal = document.getElementById("med-schedule-modal");
  if (!modal) return;

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeMedScheduleModal();
  });

  const closeBtn = document.getElementById("med-schedule-close");
  if (closeBtn) closeBtn.addEventListener("click", closeMedScheduleModal);

  const schedBtn = document.getElementById("med-schedule-btn");
  if (schedBtn) schedBtn.addEventListener("click", openMedScheduleModal);

  // Preset time chips
  document.querySelectorAll(".med-time-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const t = chip.dataset.time;
      if (medScheduleTimesSelected.includes(t)) {
        medScheduleTimesSelected = medScheduleTimesSelected.filter(x => x !== t);
        chip.classList.remove("selected");
      } else {
        medScheduleTimesSelected.push(t);
        chip.classList.add("selected");
      }
      renderSelectedTimes();
    });
  });

  // Custom time add
  const customTimeBtn = document.getElementById("med-add-custom-time-btn");
  if (customTimeBtn) {
    customTimeBtn.addEventListener("click", () => {
      const input = document.getElementById("med-add-custom-time");
      if (input && input.value && !medScheduleTimesSelected.includes(input.value)) {
        medScheduleTimesSelected.push(input.value);
        renderSelectedTimes();
        input.value = "";
      }
    });
  }

  // Save medication
  const saveBtn = document.getElementById("med-add-save-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const name = document.getElementById("med-add-name")?.value?.trim();
      const dosage = document.getElementById("med-add-dosage")?.value?.trim();
      if (!name) { showToast("Enter a medication name"); return; }
      if (medScheduleTimesSelected.length === 0) { showToast("Select at least one time"); return; }

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      try {
        const token = localStorage.getItem("heali_id_token") || "demo";
        const resp = await fetch("/api/medications", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name, dosage, times: medScheduleTimesSelected, schedule_type: "Daily",
          }),
        });
        if (!resp.ok) throw new Error("Save failed");
        showToast(`${name} added!`);
        // Reset form
        document.getElementById("med-add-name").value = "";
        document.getElementById("med-add-dosage").value = "";
        medScheduleTimesSelected = [];
        renderSelectedTimes();
        document.querySelectorAll(".med-time-chip").forEach(c => c.classList.remove("selected"));
        document.getElementById("med-add-details")?.removeAttribute("open");
        populateMedList();
      } catch (e) {
        showToast("Failed to save medication");
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Medication";
      }
    });
  }
})();

// ---------------------------------------------------------------------------
// Medication Reminder Timer — Agent Speaks
// ---------------------------------------------------------------------------

const MED_CHECK_INTERVAL = 30_000;  // check every 30 seconds
const MED_WINDOW_MINS = 5;          // +/- 5 minutes from scheduled time
let medReminderInterval = null;

function startMedReminderTimer() {
  if (medReminderInterval) return;
  medReminderInterval = setInterval(checkAndRemindMedications, MED_CHECK_INTERVAL);
  // First check after 5s (let meds cache load)
  setTimeout(checkAndRemindMedications, 5000);
}

function checkAndRemindMedications() {
  // Only remind when WebSocket is open and Gemini is ready
  if (!websocket || websocket.readyState !== WebSocket.OPEN || !isGeminiReady) return;

  const cached = localStorage.getItem("heali_meds_cache");
  if (!cached) return;

  let meds;
  try { meds = JSON.parse(cached); } catch { return; }
  if (!meds || meds.length === 0) return;

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const today = now.toISOString().split("T")[0];

  // Load reminded map & prune old dates
  let reminded;
  try { reminded = JSON.parse(localStorage.getItem("heali_reminded") || "{}"); } catch { reminded = {}; }
  const staleKeys = Object.keys(reminded).filter(k => !k.endsWith(today));
  if (staleKeys.length > 0) {
    staleKeys.forEach(k => delete reminded[k]);
    localStorage.setItem("heali_reminded", JSON.stringify(reminded));
  }

  for (const med of meds) {
    for (const t of (med.times || med.dose_times || [])) {
      const [h, m] = t.split(":").map(Number);
      if (isNaN(h) || isNaN(m)) continue;
      const diff = Math.abs(nowMins - (h * 60 + m));
      if (diff > MED_WINDOW_MINS) continue;

      const key = `${med.name}_${t}_${today}`;
      if (reminded[key]) continue;  // already reminded today for this dose

      // Mark as reminded
      reminded[key] = Date.now();
      localStorage.setItem("heali_reminded", JSON.stringify(reminded));

      // Inject SYSTEM directive — agent speaks the reminder
      const lang = localStorage.getItem("heali_language") || "English";
      const prompt = `[SYSTEM: It is now ${t}. ` +
        `Gently remind the patient that it's time to take their ${med.name}` +
        `${med.dosage ? " (" + med.dosage + ")" : ""}. ` +
        `Ask if they've taken it. Be warm and caring. ` +
        `Speak in ${lang}.]`;

      console.log("[MedReminder] Sending reminder:", med.name, t);
      websocket.send(JSON.stringify({ type: "text", text: prompt }));

      // Auto-start listening so user can respond
      if (!isListening) startListening();
      return;  // one reminder at a time
    }
  }
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

connectWebSocket();

// Pre-fetch medications to populate cache for the reminder timer
fetchMedications();

// Start medication reminder timer
startMedReminderTimer();
