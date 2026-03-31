import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Mic, MicOff, Phone, Globe, Volume2, Wifi, WifiOff,
  Trash2, Send, Camera, CameraOff, CheckCircle2, AlertTriangle,
  Pill, Heart, Utensils, CalendarCheck, ShieldAlert,
  Languages,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { useVoiceGuardian } from "@/hooks/useVoiceGuardian";
import { LANGUAGE_PERSONAS } from "@/lib/voiceConfig";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { pushUIEvent } from "@/hooks/useUIEventStore";
import type { UIEvent } from "@/hooks/useVoiceGuardian";
import { getOnboardingState, saveOnboardingState } from "@/lib/personas";

// Live Interpreter prompts (match app/static/js/app.js for backend behavior)
function buildLiveInterpreterActivationPrompt(patientLang: string, doctorLang: string): string {
  return `[SYSTEM: The patient has activated LIVE INTERPRETER MODE. Route to the interpreter agent for real-time translation.

You are an expert, real-time medical interpreter. You are bridging a live conversation between a patient who speaks ${patientLang} and a doctor who speaks ${doctorLang}.

CRITICAL RULES:
1. Do not answer questions, give advice, or participate in the conversation.
2. ONLY translate what is spoken.
3. If you hear ${patientLang}, immediately translate it into ${doctorLang}.
4. If you hear ${doctorLang}, immediately translate it into ${patientLang}.
5. Maintain the exact tone, urgency, and medical terminology used by the speaker.
6. Speak entirely in the first person (e.g., if the patient says "My stomach hurts", you say "My stomach hurts", NOT "The patient says their stomach hurts").
7. Continue translating every utterance until explicitly told to stop.]`;
}
function buildLiveInterpreterDeactivationPrompt(companionName: string, language: string): string {
  return `[SYSTEM: DEACTIVATE LIVE INTERPRETER MODE. The translation session has ended. You MUST transfer back to the root heali agent now by calling transfer_to_heali. Once you are the root agent again, resume your normal role as ${companionName}, the patient's health companion. Briefly acknowledge in ${language} that translation mode is off, then ask how else you can help.]`;
}

const statusLabels: Record<string, string> = {
  disconnected: "Tap to connect",
  connecting: "Connecting to backend\u2026",
  connected: "Waiting for Gemini\u2026",
  ready: "Connected \u2014 speaking to Gemini",
  error: "Connection failed \u2014 tap to retry",
};

