/**
 * LiveWaveform — Canvas-free waveform bars driven by mic amplitude.
 *
 * Renders N vertical bars whose heights track a rolling window of recent
 * amplitude samples. The parent writes --voice-amp per rAF tick; this
 * component maintains its own rAF to distribute that amplitude across
 * bars with a slight phase offset, giving the classic "wave" look.
 *
 * No React re-render per frame: heights are set imperatively via refs.
 */

import { type FC, useEffect, useRef } from "react";

const BAR_COUNT = 24;
/** Per-bar phase offsets create a travelling wave. */
const PHASES = Array.from(
  { length: BAR_COUNT },
  (_, i) => Math.abs(Math.sin((i / BAR_COUNT) * Math.PI)),
);

export const LiveWaveform: FC<{ active: boolean }> = ({ active }) => {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    if (!active) {
      // Collapse all bars when inactive.
      for (const el of barsRef.current) {
        if (el) el.style.setProperty("--bar-amp", "0");
      }
      return;
    }
    let raf = 0;
    let t = 0;
    const frame = () => {
      t += 1;
      // Read the smoothed amplitude from the overlay root.
      const root = document.querySelector<HTMLElement>(".voice-overlay");
      const amp = Number(root?.style.getPropertyValue("--voice-amp") ?? 0);
      for (let i = 0; i < BAR_COUNT; i++) {
        const el = barsRef.current[i];
        if (!el) continue;
        const phase = PHASES[i] ?? 1;
        // Combine global amp + per-bar wave for a lively shape.
        const value = Math.min(1, amp * (0.55 + phase * 0.75));
        el.style.setProperty("--bar-amp", value.toFixed(3));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div className="vo-waveform" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <span
          key={i}
          ref={(el) => { barsRef.current[i] = el; }}
          className="vo-waveform-bar"
        />
      ))}
    </div>
  );
};
