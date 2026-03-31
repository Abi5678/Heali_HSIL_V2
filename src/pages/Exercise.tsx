import { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Play, Square, Camera, CameraOff, Trophy,
  Activity, Wind, MoveHorizontal, Dumbbell, Wifi, WifiOff,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { useVoiceGuardian } from "@/hooks/useVoiceGuardian";
import { useAuth } from "@/contexts/AuthContext";
import { getProfile } from "@/lib/api";
import { LANGUAGE_PERSONAS } from "@/lib/voiceConfig";
import { toast } from "@/hooks/use-toast";
import { useUIEvent } from "@/hooks/useUIEventStore";
import { pushUIEvent } from "@/hooks/useUIEventStore";
import type { UIEvent } from "@/hooks/useVoiceGuardian";

const PHASE_INFO = [
  { name: "Breathing", icon: Wind, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  { name: "Stretches", icon: MoveHorizontal, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  { name: "Cool-Down", icon: Wind, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
];

const EXERCISE_TO_PHASE: Record<string, string> = {
  "Box Breathing": "Breathing",
  "Neck Rolls": "Stretches",
  "Seated Side Bend": "Stretches",
  "Final Relaxation": "Cool-Down",
};

const TOTAL_EXERCISES = 4;

/**
 * Injected as ?proactive_prompt= on the WebSocket URL.
 * Tells the root guardian agent to skip its standard greeting and route
 * SILENTLY to the exercise sub-agent, which will do the welcome itself.
 */
const EXERCISE_PROACTIVE_PROMPT =
  "[WELLNESS_SESSION_START]: The user has opened the dedicated Exercise & Wellness page. " +
  "Do NOT greet them as the guardian agent. Do NOT say a single word. " +
  "IMMEDIATELY route to the exercise sub-agent — it will welcome the user and start the session.";

type SessionState = "connecting" | "welcome" | "active" | "completed";

const Exercise = () => {
  const { user, getIdToken } = useAuth();
  const [sessionState, setSessionState] = useState<SessionState>("connecting");
  const [firebaseToken, setFirebaseToken] = useState<string>("demo");
  const [persona, setPersona] = useState("en");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [currentExercise, setCurrentExercise] = useState<string>("");
  const [exerciseNumber, setExerciseNumber] = useState(0);
  const [currentPhase, setCurrentPhase] = useState<string>("Breathing");
  const [postureNotes, setPostureNotes] = useState<string>("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [completionData, setCompletionData] = useState<Record<string, unknown> | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [exerciseCountdown, setExerciseCountdown] = useState<number | null>(null);
  const [coachPaused, setCoachPaused] = useState(false);
  const coachSilentSinceRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const exerciseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const exerciseNameRef = useRef<string>("");

  // Set srcObject once the video element mounts (after cameraActive → true)
  useEffect(() => {
    if (cameraActive && videoRef.current && cameraStreamRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current;
    }
  }, [cameraActive]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const hasAutoConnected = useRef(false);

  // Listen for exercise UI events
  const sessionStarted = useUIEvent("exercise_session_started");
  const poseChange = useUIEvent("exercise_pose_change");
  const sessionCompleted = useUIEvent("exercise_session_completed");
  const timerStarted = useUIEvent("exercise_timer_started");

  // When agent calls start_exercise_session → start camera + timer
  useEffect(() => {
    if (sessionStarted) {
      setSessionState("active");
      startTimer();
      startCamera();
    }
  }, [sessionStarted]);

  useEffect(() => {
    if (poseChange) {
      const data = (poseChange.data ?? poseChange) as Record<string, unknown>;
      setCurrentExercise(String(data.exercise_name || ""));
      setExerciseNumber(Number(data.exercise_number || 0));
      setCurrentPhase(String(data.phase || "Breathing"));
      setPostureNotes(String(data.posture_notes || ""));
      setCoachPaused(false);
      coachSilentSinceRef.current = null;
    }
  }, [poseChange]);

  useEffect(() => {
    if (sessionCompleted) {
      const data = (sessionCompleted.data ?? sessionCompleted) as Record<string, unknown>;
      setCompletionData(data);
      setSessionState("completed");
      stopTimer();
      stopCamera();
    }
  }, [sessionCompleted]);

  // Frontend exercise countdown — Purely Visual
  useEffect(() => {
    if (!timerStarted) return;
    const data = (timerStarted.data ?? timerStarted) as Record<string, unknown>;
    const duration = Math.max(Number(data.duration_seconds || 30), 15);
    const name = String(data.exercise_name || "exercise");

    exerciseNameRef.current = name;

    // Sync Session Info
    setCurrentExercise(name);
    setCurrentPhase(EXERCISE_TO_PHASE[name] ?? "Breathing");

    // Clear any previous timers
    if (exerciseTimerRef.current) clearInterval(exerciseTimerRef.current);
    setExerciseCountdown(duration);

    // Purely visual countdown timer
    let remaining = duration;
    exerciseTimerRef.current = setInterval(() => {
      remaining -= 1;
      setExerciseCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(exerciseTimerRef.current!);
        exerciseTimerRef.current = null;
        setExerciseCountdown(null);
        setCoachPaused(false);
        coachSilentSinceRef.current = null;
      }
    }, 1000);

    return () => {
      if (exerciseTimerRef.current) clearInterval(exerciseTimerRef.current);
    };
  }, [timerStarted]);

  const handleUIEvent = useCallback((event: UIEvent) => {
    pushUIEvent(event);
  }, []);

  const {
    status,
    isListening,
    isSpeaking,
    isSpeakingRef,
    transcript,
    connect,
    disconnect,
    sendText,
    sendImage,
    clearTranscript,
  } = useVoiceGuardian({
    userId: user?.uid,
    token: firebaseToken,
    persona,
    patientName: user?.displayName || undefined,
    proactivePrompt: EXERCISE_PROACTIVE_PROMPT,
    exercisesCompleted: exerciseNumber > 0 ? exerciseNumber : undefined,
    onError: (msg) => {
      toast({ variant: "destructive", title: "Exercise Coach", description: msg });
    },
    onUIEvent: handleUIEvent,
  });

  // Fetch profile for language preference before connecting
  useEffect(() => {
    let cancelled = false;
    const loadProfile = async () => {
      const token = await getIdToken();
      if (token) setFirebaseToken(token);
      if (token && token !== "demo") {
        try {
          const profile = (await getProfile(token)) as Record<string, unknown>;
          if (!cancelled && profile?.language) {
            const found = Object.values(LANGUAGE_PERSONAS).find((p) => p.label === profile.language);
            if (found) setPersona(found.code);
          }
        } catch (e) {
          if (!cancelled) console.error("Failed to fetch profile for Exercise persona:", e);
        }
      }
      if (!cancelled) setProfileLoaded(true);
    };
    loadProfile();
    return () => { cancelled = true; };
  }, [getIdToken]);

  // Auto-connect on page load after profile is loaded
  useEffect(() => {
    if (!profileLoaded || hasAutoConnected.current) return;
    hasAutoConnected.current = true;

    const autoConnect = async () => {
      const token = await getIdToken();
      await connect(token ?? "demo");
      setSessionState("welcome");
    };

    autoConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoaded]);

  // Detect coach pause: silent for 12+ seconds during active exercise.
  // 12s avoids triggering when coach is waiting for "Are you ready for the next one?" (user says "yes").
  useEffect(() => {
    if (sessionState !== "active" || exerciseCountdown === null) {
      coachSilentSinceRef.current = null;
      setCoachPaused(false);
      return;
    }
    if (isSpeaking) {
      coachSilentSinceRef.current = null;
      setCoachPaused(false);
      return;
    }
    if (coachSilentSinceRef.current === null) coachSilentSinceRef.current = Date.now();
    const id = setInterval(() => {
      if (isSpeakingRef.current) {
        coachSilentSinceRef.current = null;
        setCoachPaused(false);
        return;
      }
      const elapsed = Date.now() - (coachSilentSinceRef.current ?? 0);
      if (elapsed >= 12000) setCoachPaused(true);
    }, 1000);
    return () => clearInterval(id);
  }, [isSpeaking, sessionState, exerciseCountdown]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Timer
  const startTimer = useCallback(() => {
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Camera with front-facing mode for posture
  const startCamera = useCallback(async () => {
    if (cameraStreamRef.current) return; // already active
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
      });
      cameraStreamRef.current = stream;
      setCameraActive(true); // video element mounts → useEffect sets srcObject

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
        description: "Camera access denied. Camera is needed for posture feedback.",
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

  const handleEndSession = useCallback(() => {
    disconnect();
    stopCamera();
    stopTimer();
    if (sessionState === "active" || sessionState === "welcome") {
      setSessionState("completed");
    }
  }, [disconnect, stopCamera, stopTimer, sessionState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      stopTimer();
      if (exerciseTimerRef.current) clearInterval(exerciseTimerRef.current);
    };
  }, [stopCamera, stopTimer]);

  const progressPercent = Math.round((exerciseNumber / TOTAL_EXERCISES) * 100);
  const isConnected = status === "connected" || status === "ready";
  const phaseInfo = PHASE_INFO.find((p) => p.name === currentPhase) || PHASE_INFO[0];

  return (
    <AppLayout>
      <div className="mb-12">
        <h1 className="font-display text-5xl font-bold tracking-tight lg:text-7xl">
          Exercise
          <br />
          <em className="text-emerald-400">& Wellness</em>
        </h1>
        <div className="mt-6 mb-8 h-1 max-w-32 bg-emerald-400" />
        <p className="max-w-lg text-lg text-muted-foreground">
          10-minute guided session with real-time posture coaching via camera
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Camera + Controls */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Camera View */}
          <div className="relative overflow-hidden rounded-lg border border-border bg-card">
            <div className="relative flex aspect-video items-center justify-center bg-black/90">
              {cameraActive ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                    style={{ transform: "scaleX(-1)" }}
                  />
                  {/* Overlay badges */}
                  <div className="absolute top-3 left-3 flex items-center gap-2">
                    <div className="flex items-center gap-1.5 rounded bg-black/60 px-2 py-1">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                      <span className="font-mono text-[10px] text-white">LIVE</span>
                    </div>
                    {isSpeaking && (
                      <div className="flex items-center gap-1 rounded bg-emerald-600/80 px-2 py-1">
                        {[...Array(3)].map((_, i) => (
                          <motion.div
                            key={i}
                            animate={{ height: [3, 10, 3] }}
                            transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                            className="w-0.5 rounded-full bg-white"
                          />
                        ))}
                        <span className="ml-1 font-mono text-[10px] text-white">Coach</span>
                      </div>
                    )}
                  </div>
                  {/* Timer displays removed per user request */}
                </>
              ) : (
                <div className="text-center">
                  {sessionState === "connecting" ? (
                    <>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                        className="mx-auto mb-4"
                      >
                        <Activity size={48} strokeWidth={1} className="text-emerald-400/60" />
                      </motion.div>
                      <p className="font-mono text-sm uppercase tracking-widest text-muted-foreground">
                        Connecting to your wellness coach...
                      </p>
                    </>
                  ) : sessionState === "completed" ? (
                    <>
                      <Trophy size={48} strokeWidth={1} className="mx-auto mb-4 text-emerald-400/60" />
                      <p className="font-mono text-sm uppercase tracking-widest text-muted-foreground">
                        Session complete!
                      </p>
                    </>
                  ) : (
                    <>
                      <Dumbbell size={48} strokeWidth={1} className="mx-auto mb-4 text-emerald-400/40" />
                      <p className="font-mono text-sm uppercase tracking-widest text-muted-foreground">
                        {sessionState === "welcome"
                          ? "Your coach is ready — say \"let's go\" to begin!"
                          : "Ready to begin your wellness session"}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Controls bar */}
            <div className="flex items-center justify-between border-t border-border p-4">
              <div className="flex items-center gap-2">
                {status === "ready" ? (
                  <Wifi size={14} strokeWidth={1.5} className="text-success" />
                ) : isConnected ? (
                  <Wifi size={14} strokeWidth={1.5} className="animate-pulse text-primary" />
                ) : (
                  <WifiOff size={14} strokeWidth={1.5} className="text-muted-foreground" />
                )}
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {status === "ready"
                    ? "Coach connected"
                    : status === "connecting"
                      ? "Connecting..."
                      : isConnected
                        ? "Connecting to coach..."
                        : "Disconnected"}
                </span>
              </div>
              <div className="flex gap-3">
                {(status === "connecting" || status === "error") && (
                  <button
                    onClick={async () => {
                      disconnect();
                      hasAutoConnected.current = false;
                      setSessionState("connecting");
                      const token = await getIdToken();
                      if (token) setFirebaseToken(token);
                      await connect(token ?? "demo");
                    }}
                    className="flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 font-mono text-sm uppercase tracking-widest text-primary-foreground shadow-md transition-all hover:bg-primary/90 hover:shadow-lg"
                  >
                    <Play size={16} strokeWidth={1.5} />
                    Retry
                  </button>
                )}
                {(sessionState === "active" || sessionState === "welcome") && (
                  <button
                    onClick={handleEndSession}
                    className="flex items-center gap-2 rounded-md bg-red-500 px-6 py-2.5 font-mono text-sm uppercase tracking-widest text-white shadow-md transition-all hover:bg-red-600 hover:shadow-lg"
                  >
                    <Square size={16} strokeWidth={1.5} />
                    End Session
                  </button>
                )}
                {sessionState === "completed" && (
                  <button
                    onClick={() => {
                      setSessionState("connecting");
                      setCompletionData(null);
                      setExerciseNumber(0);
                      setElapsedSeconds(0);
                      setCurrentExercise("");
                      setCurrentPhase("Breathing");
                      setPostureNotes("");
                      clearTranscript();
                      hasAutoConnected.current = false;
                    }}
                    className="flex items-center gap-2 rounded-md bg-emerald-500 px-6 py-2.5 font-mono text-sm uppercase tracking-widest text-white shadow-md transition-all hover:bg-emerald-600 hover:shadow-lg"
                  >
                    <Play size={16} strokeWidth={1.5} />
                    New Session
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Completion summary */}
          {sessionState === "completed" && completionData && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border-2 border-emerald-500/30 bg-emerald-500/5 p-6"
            >
              <div className="mb-4 flex items-center gap-3">
                <Trophy size={24} className="text-emerald-400" />
                <h2 className="font-display text-xl font-bold tracking-tight">Session Complete!</h2>
              </div>
              <p className="mb-4 text-muted-foreground">
                {String(completionData.encouragement || "Great work today!")}
              </p>
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-md bg-card p-4 text-center">
                  <p className="font-mono text-2xl font-bold text-emerald-400">
                    {String(completionData.exercises_completed || exerciseNumber)}/{TOTAL_EXERCISES}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Exercises</p>
                </div>
                <div className="rounded-md bg-card p-4 text-center">
                  <p className="font-mono text-2xl font-bold text-emerald-400">
                    {(completionData.duration_minutes as number | undefined) ?? "—"}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Minutes</p>
                </div>
                <div className="rounded-md bg-card p-4 text-center">
                  <p className="font-mono text-2xl font-bold text-emerald-400">
                    {String(completionData.posture_score || "—")}/100
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Posture</p>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Right column: Progress + Transcript */}
        <div className="flex flex-col gap-6">
          {/* Session Info Card */}
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-4 font-display text-lg font-bold tracking-tight">Session Info</h2>

            {/* Phase indicator */}
            <div className={`mb-4 rounded-md border ${phaseInfo.border} ${phaseInfo.bg} p-3`}>
              <div className="flex items-center gap-2">
                <phaseInfo.icon size={16} className={phaseInfo.color} />
                <span className={`font-mono text-xs font-semibold uppercase tracking-widest ${phaseInfo.color}`}>
                  {sessionState === "active" ? (currentPhase || "Breathing") : sessionState === "welcome" ? "Warm-up" : "Ready"}
                </span>
              </div>
              {currentExercise && (
                <p className="mt-1 text-sm font-medium">{currentExercise}</p>
              )}
              {sessionState === "welcome" && !currentExercise && (
                <p className="mt-1 text-sm text-muted-foreground">Listening to your coach...</p>
              )}
            </div>

            {/* Progress */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Progress</span>
                <span className="font-mono text-xs text-muted-foreground">{exerciseNumber}/{TOTAL_EXERCISES}</span>
              </div>
              <div className="h-2.5 rounded-full bg-secondary">
                <motion.div
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.4 }}
                  className="h-full rounded-full bg-emerald-500"
                />
              </div>
            </div>

            {/* Timer removed */}

            {/* Coach paused — tap to nudge (or say "yes"/"ready" if waiting for confirmation) */}
            {coachPaused && (
              <motion.button
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => {
                  sendText(
                    "[SYSTEM: Coach paused. Resume immediately — continue counting the rhythm (e.g. In... 2... 3... 4...). Do NOT re-introduce the exercise. Do NOT say 'Let's start with' again.]",
                    { silent: true }
                  );
                  setCoachPaused(false);
                  coachSilentSinceRef.current = null;
                }}
                className="mt-4 w-full rounded-md border-2 border-dashed border-amber-500/50 bg-amber-500/10 py-3 font-mono text-xs uppercase tracking-widest text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
              >
                Coach paused? Say &quot;yes&quot; or &quot;ready&quot; to continue — or tap to nudge
              </motion.button>
            )}

            {/* Posture notes */}
            {postureNotes && (
              <div className="mt-4 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-emerald-400">Coach Feedback</p>
                <p className="mt-1 text-sm text-muted-foreground">{postureNotes}</p>
              </div>
            )}

            {/* Phase pills */}
            <div className="mt-4 flex flex-wrap gap-2">
              {PHASE_INFO.map((phase) => {
                const isCurrentPhase = phase.name === currentPhase;
                const phaseIdx = PHASE_INFO.indexOf(phase);
                const currentPhaseIdx = PHASE_INFO.findIndex((p) => p.name === currentPhase);
                const isDone = phaseIdx < currentPhaseIdx;
                return (
                  <div
                    key={phase.name}
                    className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-widest ${isCurrentPhase && sessionState === "active"
                      ? `${phase.bg} ${phase.border} border ${phase.color}`
                      : isDone
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-secondary text-muted-foreground"
                      }`}
                  >
                    {phase.name}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Transcript */}
          <div className="flex flex-col rounded-lg border border-border bg-card">
            <div className="border-b border-border p-4">
              <h2 className="font-display text-lg font-bold tracking-tight">Coach</h2>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: "350px" }}>
              {transcript.length === 0 ? (
                <div className="py-8 text-center">
                  <Activity size={20} strokeWidth={1} className="mx-auto mb-2 text-muted-foreground/40" />
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {sessionState === "connecting" ? "Connecting..." : "Waiting for coach..."}
                  </p>
                  {(status === "error" || status === "connecting") && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Stuck? Ensure the backend is running, then tap <strong>Retry</strong> below.
                    </p>
                  )}
                </div>
              ) : (
                <AnimatePresence>
                  {transcript.map((msg, i) => (
                    <motion.div
                      key={`${msg.timestamp}-${i}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className={`rounded-md p-3 ${msg.role === "assistant"
                        ? "border-l-4 border-emerald-500 bg-emerald-500/5"
                        : "border-l-4 border-accent bg-accent/5"
                        }`}
                    >
                      <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {msg.role === "assistant" ? "Coach" : "You"}
                      </p>
                      <p className="text-sm leading-relaxed">{msg.text}</p>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Exercise;
