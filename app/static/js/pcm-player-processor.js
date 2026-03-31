/**
 * PCM Player AudioWorklet Processor
 * Plays 16-bit PCM at 24kHz from Gemini Live API. Resamples 24kHz -> hardware rate
 * (e.g. 48kHz) with linear interpolation so the Web Audio renderer is never fed
 * a rate mismatch—avoiding "AudioContext encountered an error" on 48kHz hardware.
 */
class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.sourceSampleRate = opts.sourceSampleRate || 24000;
    this.outputSampleRate = opts.outputSampleRate || 48000;
    // For each output sample we consume (sourceRate / outputRate) input samples.
    // 24k -> 48k: 0.5 input per output (2 output samples per 1 input = upsampling).
    this.readRatio = this.sourceSampleRate / this.outputSampleRate;

    // Ring buffer: 180 seconds at source rate (24kHz)
    this.bufferSize = this.sourceSampleRate * 180;
    this.buffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.readIndexFloat = 0;

    this.port.onmessage = (event) => {
      if (event.data && event.data.command === "endOfAudio") {
        return;
      }
      if (event.data && event.data.command === "clear") {
        this.readIndexFloat = this.writeIndex;
        return;
      }

      const buf = event.data;
      if (!(buf instanceof ArrayBuffer) || buf.byteLength < 2) return;
      const int16Samples = new Int16Array(buf);
      this._enqueue(int16Samples);
    };
  }

  _enqueue(int16Samples) {
    for (let i = 0; i < int16Samples.length; i++) {
      this.buffer[this.writeIndex] = int16Samples[i] / 32768.0;
      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }
  }

  _readSample(indexFloat) {
    const i0 = Math.floor(indexFloat) % this.bufferSize;
    const i1 = (i0 + 1) % this.bufferSize;
    const frac = indexFloat - Math.floor(indexFloat);
    return this.buffer[i0] * (1 - frac) + this.buffer[i1] * frac;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const frames = output[0].length;

    let dist = this.writeIndex - this.readIndexFloat;
    if (dist < 0) dist += this.bufferSize;
    const hadData = dist >= this.readRatio;

    for (let i = 0; i < frames; i++) {
      let sample = 0;
      dist = this.writeIndex - this.readIndexFloat;
      if (dist < 0) dist += this.bufferSize;

      if (dist >= this.readRatio) {
        sample = this._readSample(this.readIndexFloat);
        this.readIndexFloat += this.readRatio;
        if (this.readIndexFloat >= this.bufferSize) this.readIndexFloat -= this.bufferSize;
      }
      for (let ch = 0; ch < output.length; ch++) {
        output[ch][i] = sample;
      }
    }

    dist = this.writeIndex - this.readIndexFloat;
    if (dist < 0) dist += this.bufferSize;
    const isDrained = dist < this.readRatio;

    if (hadData && isDrained) {
      this.port.postMessage({ command: "drained" });
    }

    return true;
  }
}

registerProcessor("pcm-player-processor", PCMPlayerProcessor);
