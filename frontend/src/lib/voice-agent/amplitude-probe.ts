/**
 * AudioAmplitudeProbe — thin wrapper around an AnalyserNode that yields a
 * normalized 0..1 loudness value for UI ambience.
 *
 * Two attach modes:
 *  - fromStream(): microphone MediaStream (capture path, never to speakers)
 *  - fromNode():   a tap on the playback graph (agent TTS) — connecting a
 *                  node into the analyser is enough; it does NOT need to be
 *                  routed to ctx.destination, so playback stays untouched.
 *
 * The probe never throws into the caller's frame loop: if Web Audio is
 * unavailable the controller falls back to CSS-only pulsing.
 */

export interface ProbeHandle {
  /** RMS of the latest time-domain frame, EMA-ready raw value in [0,1]. */
  read(): number;
  destroy(): void;
}

const FFT_SIZE = 512; // small + cheap: 256 time-domain samples per read()

function makeProbe(analyser: AnalyserNode, cleanup: () => void): ProbeHandle {
  const buf = new Uint8Array(analyser.fftSize);
  let last = 0;
  return {
    read() {
      analyser.getByteTimeDomainData(buf);
      // RMS over deviations from the midline (128) → [0,1]
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const d = (buf[i] - 128) / 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / buf.length);
      // Perceptual lift: quiet speech sits around .02–.08 raw; scale + clamp.
      const norm = Math.min(1, Math.max(0, rms * 4));
      // Tiny floor smoothing so silence reads as true rest, not noise.
      last = norm < last ? last * 0.7 : norm;
      return Math.max(last, norm);
    },
    destroy() {
      try { analyser.disconnect(); } catch { /* noop */ }
      cleanup();
    },
  };
}

/** Attach to a mic MediaStream using its own capture AudioContext. */
export function probeFromStream(ctx: AudioContext, stream: MediaStream): ProbeHandle | null {
  try {
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.5;
    src.connect(analyser); // sink only — no destination routing (no echo)
    return makeProbe(analyser, () => {
      try { src.disconnect(); } catch { /* noop */ }
    });
  } catch {
    return null;
  }
}

/** Tap an existing playback node (agent audio master gain). */
export function probeFromNode(node: AudioNode): ProbeHandle | null {
  try {
    const analyser = node.context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.5;
    node.connect(analyser);
    return makeProbe(analyser, () => { /* node owned elsewhere */ });
  } catch {
    return null;
  }
}
