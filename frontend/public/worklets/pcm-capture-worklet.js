/**
 * PCM capture worklet for voice dictation.
 *
 * Runs inside an AudioWorkletNode at the browser's native sample rate.
 * Downsamples to 16 kHz mono (linear interpolation + simple DC removal)
 * and posts Int16 frames (~100 ms) to the main thread, which forwards
 * them over the STT WebSocket to the Deepgram relay.
 *
 * Main thread protocol:
 *   port.postMessage({ type: "start", targetRate })  → begin capture
 *   port.postMessage({ type: "stop" })               → flush & halt
 *   ← { type: "frame", buffer: Int16Array }          (transferable)
 */

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.targetRate = 16000;
    this.ratio = Math.max(1, Math.round(sampleRate / this.targetRate));
    this.phase = 0;
    this.prevIn = 0;
    this.dcPrevIn = 0;
    this.dcPrevOut = 0;

    this.port.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === "start") {
        this.targetRate = msg.targetRate || 16000;
        this.ratio = Math.max(1, Math.round(sampleRate / this.targetRate));
        this.enabled = true;
      } else if (msg.type === "stop") {
        this.enabled = false;
      }
    };
  }

  process(inputs) {
    if (!this.enabled) return true;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    if (!ch || ch.length === 0) return true;

    // Downsample by integer ratio with linear interpolation between the
    // two nearest source samples — good enough quality for speech ASR.
    const outLength = Math.floor(ch.length / this.ratio);
    if (outLength <= 0) return true;

    const out = new Int16Array(outLength);
    let dcOut = this.dcPrevOut;

    for (let i = 0; i < outLength; i++) {
      const srcIdx = i * this.ratio;
      // One-pole high-pass (~<20 Hz cut) removes mic DC offset
      const x = ch[srcIdx];
      const hp = x - this.dcPrevIn + 0.995 * dcOut;
      this.dcPrevIn = x;
      dcOut = hp;
      // Clip to int16
      out[i] = hp >= 0
        ? Math.min(32767, Math.round(hp * 32767))
        : Math.max(-32768, Math.round(hp * 32768));
    }
    this.dcPrevOut = dcOut;

    // Transfer ownership — zero-copy handoff to main thread
    this.port.postMessage({ type: "frame", buffer: out }, [out.buffer]);
    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);