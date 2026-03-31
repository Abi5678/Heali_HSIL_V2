import { useRef, useState, useCallback, useEffect } from "react";
import {
  VOICE_WS_BASE_URL,
  DEFAULT_USER_ID,
  AUDIO_SAMPLE_RATE,
  AUDIO_CHANNELS,
} from "@/lib/voiceConfig";
import { HEALI_VOICES } from "@/lib/personas";

export interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

export interface UIEvent {
  target: string;
  [key: string]: unknown;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "ready" | "error";

interface UseVoiceGuardianOptions {
  userId?: string;
  persona?: string;
  token?: string;
  patientName?: string;
  /** Optional proactive prompt injected as ?proactive_prompt= query param.
   *  Used by dedicated pages (e.g. Exercise) to bypass the root-agent greeting
   *  and route directly to the correct sub-agent on connection. */
  proactivePrompt?: string;
  /** For Exercise page: when reconnecting, pass exercises completed so far (1–14).
   *  Enables resume on reconnect without full session restart. */
  exercisesCompleted?: number;
  onTranscript?: (msg: TranscriptMessage) => void;
  onUIEvent?: (event: UIEvent) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: string) => void;
}

/**
 * Hook for WebSocket voice streaming to the MedLive FastAPI backend.
 *
 * Protocol (matches app/main.py):
 *
 * CLIENT → SERVER (JSON text frames):
 *   { type: "audio", data: "<base64 PCM 16kHz mono>" }
 *   { type: "text",  text: "hello" }
 *   { type: "image", data: "<base64>", mimeType: "image/jpeg" }
 *
 * SERVER → CLIENT (JSON text frames):
 *   { type: "ready" }                          — Gemini Live connected
 *   ADK LiveEvent with:
 *     - content.parts[].inline_data.data       — base64 audio response
 *     - content.parts[].text                   — text response
 *     - input_transcription.text               — user speech transcription
 *     - output_transcription.text              — assistant speech transcription
 *     - turn_complete: true                    — turn boundary
 *   UI events: { target: "...", ... }          — generative UI updates
 */
