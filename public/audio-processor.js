// public/audio-processor.js
// AudioWorkletProcessor for capturing 16kHz mono PCM audio

class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        // We expect the input to be downsampled by the AudioContext (sampleRate 16000)
        // AudioWorklet processes in chunks of 128 frames.
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input.length > 0) {
            const channelData = input[0]; // Mono

            // Convert Float32Array [-1.0, 1.0] to Int16Array PCM [-32768, 32767]
            const pcm16 = new Int16Array(channelData.length);
            for (let i = 0; i < channelData.length; i++) {
                let s = Math.max(-1, Math.min(1, channelData[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            // Send the PCM data back to the main thread
            this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
        }

        // Return true to keep the processor alive
        return true;
    }
}

registerProcessor("pcm-processor", PCMProcessor);
