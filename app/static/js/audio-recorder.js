/**
 * AudioRecorder - Captures microphone audio as 16kHz 16-bit PCM
 * Uses AudioWorklet for low-latency processing.
 */
export class AudioRecorder {
  constructor(onAudioChunk) {
    this.onAudioChunk = onAudioChunk;
    this.audioContext = null;
    this.recorderNode = null;
    this.micStream = null;
    this.micSource = null;
    this.isRecording = false;
    this.isMuted = false; // true while agent is speaking (echo prevention)
  }

  async start() {
    if (this.isRecording) return;

    // 1. Get microphone access — enable echo cancellation to prevent feedback loops
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,   // Prevent speaker → mic feedback loop
        noiseSuppression: true,   // Filter background noise
        autoGainControl: true,    // Normalize volume levels
      },
    });

    // 2. Create the AudioContext entirely unconstrained.
    // Explicitly declaring { sampleRate } (even if read from the track) triggers 
    // a "WebAudio renderer" hardware crash on macOS Chrome. Let the OS pick the safest native rate.
    this.audioContext = new AudioContext();

    // Load the recorder worklet
    await this.audioContext.audioWorklet.addModule(
      "/static/js/pcm-recorder-processor.js"
    );

    // Resume context (Chrome autoplay policy blocks suspended contexts)
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    this.micSource = this.audioContext.createMediaStreamSource(this.micStream);

    this.recorderNode = new AudioWorkletNode(
      this.audioContext,
      "pcm-recorder-processor",
      {
        processorOptions: {
          inputSampleRate: this.audioContext.sampleRate,
          outputSampleRate: 16000
        }
      }
    );

    // Handle audio chunks from the worklet
    this.recorderNode.port.onmessage = (event) => {
      if (event.data.command === "audioChunk" && this.onAudioChunk) {
        // Don't forward audio when muted (agent is speaking)
        if (!this.isMuted) {
          this.onAudioChunk(event.data.data);
        }
      } else if (event.data.command === "debug") {
        console.log(`[MicWorklet] ${event.data.message}`);
      }
    };

    this.micSource.connect(this.recorderNode);

    // CRITICAL: Connect to destination so the browser's audio graph is active.
    // Without this, process() will never be called in many browsers.
    // The worklet outputs silence (doesn't write to outputs), so no sound leaks.
    this.recorderNode.connect(this.audioContext.destination);

    // Tell the worklet to start recording
    this.recorderNode.port.postMessage({ command: "start" });
    this.isRecording = true;
  }

  /**
   * Mute the microphone — stops forwarding audio chunks upstream.
   * Called when the agent starts speaking to prevent echo feedback.
   */
  mute() {
    if (this.isMuted) return;
    this.isMuted = true;
    // Also disable mic tracks at the hardware level for stronger echo prevention
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach(t => { t.enabled = false; });
    }
    console.log("[AudioRecorder] Muted (agent speaking)");
  }

  /**
   * Unmute the microphone — resumes forwarding audio chunks.
   * Called when the agent finishes speaking.
   */
  unmute() {
    if (!this.isMuted) return;
    this.isMuted = false;
    // Re-enable mic tracks
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach(t => { t.enabled = true; });
    }
    console.log("[AudioRecorder] Unmuted (listening)");
  }

  stop() {
    if (!this.isRecording) return;

    if (this.recorderNode) {
      this.recorderNode.port.postMessage({ command: "stop" });
      this.recorderNode.disconnect();
    }

    if (this.micSource) {
      this.micSource.disconnect();
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
    }

    if (this.audioContext) {
      this.audioContext.close();
    }

    this.isRecording = false;
    this.isMuted = false;
  }
}
