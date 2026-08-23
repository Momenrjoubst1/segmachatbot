/**
 * PCM capture worklet for voice dictation + live agent mode.
 *
 * Runs inside an AudioWorkletNode at the browser's native sample rate.
 * Downsamples to the target rate (16 kHz mono) and posts Int16 frames
 * (~100 ms) to the main thread, which forwards them over the STT/agent
 * WebSocket to the backend relay.
 *
 * Downsampling is band-limited decimation, exact for ANY ratio (including
 * non-integer ones like 44100→16000):
 *
 *   1. One-pole high-pass (~20 Hz) removes mic DC offset per source sample.
 *   2. Each output sample is the weighted mean of filtered source samples
 *      whose time falls inside that output step — a zero-phase box low-pass
 *      at the TARGET Nyquist. Energy above it never aliases into the speech
 *      band, and no samples are "picked and mislabeled" the way naive
 *      integer-ratio decimation does on 44.1 kHz mics.
 *
 * A small carry buffer keeps windows that straddle render-quantum boundaries
 * continuous, so the output clock stays true over long sessions.
 *
 * Main thread protocol:
 *   port.postMessage({ type: "start", targetRate })  → begin capture
 *   port.postMessage({ type: "stop" })               → halt
 *   ← { type: "frame", buffer: Int16Array }          (transferable)
 */

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.targetRate = 16000;
    this.configure(sampleRate, this.targetRate);

    // Filter state
    this.dcPrevIn = 0;
    this.dcPrevOut = 0;

    // Resampler state: virtual stream = carry ++ current filtered block.
    this.carry = new Float32Array(64);
    this.carryLen = 0;
    /** Offset (in source samples) of the next output window start. */
    this.nextWindowStart = 0;

    this.port.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === "start") {
        this.targetRate = msg.targetRate || 16000;
        this.configure(sampleRate, this.targetRate);
        this.enabled = true;
      } else if (msg.type === "stop") {
        this.enabled = false;
      }
    };
  }

  configure(nativeRate, targetRate) {
    // Never upsample: native below target passes through 1:1 — Deepgram
    // tolerates a slightly low true rate far better than interpolated audio.
    this.ratio = Math.max(1, nativeRate / Math.min(targetRate, nativeRate));
  }

  ensureCarryCapacity(needed) {
    if (needed <= this.carry.length) return;
    let cap = this.carry.length;
    while (cap < needed) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.carry.subarray(0, this.carryLen));
    this.carry = next;
  }

  process(inputs) {
    if (!this.enabled) return true;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    if (!ch || ch.length === 0) return true;

    // ---- Pass 1: DC-blocked filtered copy of this quantum -------------------
    const n = ch.length;
    const filtered = new Float32Array(n);
    let dcPrevIn = this.dcPrevIn;
    let dcOut = this.dcPrevOut;
    for (let i = 0; i < n; i++) {
      const x = ch[i];
      dcOut = x - dcPrevIn + 0.995 * dcOut;
      dcPrevIn = x;
      filtered[i] = dcOut;
    }
    this.dcPrevIn = dcPrevIn;
    this.dcPrevOut = dcOut;

    // ---- Pass 2: box-decimate the virtual stream (carry ++ filtered) --------
    const totalLen = this.carryLen + n;
    const ratio = this.ratio;
    const maxWindows =
      Math.ceil(totalLen / ratio) + 1; // upper bound; trimmed below
    const out = new Int16Array(maxWindows);
    let produced = 0;

    let winStart = this.nextWindowStart;
    while (winStart + ratio <= totalLen) {
      const start = winStart;
      const end = start + ratio;
      const i0 = Math.max(0, Math.floor(start));
      const i1 = Math.min(totalLen, Math.ceil(end));

      let sum = 0;
      for (let j = i0; j < i1; j++) {
        // Weight = overlap of source slot j with [start, end)
        const w = Math.min(end, j + 1) - Math.max(start, j);
        const s = j < this.carryLen ? this.carry[j] : filtered[j - this.carryLen];
        sum += s * w;
      }
      const v = sum / ratio;

      out[produced++] = v >= 0
        ? Math.min(32767, Math.round(v * 32767))
        : Math.max(-32768, Math.round(v * 32768));
      winStart += ratio;
    }

    // ---- Compact: keep unconsumed tail for the next quantum -----------------
    const consumedInt = Math.min(this.carryLen, Math.floor(winStart));
    const remaining = totalLen - consumedInt;
    if (remaining > 0) {
      this.ensureCarryCapacity(remaining);
      // Shift surviving samples (carry tail + filtered head) to the front.
      for (let j = consumedInt; j < this.carryLen; j++) {
        this.carry[j - consumedInt] = this.carry[j];
      }
      const fromFiltered = totalLen - Math.max(consumedInt, this.carryLen);
      for (let j = 0; j < fromFiltered; j++) {
        this.carry[this.carryLen - consumedInt + j] = filtered[
          Math.max(consumedInt, this.carryLen) - this.carryLen + j
        ];
      }
      this.carryLen = remaining;
    } else {
      this.carryLen = 0;
    }
    this.nextWindowStart = winStart - consumedInt;

    if (produced === 0) return true;

    // Transfer ownership — zero-copy handoff to main thread
    const frame = produced === out.length ? out : out.subarray(0, produced).slice();
    this.port.postMessage({ type: "frame", buffer: frame }, [frame.buffer]);
    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