export function useVoiceGuardian(options: UseVoiceGuardianOptions = {}) {
  const {
    userId = DEFAULT_USER_ID,
    persona = "en",
    token = "",
    patientName,
    proactivePrompt,
    exercisesCompleted,
    onTranscript,
    onUIEvent,
    onStatusChange,
    onError,
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [avatarB64, setAvatarB64] = useState<string | null>(null);
  const [companionName, setCompanionName] = useState<string>("Your Health Companion");

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  // Tracks the end-time of the last scheduled audio chunk for gapless sequential playback
  const nextPlayTimeRef = useRef<number>(0);
  // When true, the worklet onmessage drops audio frames instead of sending them.
  // Set while TTS text is processing so the mic stream doesn't interfere.
  const audioMutedRef = useRef<boolean>(false);
  const audioMuteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnCompleteReceivedRef = useRef<boolean>(false);
  // Tracks whether the current agent turn produced any audio.
  // A silent turn_complete (routing turn) must NOT unmute the mic — the real
  // response is coming from the sub-agent in the next turn.
  const hasAudioThisTurnRef = useRef<boolean>(false);
  // Ref mirror of isSpeaking — readable inside setInterval/setTimeout without stale closures.
  // Updated via useEffect whenever isSpeaking state changes.
  const isSpeakingRef = useRef<boolean>(false);
  // Set to true before intentional ws.close() so onclose knows not to auto-reconnect
  const intentionalDisconnectRef = useRef<boolean>(false);
  // Tracks reconnect attempt count for exponential backoff
  const reconnectAttemptsRef = useRef<number>(0);
  // Tracks whether a voice session was ever successfully established (for visibility/online handlers)
  const wasConnectedRef = useRef<boolean>(false);
  // Always-current ref to connect() — used by event listeners to avoid stale closures
  const connectRef = useRef<((tokenOverride?: string) => Promise<void>) | null>(null);

  // Keep isSpeakingRef in sync with isSpeaking state so interval callbacks
  // can read the current value without stale-closure issues.
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  const updateStatus = useCallback((newStatus: ConnectionStatus) => {
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  const addTranscript = useCallback((msg: TranscriptMessage) => {
    setTranscript(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === msg.role) {
        const newText = msg.text.trim();
        const oldText = last.text.trim();

        // 1. Exact or near-exact match
        if (newText === oldText) return prev;

        // 2. Incremental update (Gemini-Live mode: new is extension of old)
        if (newText.startsWith(oldText)) {
          return [...prev.slice(0, -1), { ...msg, text: newText }];
        }

        // 3. Reverse incremental (old starts with new, ignore new)
        if (oldText.startsWith(newText)) {
          return prev;
        }

        // 4. Fragment Merging: If assistant sends new text within a short window,
        // merge it into the same bubble to avoid fragmentation.
        const timeDiff = msg.timestamp - last.timestamp;
        if (msg.role === "assistant" && timeDiff < 8000) {
          // Join with space if they don't already overlap
          const joinedText = oldText + (newText.startsWith(" ") || oldText.endsWith(" ") ? "" : " ") + newText;
          return [...prev.slice(0, -1), { ...msg, text: joinedText, timestamp: msg.timestamp }];
        }
      }
      return [...prev, msg];
    });
    onTranscript?.(msg);
  }, [onTranscript]);

  // Convert Float32Array to 16-bit PCM then base64
  const float32ToPCM16Base64 = useCallback((float32: Float32Array): string => {
    const buffer = new ArrayBuffer(float32.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    // Convert to base64
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }, []);

  // Play base64-encoded PCM audio response — gapless streaming scheduler
  const playAudioResponse = useCallback(async (base64Audio: string, mimeType?: string) => {
    // GUARD: Skip malformed or placeholder strings like "!!!"
    if (!base64Audio || base64Audio === "!!!" || base64Audio.length < 4) {
      return;
    }

    try {
      // Parse sample rate from mimeType e.g. "audio/pcm;rate=24000"
      // gemini-live-2.5-flash-native-audio outputs at 24kHz
      const rateMatch = mimeType?.match(/rate=(\d+)/);
      const outputSampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

      // Handle Interruption / New Turn: If nextPlayTimeRef is 0 we should stop any lingering audio chunks
      if (nextPlayTimeRef.current === 0 && activeSourcesRef.current.length > 0) {
        activeSourcesRef.current.forEach(source => {
          try { source.stop(); } catch (e) { }
        });
        activeSourcesRef.current = [];
      }

      if (!playbackContextRef.current || playbackContextRef.current.state === "closed") {
        playbackContextRef.current = new AudioContext({ sampleRate: outputSampleRate });
        nextPlayTimeRef.current = 0;
      }
      const ctx = playbackContextRef.current;

      // Resume AudioContext suspended by browser autoplay policy.
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      // Robust base64 decoding for binary data
      // 1. Remove whitespace and handle URL-safe base64 characters
      const cleaned = base64Audio.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");

      // 2. Strict validation: only proceed if it looks like valid base64
      if (!/^[A-Za-z0-9+/=]{4,}$/.test(cleaned)) {
        return;
      }

      let binaryString: string;
      try {
        binaryString = atob(cleaned);
      } catch (e) {
        // Silently skip if it still fails (protects the session)
        return;
      }

      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Decode PCM bytes into an AudioBuffer
      let audioBuffer: AudioBuffer;
      if (!mimeType || mimeType.includes("pcm")) {
        // Raw PCM: 16-bit signed little-endian → Float32
        const int16 = new Int16Array(bytes.buffer);
        audioBuffer = ctx.createBuffer(1, int16.length, outputSampleRate);
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < int16.length; i++) {
          channelData[i] = int16[i] / 32768;
        }
      } else {
        audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      }

      // CRITICAL FIX 2: Schedule each chunk to start right after the previous one.
      // Without this, all chunks call start() at ctx.currentTime and stomp each other.
      const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
      nextPlayTimeRef.current = startTime + audioBuffer.duration;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      activeSourcesRef.current.push(source);
      setIsSpeaking(true);
      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
        // Only act after the last scheduled chunk finishes
        if (nextPlayTimeRef.current <= ctx.currentTime + 0.1) {
          setIsSpeaking(false);
          // Unmute mic now: turn is done AND all audio has finished playing.
          // Waiting until here prevents the mic picking up speaker echo mid-playback.
          if (turnCompleteReceivedRef.current) {
            turnCompleteReceivedRef.current = false;
            audioMutedRef.current = false;
            nextPlayTimeRef.current = 0; // Reset scheduler now that audio is done
            if (audioMuteTimerRef.current) {
              clearTimeout(audioMuteTimerRef.current);
              audioMuteTimerRef.current = null;
            }
          }
        }
      };
      source.start(startTime);
    } catch (err) {
      console.warn("Failed to play audio response:", err);
    }
  }, []);

  // Handle incoming WebSocket messages (ADK LiveEvent format)
  // NOTE: backend sends camelCase (by_alias=True in Pydantic) so we support both
  const handleMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data !== "string") return;

    try {
      const msg = JSON.parse(event.data) as Record<string, unknown>;

      // 1. Ready signal from server
      if (msg.type === "ready") {
        updateStatus("ready");
        return;
      }

      // 2. UI events (generative UI from tools) — always have a "target" key
      if (msg.target) {
        if (msg.target === "avatar_update" && msg.companion_name) {
          setCompanionName(msg.companion_name as string);
          const matched = HEALI_VOICES.find(p => p.name === msg.companion_name);
          setAvatarB64(matched ? matched.avatar : null);
          return;
        }
        onUIEvent?.(msg as unknown as UIEvent);
        return;
      }

      // Helper: resolve snake_case OR camelCase field
      const field = <T>(snake: string, camel: string): T | undefined =>
        (msg[snake] ?? msg[camel]) as T | undefined;

      // 3. Input transcription (user's speech → text)
      // Backend sends: {"inputTranscription": {"text": "..."}}
      const inputTx = field<{ text?: string }>("input_transcription", "inputTranscription");
      if (inputTx?.text) {
        // Filter out system/timer signals and coach-paused nudges that were sent via
        // sendText({ silent: true }) — we don't want them appearing in the transcript
        // even though Gemini transcribes the TTS audio back (often without brackets).
        const t = inputTx.text.trim().toLowerCase();
        const isSystemSignal =
          inputTx.text.trim().startsWith("[") ||
          t.includes("system:") ||
          t.includes("coach paused") ||
          t.includes("do not reintroduce");
        if (!isSystemSignal) {
          addTranscript({ role: "user", text: inputTx.text, timestamp: Date.now() });
        }
      }

      // 4. Output transcription (assistant's speech → text)
      // Backend sends: {"outputTranscription": {"text": "..."}}
      const outputTx = field<{ text?: string }>("output_transcription", "outputTranscription");
      if (outputTx?.text) {
        addTranscript({ role: "assistant", text: outputTx.text, timestamp: Date.now() });
      }

      // 5. Content parts — audio chunks and/or text
      // Backend sends: {"content": {"parts": [{"inlineData": {"data": "...", "mimeType": "..."}}]}}
      const content = field<{ parts?: Record<string, unknown>[] }>("content", "content");
      if (content?.parts) {
        for (const part of content.parts) {
          // Audio: support both inline_data (snake) and inlineData (camel)
          const inlineData = (part.inline_data ?? part.inlineData) as
            | { data?: string; mime_type?: string; mimeType?: string }
            | undefined;
          if (inlineData?.data) {
            hasAudioThisTurnRef.current = true;
            playAudioResponse(
              inlineData.data,
              // gemini-live-2.5-flash-native-audio outputs audio/pcm;rate=24000
              inlineData.mime_type ?? inlineData.mimeType ?? "audio/pcm;rate=24000",
            );
          }
          // NOTE: content.parts[].text is intentionally NOT added to the transcript.
          // In Gemini Live native-audio mode, the same text arrives via both
          // outputTranscription.text (section 4 above) AND content.parts[].text,
          // causing every coach line to appear twice in the UI.
          // outputTranscription is the authoritative source for assistant speech.
        }
      }

      // 5.5 Interruption handling - if the backend explicitly warns us the turn was interrupted (barge-in)
      const isInterrupted = msg.interrupted === true;
      if (isInterrupted) {
        if (activeSourcesRef.current.length > 0) {
          activeSourcesRef.current.forEach(source => {
            try { source.stop(); } catch (e) { }
          });
          activeSourcesRef.current = [];
        }
        nextPlayTimeRef.current = 0;
        setIsSpeaking(false);
      }

      // 6. Turn complete — support both turn_complete and turnComplete
      const turnComplete = msg.turn_complete ?? msg.turnComplete;
      if (turnComplete) {
        const hadAudio = hasAudioThisTurnRef.current;
        hasAudioThisTurnRef.current = false; // reset for next turn

        // CRITICAL FIX: Do not immediately setIsSpeaking(false) or nextPlayTimeRef.current = 0.
        // If audio is still playing or scheduled, let source.onended handle the cleanup.
        const ctx = playbackContextRef.current;
        const isStillPlaying = activeSourcesRef.current.length > 0 || (ctx && nextPlayTimeRef.current > ctx.currentTime + 0.1);

        if (isStillPlaying) {
          turnCompleteReceivedRef.current = true;
          // While waiting for audio to finish, we keep isSpeaking=true so the UI remains in "assistant speaking" state.
        } else {
          setIsSpeaking(false);
          nextPlayTimeRef.current = 0;
          if (audioMutedRef.current) {
            audioMutedRef.current = false;
            if (audioMuteTimerRef.current) {
              clearTimeout(audioMuteTimerRef.current);
              audioMuteTimerRef.current = null;
            }
          }
        }
      }
    } catch (err) {
      console.warn("Failed to parse WS message:", err);
    }
  }, [addTranscript, playAudioResponse, updateStatus, onUIEvent]);

  // Start microphone and stream base64 audio
  const startMicrophone = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: AUDIO_SAMPLE_RATE,
          channelCount: AUDIO_CHANNELS,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
      audioContextRef.current = audioContext;
      // iOS/Android may suspend AudioContext immediately — resume it now
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const source = audioContext.createMediaStreamSource(stream);

      // AudioWorklet processor — inlined as Blob URL, runs in dedicated audio thread
      // (replaces deprecated ScriptProcessorNode which ran on the main UI thread)
      const WORKLET_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._buf = []; this._TARGET = 2048; }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);
    while (this._buf.length >= this._TARGET) {
      const chunk = this._buf.splice(0, this._TARGET);
      const int16 = new Int16Array(this._TARGET);
      for (let i = 0; i < this._TARGET; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
`;
      const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
      // Cast to ScriptProcessorNode so processorRef type is unchanged — disconnect() works identically
      processorRef.current = workletNode as unknown as ScriptProcessorNode;

      workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        // Drop mic frames while TTS is being processed by the backend.
        // Without this, the continuous mic stream mixes with the TTS audio,
        // causing Gemini to transcribe the TTS but return a silent turn_complete.
        if (audioMutedRef.current) return;
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          const bytes = new Uint8Array(e.data);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          ws.send(JSON.stringify({ type: "audio", data: btoa(binary) }));
        }
      };

      source.connect(workletNode);
      // AudioWorklet is only scheduled when reachable from the destination (pull-graph rule).
      // Route through a zero-gain node so process() fires without feeding mic audio to speakers.
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      workletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);
      setIsListening(true);
    } catch (err) {
      console.error("Microphone access denied:", err);
      onError?.("Microphone access denied. Please allow microphone access.");
    }
  }, [float32ToPCM16Base64, onError]);

  // Stop microphone
  const stopMicrophone = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsListening(false);
  }, []);

  // Send a text message — mutes mic until turn_complete arrives (or 15 s safety timeout).
  // Pass { silent: true } to suppress adding to transcript (for system/timer signals that
  // should not appear as "YOU" messages in the UI).
  const sendText = useCallback((text: string, options?: { silent?: boolean }) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Mute mic so simultaneous mic frames don't confuse Gemini's VAD
      audioMutedRef.current = true;
      if (audioMuteTimerRef.current) clearTimeout(audioMuteTimerRef.current);
      // Safety fallback: unmute after 15 s in case turn_complete never arrives
      audioMuteTimerRef.current = setTimeout(() => {
        audioMutedRef.current = false;
        audioMuteTimerRef.current = null;
      }, 15000);
      ws.send(JSON.stringify({ type: "text", text }));
      // Only add to transcript for real user messages, not system/timer signals
      if (!options?.silent) {
        addTranscript({ role: "user", text, timestamp: Date.now() });
      }
    }
  }, [addTranscript]);

  // Send an image (base64 JPEG) for pill verification / food logging
  const sendImage = useCallback((base64Image: string, mimeType: string = "image/jpeg") => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "image",
        data: base64Image,
        mimeType,
      }));
    }
  }, []);

  // Connect to WebSocket
  // tokenOverride: use when token is resolved async (e.g. Exercise page) to avoid race with state
  const connect = useCallback(async (tokenOverride?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    updateStatus("connecting");

    // Pre-create AudioContext during user gesture so it starts in "running" state
    // (browsers suspend AudioContext created outside user interaction)
    if (!playbackContextRef.current || playbackContextRef.current.state === "closed") {
      playbackContextRef.current = new AudioContext({ sampleRate: 24000 });
      nextPlayTimeRef.current = 0;
    }

    const authToken = tokenOverride ?? token;
    let wsUrl = `${VOICE_WS_BASE_URL}/ws/${encodeURIComponent(userId)}?token=${encodeURIComponent(authToken)}&persona=${encodeURIComponent(persona)}`;
    if (patientName) wsUrl += `&patient_name=${encodeURIComponent(patientName)}`;
    if (proactivePrompt) wsUrl += `&proactive_prompt=${encodeURIComponent(proactivePrompt)}`;
    if (exercisesCompleted != null && exercisesCompleted > 0) {
      wsUrl += `&exercises_completed=${exercisesCompleted}`;
    }
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0;
      wasConnectedRef.current = true;
      updateStatus("connected");
      startMicrophone();
    };

    ws.onmessage = handleMessage;

    ws.onerror = () => {
      updateStatus("error");
      onError?.("WebSocket connection failed. Is your FastAPI backend running at " + VOICE_WS_BASE_URL + "?");
    };

    ws.onclose = (event) => {
      stopMicrophone();
      wsRef.current = null;

      // Handle backend-initiated close codes
      if (event.code === 4401) {
        onError?.("Authentication failed: " + (event.reason || "Invalid token"));
        updateStatus("error");
      } else if (event.code === 4005) {
        // Voice settings changed by onboarding agent — auto-reconnect
        updateStatus("connecting");
        setTimeout(() => connectRef.current?.(), 500);
        return;
      } else if (!intentionalDisconnectRef.current) {
        // Unexpected disconnect (network drop, mobile screen lock, app background, etc.)
        // Auto-reconnect with exponential backoff: 500ms, 1s, 2s, 4s … up to 30s
        updateStatus("connecting");
        const delay = Math.min(500 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current += 1;
        setTimeout(() => connectRef.current?.(), delay);
      } else {
        intentionalDisconnectRef.current = false;
        updateStatus("disconnected");
      }
    };
  }, [userId, token, persona, patientName, proactivePrompt, exercisesCompleted, handleMessage, startMicrophone, stopMicrophone, updateStatus, onError]);

  // Disconnect
  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    wasConnectedRef.current = false;
    const ws = wsRef.current;
    if (ws) {
      ws.close();
    }
    wsRef.current = null;
    stopMicrophone();
    if (playbackContextRef.current && playbackContextRef.current.state !== "closed") {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    updateStatus("disconnected");
  }, [stopMicrophone, updateStatus]);

  // Clear transcript
  const clearTranscript = useCallback(() => {
    setTranscript([]);
  }, []);

  // Keep connectRef always current so event listeners never use a stale closure
  connectRef.current = connect;

  // Page visibility + network listeners for mobile resilience, plus unmount cleanup
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && wasConnectedRef.current) {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          connectRef.current?.();
        }
        // Resume any suspended AudioContexts after returning from background
        if (audioContextRef.current?.state === "suspended") {
          audioContextRef.current.resume();
        }
        if (playbackContextRef.current?.state === "suspended") {
          playbackContextRef.current.resume();
        }
      }
    };

    const handleOnline = () => {
      if (wasConnectedRef.current) {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reconnectAttemptsRef.current = 0; // fresh network — reset backoff
          connectRef.current?.();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    isListening,
    isSpeaking,
    /** Ref mirror of isSpeaking — always current inside setInterval/setTimeout callbacks. */
    isSpeakingRef,
    transcript,
    avatarB64,
    companionName,
    connect,
    disconnect,
    sendText,
    sendImage,
    clearTranscript,
  };
}