// Map UI event targets to display info
function renderUICard(event: UIEvent, index: number) {
  const target = event.target;

  if (target === "pill_verified") {
    const data = event as Record<string, unknown>;
    const verified = data.verified ?? ((data.data as Record<string, unknown>)?.verified);
    return (
      <motion.div
        key={`ui-${index}`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`flex items-start gap-3 rounded-lg border p-4 ${verified ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"
          }`}
      >
        {verified ? (
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-green-500" />
        ) : (
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-500" />
        )}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Pill Verification
          </p>
          <p className="text-sm font-medium">
            {verified ? "Pill verified \u2014 safe to take" : "WARNING: Pill mismatch!"}
          </p>
          {(event.data as Record<string, unknown>)?.medication_name && (
            <p className="text-xs text-muted-foreground">
              {String((event.data as Record<string, unknown>).medication_name)}
            </p>
          )}
        </div>
      </motion.div>
    );
  }

  if (target === "medication_taken" || target === "medication_logged") {
    return (
      <motion.div
        key={`ui-${index}`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4"
      >
        <Pill size={20} className="mt-0.5 shrink-0 text-blue-500" />
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Medication Logged
          </p>
          <p className="text-sm font-medium">
            {(event.data as Record<string, unknown>)?.medication_name
              ? `${String((event.data as Record<string, unknown>).medication_name)} recorded`
              : "Medication dose recorded"}
          </p>
        </div>
      </motion.div>
    );
  }

  if (target === "vital_logged") {
    return (
      <motion.div
        key={`ui-${index}`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-start gap-3 rounded-lg border border-purple-500/30 bg-purple-500/10 p-4"
      >
        <Heart size={20} className="mt-0.5 shrink-0 text-purple-500" />
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Vitals Logged
          </p>
          <p className="text-sm font-medium">
            {(event.data as Record<string, unknown>)?.vital_type
              ? `${String((event.data as Record<string, unknown>).vital_type)}: ${String((event.data as Record<string, unknown>).value)}`
              : "Vital signs recorded"}
          </p>
        </div>
      </motion.div>
    );
  }

  if (target === "meal_logged") {
    return (
      <motion.div
        key={`ui-${index}`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-start gap-3 rounded-lg border border-orange-500/30 bg-orange-500/10 p-4"
      >
        <Utensils size={20} className="mt-0.5 shrink-0 text-orange-500" />
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Meal Logged
          </p>
          <p className="text-sm font-medium">Meal recorded successfully</p>
        </div>
      </motion.div>
    );
  }

  if (target === "booking_confirmed") {
    return (
      <motion.div
        key={`ui-${index}`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/10 p-4"
      >
        <CalendarCheck size={20} className="mt-0.5 shrink-0 text-green-500" />
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Appointment Booked
          </p>
          <p className="text-sm font-medium">
            {(event.data as Record<string, unknown>)?.hospital
              ? `${String((event.data as Record<string, unknown>).hospital)} - ${String((event.data as Record<string, unknown>).date)}`
              : "Appointment confirmed"}
          </p>
        </div>
      </motion.div>
    );
  }

  if (target === "symptom_logged" || target === "symptoms_noted") {
    const data = event.data as Record<string, unknown>;
    return (
      <motion.div
        key={`ui-${index}`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4"
      >
        <Heart size={20} className="mt-0.5 shrink-0 text-amber-500" />
        <div className="flex-1">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Symptoms Recorded
          </p>
          <p className="text-sm font-medium">
            {data?.symptoms
              ? `Noted: ${String(data.symptoms)}`
              : "Your symptoms have been recorded"}
          </p>
          {data?.next_steps && (
            <div className="mt-2 space-y-1">
              <p className="font-mono text-[10px] uppercase tracking-widest text-amber-600">Next Steps</p>
              <p className="text-xs text-muted-foreground">{String(data.next_steps)}</p>
            </div>
          )}
          {data?.followup_scheduled && (
            <p className="mt-1 text-xs text-amber-600">
              ⏰ Follow-up check-in scheduled
            </p>
          )}
        </div>
      </motion.div>
    );
  }

  if (target === "otc_medication_logged") {
    const data = event.data as Record<string, unknown>;
    return (
      <motion.div
        key={`ui-${index}`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-start gap-3 rounded-lg border border-border bg-secondary/60 p-4"
      >
        <Pill size={20} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            One-time Intake Noted
          </p>
          <p className="text-sm font-medium">
            {data?.name as string}
            {data?.dose ? ` · ${data.dose as string}` : ""}
            {data?.reason ? ` · for ${data.reason as string}` : ""}
            {data?.time ? ` · ${data.time as string}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Not added to your regular medication schedule.
          </p>
        </div>
      </motion.div>
    );
  }

  if (target === "booking_emergency" || target === "emergency_alert") {
    return (
      <motion.div
        key={`ui-${index}`}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-start gap-3 rounded-lg border-2 border-red-600 bg-red-600/20 p-4"
      >
        <ShieldAlert size={20} className="mt-0.5 shrink-0 text-red-600" />
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-red-600">
            Emergency Alert
          </p>
          <p className="text-sm font-bold text-red-600">
            Emergency protocol activated. Family has been notified.
          </p>
        </div>
      </motion.div>
    );
  }

  // Default card for unknown events
  return (
    <motion.div
      key={`ui-${index}`}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-start gap-3 rounded-lg border border-border bg-secondary/50 p-4"
    >
      <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {target.replace(/_/g, " ")}
        </p>
        <p className="text-sm">Action completed</p>
      </div>
    </motion.div>
  );
}

import { saveProfile } from "@/lib/api";

const VoiceGuardian = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, getIdToken } = useAuth();
  const [selectedPersona, setSelectedPersona] = useState("en");
  const [isLiveInterpreterActive, setIsLiveInterpreterActive] = useState(false);
  const hasAutoActivatedInterpreterRef = useRef(false);

  // Fetch true profile language so the pill matches actual db preference
  useEffect(() => {
    getIdToken().then(async (token) => {
      if (token && token !== "demo") {
        try {
          const { getProfile } = await import("@/lib/api");
          const profile = await getProfile(token) as Record<string, any>;
          if (profile?.language) {
            const found = Object.values(LANGUAGE_PERSONAS).find(p => p.label === profile.language);
            if (found) setSelectedPersona(found.code);
          }
        } catch (e) {
          console.error("Failed to fetch language preference", e);
        }
      }
    });
  }, [getIdToken]);

  const handlePersonaChange = async (langCode: string, langLabel: string) => {
    setSelectedPersona(langCode);
    const token = await getIdToken();
    if (token) {
      try {
        await saveProfile({ language: langLabel }, token);
      } catch (e) {
        console.error("Failed to save language preference", e);
      }
    }
  };
  const [textInput, setTextInput] = useState("");
  const [firebaseToken, setFirebaseToken] = useState<string>("demo");
  const [cameraActive, setCameraActive] = useState(false);
  const [uiEvents, setUIEvents] = useState<UIEvent[]>([]);
  const [scanningFood, setScanningFood] = useState(false);
  const [sosAlert, setSosAlert] = useState<{ contactName: string; facetimeUrl: string; message: string } | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const foodScanInProgress = useRef(false);

  // Stable callback for useVoiceGuardian — delegates to the real handler via ref.
  // Must be defined before useVoiceGuardian since handleUIEventReal depends on sendText/startCamera/stopCamera from the hook.
  const handleUIEventRef = useRef<(event: UIEvent) => void>(() => {});
  const onUIEventStable = useCallback((event: UIEvent) => {
    handleUIEventRef.current(event);
  }, []);

  const {
    status,
    isListening,
    isSpeaking,
    transcript,
    connect,
    disconnect,
    sendText,
    sendImage,
    clearTranscript,
    avatarB64,
    companionName,
  } = useVoiceGuardian({
    userId: user?.uid,
    token: firebaseToken,
    persona: selectedPersona,
    patientName: user?.displayName || undefined,
    proactivePrompt: location.state?.proactivePrompt,
    onError: (msg) => {
      toast({
        variant: "destructive",
        title: "Voice Guardian",
        description: msg,
      });
    },
    onUIEvent: onUIEventStable,
  });

  const onboardingState = getOnboardingState();
  const displayAvatar =
    onboardingState.customAvatar ||
    onboardingState.persona?.avatar ||
    avatarB64 ||
    null;
  const displayName = onboardingState.persona?.name || companionName;

  const hasAutoConnected = useRef(false);

  // Get Firebase token on mount and auto-connect if requested (proactivePrompt or activateLiveInterpreter)
  useEffect(() => {
    getIdToken().then((token) => {
      if (token) setFirebaseToken(token);

      const wantsProactive = location.state?.proactivePrompt;
      const wantsInterpreter = location.state?.activateLiveInterpreter;
      if (!hasAutoConnected.current && (wantsProactive || wantsInterpreter)) {
        hasAutoConnected.current = true;
        setTimeout(() => connect(token || undefined), 100);
      }
    });
  }, [getIdToken, location.state?.proactivePrompt, location.state?.activateLiveInterpreter, connect]);

  // Auto-activate Live Interpreter when we land on /voice with state.activateLiveInterpreter and become ready
  useEffect(() => {
    if (status !== "ready" || !location.state?.activateLiveInterpreter || hasAutoActivatedInterpreterRef.current) return;
    hasAutoActivatedInterpreterRef.current = true;
    const patientLang = LANGUAGE_PERSONAS[selectedPersona]?.label ?? "English";
    const doctorLang = patientLang === "English" ? "the other speaker's language (auto-detect it)" : "English";
    const prompt = buildLiveInterpreterActivationPrompt(patientLang, doctorLang);
    sendText(prompt, { silent: true });
    setIsLiveInterpreterActive(true);
  }, [status, location.state?.activateLiveInterpreter, selectedPersona, sendText]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const handleMicToggle = () => {
    if (status === "connected" || status === "connecting" || status === "ready") {
      disconnect();
      stopCamera();
    } else {
      connect();
    }
  };

  const handleSendText = () => {
    if (textInput.trim() && (status === "connected" || status === "ready")) {
      sendText(textInput.trim());
      setTextInput("");
    }
  };

  const handleTranslatorToggle = () => {
    if (status !== "ready") return;
    const patientLang = LANGUAGE_PERSONAS[selectedPersona]?.label ?? "English";
    if (!isLiveInterpreterActive) {
      const doctorLang = patientLang === "English" ? "the other speaker's language (auto-detect it)" : "English";
      sendText(buildLiveInterpreterActivationPrompt(patientLang, doctorLang), { silent: true });
      setIsLiveInterpreterActive(true);
    } else {
      sendText(buildLiveInterpreterDeactivationPrompt(companionName, patientLang), { silent: true });
      setIsLiveInterpreterActive(false);
    }
  };

  // Camera: start capturing frames
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 640, height: 480 },
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);

      // Send JPEG frames every 1 second
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d")!;

      cameraIntervalRef.current = setInterval(() => {
        if (videoRef.current && videoRef.current.readyState >= 2) {
          ctx.drawImage(videoRef.current, 0, 0, 640, 480);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
          const base64 = dataUrl.split(",")[1];
          sendImage(base64, "image/jpeg");
        }
      }, 1000);
    } catch {
      toast({
        variant: "destructive",
        title: "Camera",
        description: "Camera access denied. Please allow camera access.",
      });
    }
  }, [sendImage]);

  const stopCamera = useCallback(() => {
    if (cameraIntervalRef.current) {
      clearInterval(cameraIntervalRef.current);
      cameraIntervalRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const handleUIEventReal = useCallback((event: UIEvent) => {
    if (event.target === "navigate") {
      const page = (event.data as Record<string, unknown>)?.page;
      if (typeof page === "string") {
        navigate(page);
        return;
      }
    }
    if (event.target === "onboarding_complete") {
      saveOnboardingState({ ...getOnboardingState(), completed: true });
      return;
    }
    pushUIEvent(event);
    setUIEvents((prev) => {
      const target = event.target;
      if (target === "medication_logged" || target === "medication_taken") {
        const data = (event.data ?? {}) as Record<string, unknown>;
        const medKey = String(data?.medication_name ?? data?.name ?? data?.medication ?? "");
        const last = prev[prev.length - 1];
        if (last?.target === target) {
          const lastData = (last.data ?? {}) as Record<string, unknown>;
          const lastKey = String(lastData?.medication_name ?? lastData?.name ?? lastData?.medication ?? "");
          if (lastKey === medKey) return prev;
        }
      }
      if (target === "profile_preview") {
        const last = prev[prev.length - 1];
        if (last?.target === "profile_preview") return prev;
      }
      return [...prev, event];
    });
    if (event.target === "pill_verified") {
      const data = (event.data ?? event) as Record<string, unknown>;
      toast({
        title: data.verified ? "Pill Verified" : "Pill Mismatch!",
        description: data.verified
          ? "This medication matches your prescription"
          : "WARNING: This pill does not match your medications",
        variant: data.verified ? "default" : "destructive",
      });
    } else if (event.target === "booking_emergency" || event.target === "emergency_alert") {
      toast({
        variant: "destructive",
        title: "Emergency Alert",
        description: "Emergency protocol activated",
      });
    } else if (event.target === "family_call") {
      const d = (event.data ?? {}) as Record<string, unknown>;
      const ftUrl = String(d.facetime_url ?? "");
      const name = String(d.contact_name ?? "family");
      if (ftUrl) {
        // Open FaceTime immediately on Apple devices
        window.open(ftUrl, "_blank");
      }
      toast({
        title: `Calling ${name}`,
        description: (
          <span>
            Opening FaceTime.{" "}
            {ftUrl && (
              <a href={ftUrl} className="underline font-semibold">
                Tap here if it didn't open
              </a>
            )}
          </span>
        ) as unknown as string,
      });
    } else if (event.target === "sos_facetime") {
      const d = (event.data ?? {}) as Record<string, unknown>;
      setSosAlert({
        contactName: String(d.contact_name ?? "Emergency Contact"),
        facetimeUrl: String(d.facetime_url ?? ""),
        message: String(d.message ?? "Emergency alert triggered"),
      });
    } else if (event.target === "family_alert") {
      const d = (event.data ?? {}) as Record<string, unknown>;
      const name = String(d.contact_name ?? "family");
      const ftUrl = String(d.facetime_url ?? "");
      toast({
        title: `Alert sent to ${name}`,
        description: ftUrl ? (
          <a href={ftUrl} className="underline font-semibold">
            FaceTime {name}
          </a>
        ) as unknown as string : String(d.message ?? ""),
      });
    }
    if (event.target === "food_detected") {
      if (foodScanInProgress.current) return;
      foodScanInProgress.current = true;
      if (!cameraActive) startCamera();
      // Poll until the video stream is actually buffered (readyState >= 2), max 5s.
      // A fixed timeout races against getUserMedia + stream load and often captures
      // a black frame, causing Gemini to return 0 kcal / empty items.
      const waitForVideo = (resolve: () => void, reject: () => void, elapsed = 0) => {
        if (videoRef.current && videoRef.current.readyState >= 2) return resolve();
        if (elapsed >= 5000) return reject();
        setTimeout(() => waitForVideo(resolve, reject, elapsed + 100), 100);
      };
      new Promise<void>((resolve, reject) => waitForVideo(resolve, reject))
        .then(async () => {
          if (!videoRef.current) { foodScanInProgress.current = false; return; }
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) { foodScanInProgress.current = false; return; }
          canvas.width = 640;
          canvas.height = 480;
          ctx.drawImage(videoRef.current, 0, 0, 640, 480);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
          const base64Image = dataUrl.split(",")[1];
          try {
            const { analyzeFood } = await import("@/lib/api");
            const result = await analyzeFood(base64Image);
            if (result.calories === 0 && result.food_items.length === 0) {
              sendText(`[SYSTEM: Food scan could not recognize any food — the frame was blank or unclear. Do NOT call initiate_food_scan again. Tell the patient the camera could not see the food clearly, and ask them to describe what they ate verbally so you can log it manually.]`);
            } else {
              sendText(`[SYSTEM: Food scan complete — ${result.calories} kcal, ${result.protein_g}g protein, ${result.carbs_g}g carbs, ${result.fat_g}g fat. Items: ${result.food_items.join(", ")}. READ these results to the patient and ask if they want to log this meal.]`);
            }
          } catch (error) {
            console.error("Food analysis failed", error);
            sendText(`[SYSTEM: Food analysis failed. Ask the user to describe the meal instead.]`);
          } finally {
            foodScanInProgress.current = false;
          }
        })
        .catch(() => {
          sendText(`[SYSTEM: Camera not ready. Ask the user to tap the snap button once the camera is showing, or describe the meal instead.]`);
          foodScanInProgress.current = false;
        });
    }
  }, [navigate, pushUIEvent, cameraActive, startCamera, stopCamera, sendText]);

  useEffect(() => {
    handleUIEventRef.current = handleUIEventReal;
  }, [handleUIEventReal]);

  const handleFoodSnap = useCallback(async () => {
    if (scanningFood || !videoRef.current) return;
    if (videoRef.current.readyState < 2) {
      toast({ title: "Camera not ready", description: "Please wait a moment for the camera to load, then try again." });
      return;
    }
    setScanningFood(true);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) { setScanningFood(false); return; }
    canvas.width = 640;
    canvas.height = 480;
    ctx.drawImage(videoRef.current, 0, 0, 640, 480);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
    const base64Image = dataUrl.split(",")[1];
    try {
      const { analyzeFood } = await import("@/lib/api");
      const result = await analyzeFood(base64Image);
      if (result.calories === 0 && result.food_items.length === 0) {
        sendText(`[SYSTEM: Food scan could not recognize any food — the frame was blank or unclear. Do NOT call initiate_food_scan again. Tell the patient the camera could not see the food clearly, and ask them to describe what they ate verbally so you can log it manually.]`);
      } else {
        sendText(`[SYSTEM: Food scan complete — ${result.calories} kcal, ${result.protein_g}g protein, ${result.carbs_g}g carbs, ${result.fat_g}g fat. Items: ${result.food_items.join(", ")}. READ these results to the patient and ask if they want to log this meal.]`);
      }
    } catch (error) {
      console.error("Food snap failed", error);
      sendText(`[SYSTEM: Food analysis failed. Ask the user to describe the meal instead.]`);
    } finally {
      setScanningFood(false);
    }
  }, [scanningFood, sendText]);

  const toggleCamera = () => {
    if (cameraActive) {
      stopCamera();
    } else {
      startCamera();
    }
  };

  // Cleanup camera on unmount
  useEffect(() => {
    return () => { stopCamera(); };
  }, [stopCamera]);

  const isActive = status === "connected" || status === "ready";

  return (
    <AppLayout>
      {/* SOS FaceTime Overlay */}
      {sosAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border-2 border-destructive bg-card p-8 text-center shadow-2xl">
            <div className="mb-4 text-6xl">🚨</div>
            <h2 className="mb-2 font-display text-2xl font-bold text-destructive">Emergency Alert</h2>
            <p className="mb-6 text-sm text-muted-foreground">{sosAlert.message}</p>
            {sosAlert.facetimeUrl && (
              <a
                href={sosAlert.facetimeUrl}
                onClick={() => setSosAlert(null)}
                className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-green-500 px-6 py-4 font-display text-lg font-bold text-white shadow-lg hover:bg-green-600"
              >
                📞 FaceTime {sosAlert.contactName}
              </a>
            )}
            <button
              onClick={() => setSosAlert(null)}
              className="mt-2 w-full rounded-lg border border-border py-2 font-mono text-xs uppercase tracking-widest text-muted-foreground hover:bg-secondary"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="mb-12">
        <h1 className="font-display text-5xl font-bold tracking-tight lg:text-7xl">
          Voice
          <br />
          <em className="text-primary">Guardian</em>
        </h1>
        <div className="rule-thick mt-6 mb-8 max-w-32" />
        <p className="max-w-lg text-lg text-muted-foreground">
          Your AI health companion — speak naturally in your language
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main voice area */}
        <div className="rounded-lg border border-border bg-card p-8 text-center lg:col-span-2">
          {/* Live Interpreter banner */}
          {isLiveInterpreterActive && (
            <div className="mb-4 flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 py-2 px-4">
              <Languages size={16} strokeWidth={1.5} className="text-primary" />
              <span className="font-mono text-xs uppercase tracking-widest text-primary">
                Interpreter active: {LANGUAGE_PERSONAS[selectedPersona]?.label ?? "English"} ↔ {LANGUAGE_PERSONAS[selectedPersona]?.label === "English" ? "Other (auto)" : "English"}
              </span>
            </div>
          )}

          {/* Connection status */}
          <div className="mb-6 flex items-center justify-center gap-2">
            {status === "ready" ? (
              <Wifi size={14} strokeWidth={1.5} className="text-success" />
            ) : isActive ? (
              <Wifi size={14} strokeWidth={1.5} className="animate-pulse text-primary" />
            ) : status === "error" ? (
              <WifiOff size={14} strokeWidth={1.5} className="text-destructive" />
            ) : (
              <WifiOff size={14} strokeWidth={1.5} className="text-muted-foreground" />
            )}
            <span
              className={`font-mono text-[10px] uppercase tracking-widest ${status === "ready"
                ? "text-success"
                : isActive
                  ? "text-primary"
                  : status === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
            >
              {statusLabels[status]}
            </span>
          </div>

          {/* Camera feed — always in DOM so videoRef is available when startCamera() sets srcObject */}
          <div className={`relative mx-auto mb-6 max-w-md overflow-hidden rounded-lg border border-border${cameraActive ? "" : " hidden"}`}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-auto w-full"
            />
            <div className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-white">
              LIVE
            </div>
            {/* Snap button — capture food photo */}
            <button
              onClick={handleFoodSnap}
              disabled={scanningFood}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-white/20 backdrop-blur-sm transition-all hover:bg-white/40 disabled:opacity-50"
              title="Capture food photo for macro analysis"
            >
              {scanningFood ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                  className="h-6 w-6 rounded-full border-2 border-white border-t-transparent"
                />
              ) : (
                <Utensils size={20} className="text-white" />
              )}
            </button>
          </div>

          {/* Mic Button / Avatar */}
          <div className="relative mx-auto mb-8 inline-block">
            <button
              onClick={handleMicToggle}
              disabled={status === "connecting"}
              className={`relative flex h-32 w-32 items-center justify-center overflow-hidden rounded-full transition-all duration-150 disabled:opacity-50 ${isActive
                ? "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/30"
                : "bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40"
                }`}
            >
              {displayAvatar ? (
                <div className="relative h-full w-full">
                  <img
                    src={displayAvatar}
                    alt="Companion"
                    className="h-full w-full object-cover"
                  />
                  {/* Lip Sync / Speaking Overlay */}
                  {isSpeaking && (
                    <motion.div
                      animate={{
                        scaleY: [1, 1.2, 1, 1.3, 1],
                        opacity: [0.3, 0.6, 0.3]
                      }}
                      transition={{ repeat: Infinity, duration: 0.5 }}
                      className="absolute bottom-4 left-1/2 h-4 w-8 -translate-x-1/2 rounded-full bg-white/40 blur-sm"
                    />
                  )}
                </div>
              ) : (
                status === "connecting" ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                    className="h-8 w-8 rounded-full border-2 border-primary-foreground border-t-transparent"
                  />
                ) : isActive ? (
                  <MicOff size={32} strokeWidth={1.5} />
                ) : (
                  <Mic size={32} strokeWidth={1.5} />
                )
              )}
            </button>
            {isActive && isListening && !isSpeaking && (
              <motion.div
                animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.1, 0.4] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="absolute -inset-4 rounded-full border-2 border-primary/30"
              />
            )}
          </div>

          {/* Companion name label */}
          <div className="mt-3 mb-2 flex items-center justify-center gap-2">
            {displayAvatar && (
              <span className="inline-block h-2 w-2 rounded-full bg-green-400 shadow-sm shadow-green-400/60" />
            )}
            <span className="text-sm font-semibold tracking-wide text-foreground">
              {displayName}
            </span>
          </div>

          {isSpeaking && (
            <div className="mb-4 flex items-center justify-center gap-1">
              {[...Array(5)].map((_, i) => (
                <motion.div
                  key={i}
                  animate={{ height: [4, 16, 4] }}
                  transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                  className="w-1 rounded-full bg-primary"
                />
              ))}
              <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-primary">
                Speaking
              </span>
            </div>
          )}

          <p className="mb-8 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {isListening ? "Listening\u2026 speak naturally" : "Tap the microphone to start"}
          </p>

          {/* Controls */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={toggleCamera}
              disabled={!isActive}
              className={`flex h-12 w-12 items-center justify-center rounded-full border transition-colors duration-150 disabled:opacity-30 ${cameraActive
                ? "border-green-500/30 bg-green-500/10 text-green-500"
                : "border-border bg-card text-foreground hover:bg-secondary"
                }`}
              title={cameraActive ? "Stop camera" : "Start camera for pill/food detection"}
            >
              {cameraActive ? <CameraOff size={20} strokeWidth={1.5} /> : <Camera size={20} strokeWidth={1.5} />}
            </button>
            <button
              onClick={handleTranslatorToggle}
              disabled={!isActive}
              className={`flex h-12 w-12 items-center justify-center rounded-full border transition-colors duration-150 disabled:opacity-30 ${isLiveInterpreterActive
                ? "border-primary bg-primary/20 text-primary"
                : "border-border bg-card text-foreground hover:bg-secondary"
                }`}
              title={isLiveInterpreterActive ? "Turn off live translation" : "Turn on live translation (interpreter mode)"}
            >
              <Languages size={20} strokeWidth={1.5} />
            </button>
            <button className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors duration-150 hover:bg-secondary">
              <Volume2 size={20} strokeWidth={1.5} />
            </button>
            <button
              onClick={() => { disconnect(); stopCamera(); }}
              disabled={!isActive}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive transition-colors duration-150 hover:bg-destructive/20 disabled:opacity-30"
            >
              <Phone size={20} strokeWidth={1.5} />
            </button>
          </div>

          {/* Language/persona selector */}
          <div className="mt-8 flex items-center justify-center gap-2">
            <Globe size={16} strokeWidth={1.5} className="text-muted-foreground" />
            {Object.values(LANGUAGE_PERSONAS).map((lang) => (
              <button
                key={lang.code}
                onClick={() => handlePersonaChange(lang.code, lang.label)}
                disabled={isActive}
                className={`rounded-full px-4 py-1.5 font-mono text-xs uppercase tracking-widest transition-colors duration-150 disabled:opacity-60 ${selectedPersona === lang.code
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
              >
                {lang.label}
              </button>
            ))}
          </div>

          {/* Text input fallback */}
          {isActive && (
            <div className="mx-auto mt-6 flex max-w-md gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendText()}
                placeholder="Type a message instead…"
                className="flex-1 rounded-md border border-border bg-background px-4 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <button
                onClick={handleSendText}
                disabled={!textInput.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors disabled:opacity-30"
              >
                <Send size={16} strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>

        {/* Right column: Transcript + UI Events */}
        <div className="flex flex-col gap-6">
          {/* Transcript */}
          <div className="flex flex-col rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h2 className="font-display text-xl font-bold tracking-tight">Conversation</h2>
              {transcript.length > 0 && (
                <button
                  onClick={clearTranscript}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="Clear transcript"
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                </button>
              )}
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: "350px" }}>
              {transcript.length === 0 ? (
                <div className="py-12 text-center">
                  <Mic size={24} strokeWidth={1} className="mx-auto mb-3 text-muted-foreground/40" />
                  <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                    {isActive ? "Waiting for speech\u2026" : "Start a conversation"}
                  </p>
                </div>
              ) : (
                <AnimatePresence>
                  {transcript.map((msg, i) => (
                    <motion.div
                      key={`${msg.timestamp}-${i}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className={`rounded-md border-l-4 p-4 ${msg.role === "assistant"
                        ? "border-primary bg-primary/5"
                        : "border-accent bg-accent/5"
                        }`}
                    >
                      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {msg.role === "assistant" ? "Heali" : "You"}
                      </p>
                      <p className="text-sm leading-relaxed">{msg.text}</p>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>

          {/* Generative UI Events */}
          {uiEvents.length > 0 && (
            <div className="flex flex-col rounded-lg border border-border bg-card">
              <div className="border-b border-border p-4">
                <h2 className="font-display text-xl font-bold tracking-tight">Activity</h2>
              </div>
              <div className="space-y-3 overflow-y-auto p-4" style={{ maxHeight: "250px" }}>
                <AnimatePresence>
                  {uiEvents.map((event, i) => renderUICard(event, i))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default VoiceGuardian;
