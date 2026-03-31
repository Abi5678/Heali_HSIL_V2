/**
 * PCM Recorder AudioWorklet Processor
 * Captures microphone input at the native context rate, downsamples to 16kHz mono,
 * and outputs 16-bit PCM chunks to the main thread.
 */
class PCMRecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.isRecording = false;

    const opts = options.processorOptions || {};
    this.inputRate = opts.inputSampleRate || 16000;
    this.outputRate = opts.outputSampleRate || 16000;
    this.ratio = this.inputRate / this.outputRate;
    this.indexFloat = 0;

    this.port.onmessage = (event) => {
      if (event.data.command === "start") {
        this.isRecording = true;
      } else if (event.data.command === "stop") {
        this.isRecording = false;
        this.indexFloat = 0;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (this.isRecording && input.length > 0) {
      const channelData = input[0]; // mono
      if (!channelData || channelData.length === 0) return true;

      const outBuffer = [];
      let maxVal = 0;

      while (this.indexFloat < channelData.length) {
        const intIndex = Math.floor(this.indexFloat);
        const s = channelData[intIndex];
        const clamped = Math.max(-1, Math.min(1, s));
        if (Math.abs(clamped) > maxVal) maxVal = Math.abs(clamped);
        outBuffer.push(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
        this.indexFloat += this.ratio;
      }
      this.indexFloat -= channelData.length;

      // Debug: print max volume every 100 frames to check if mic is dead
      if (!this.frameCount) this.frameCount = 0;
      this.frameCount++;
      if (this.frameCount % 100 === 0) {
        this.port.postMessage(
          { command: "debug", message: `mic max volume: ${maxVal.toFixed(4)}` }
        );
      }

      if (outBuffer.length > 0) {
        const int16Array = new Int16Array(outBuffer);
        this.port.postMessage(
          { command: "audioChunk", data: int16Array.buffer },
          [int16Array.buffer]
        );
      }
    }

    return true; // keep processor alive
  }
}

registerProcessor("pcm-recorder-processor", PCMRecorderProcessor);
