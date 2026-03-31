/**
 * AudioPlayer - Plays 24kHz 16-bit PCM audio from Gemini Live API
 * Uses AudioWorklet with a ring buffer for smooth playback.
 * Handles AudioContext device/renderer errors with graceful degradation.
 */
const AudioContextClass = window.AudioContext || window.webkitAudioContext;

export class AudioPlayer {
  constructor() {
    this.audioContext = null;
    this.playerNode = null;
    this.isInitialized = false;
    this.onDrained = null; // callback fired when playback buffer empties
    this.onAudioError = null; // optional: (message: string) => void — e.g. show status/toast
    this._contextErrorHandler = null;
    this._contextStateHandler = null;
  }

  _teardownContextListeners() {
    if (!this.audioContext) return;
    if (this._contextErrorHandler) {
      this.audioContext.removeEventListener("error", this._contextErrorHandler);
      this._contextErrorHandler = null;
    }
    if (this._contextStateHandler) {
      this.audioContext.removeEventListener("statechange", this._contextStateHandler);
      this._contextStateHandler = null;
    }
  }

  async initialize() {
    if (this.isInitialized) return;

    if (!AudioContextClass) {
      const msg = "Web Audio API not supported in this browser.";
      console.error("[AudioPlayer]", msg);
      if (this.onAudioError) this.onAudioError(msg);
      return;
    }

    this.audioContext = new AudioContextClass();

    this._contextStateHandler = () => {
      console.log("[AudioPlayer] AudioContext state:", this.audioContext.state);
    };
    this.audioContext.addEventListener("statechange", this._contextStateHandler);

    this._contextErrorHandler = (event) => {
      console.error("[AudioPlayer] AudioContext error:", event);
      this.isInitialized = false;
      const msg =
        "Audio device or Web Audio renderer had an issue. Try checking your speaker/headphones, refreshing the page, or using another browser.";
      if (this.onAudioError) this.onAudioError(msg);
      if (this.onDrained) this.onDrained();
    };
    this.audioContext.addEventListener("error", this._contextErrorHandler);

    if (this.audioContext.state === "suspended") {
      try {
        await this.audioContext.resume();
        console.log("[AudioPlayer] Context resumed successfully");
      } catch (e) {
        console.error("[AudioPlayer] Failed to resume AudioContext:", e);
        this._teardownContextListeners();
        if (this.onAudioError) this.onAudioError("Could not start audio. Try again after a tap.");
        return;
      }
    }
    await this.audioContext.resume();

    await this.audioContext.audioWorklet.addModule(
      "/static/js/pcm-player-processor.js"
    );

    // Pass sample rates so worklet can resample 24kHz -> context rate (e.g. 48kHz)
    // and avoid sped-up playback on hardware that ignores requested 24kHz
    const outputRate = this.audioContext.sampleRate;
    this.playerNode = new AudioWorkletNode(
      this.audioContext,
      "pcm-player-processor",
      {
        processorOptions: {
          sourceSampleRate: 24000,
          outputSampleRate: outputRate,
        },
      }
    );

    this.playerNode.connect(this.audioContext.destination);

    // Listen for drain notification from worklet
    this.playerNode.port.onmessage = (event) => {
      if (event.data?.command === "drained" && this.onDrained) {
        this.onDrained();
      }
    };

    this.isInitialized = true;
    this._didPlayTestBeep = false;
    console.log(
      "[AudioPlayer] Initialized, context state:",
      this.audioContext.state,
      "sampleRate:",
      this.audioContext.sampleRate,
      "(24kHz source will be resampled in worklet)"
    );
  }

  /**
   * Optional one-time beep; disabled by default to avoid stressing the audio device
   * and triggering "AudioContext encountered an error" on some hardware.
   */
  _playTestBeepIfNeeded() {
    // Disabled: can trigger renderer crash on 48kHz hardware when mixed with PCM stream.
    return;
  }

  /**
   * Play base64-encoded PCM audio data.
   * Now async to allow context resume on tab-switch.
   * @param {string} base64Data - Base64 encoded Int16 PCM audio
   */
  async playBase64(base64Data) {
    if (!this.isInitialized) {
      console.warn("[AudioPlayer] Not initialized, skipping audio chunk");
      return;
    }

    try {
      if (this.audioContext.state === "closed") {
        console.warn("[AudioPlayer] Context closed (e.g. after renderer error), marking inactive");
        this.isInitialized = false;
        if (this.onDrained) this.onDrained();
        return;
      }
      if (this.audioContext.state === "suspended") {
        console.warn("[AudioPlayer] Context suspended, resuming...");
        try {
          await this.audioContext.resume();
        } catch (e) {
          console.error("[AudioPlayer] Resume failed:", e);
          this.isInitialized = false;
          if (this.onAudioError) this.onAudioError("Audio could not be resumed.");
          if (this.onDrained) this.onDrained();
          return;
        }
      }

      this._playTestBeepIfNeeded();

      const standardBase64 = base64Data.replace(/-/g, "+").replace(/_/g, "/");
      const binaryString = atob(standardBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const numSamples = Math.floor(bytes.length / 2);
      const safeBuffer = bytes.buffer.slice(0, numSamples * 2);
      this.playerNode.port.postMessage(safeBuffer, [safeBuffer]);
    } catch (e) {
      console.error("[AudioPlayer] playBase64 error:", e);
      this.isInitialized = false;
      if (this.onDrained) this.onDrained();
    }
  }

  /**
   * Clear the playback buffer (e.g., on interruption).
   */
  clear() {
    if (this.playerNode) {
      this.playerNode.port.postMessage({ command: "clear" });
    }
  }

  /**
   * Signal end of audio stream.
   */
  endOfAudio() {
    if (this.playerNode) {
      this.playerNode.port.postMessage({ command: "endOfAudio" });
    }
  }

  destroy() {
    this._teardownContextListeners();
    if (this.playerNode) {
      this.playerNode.disconnect();
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.isInitialized = false;
  }
}
