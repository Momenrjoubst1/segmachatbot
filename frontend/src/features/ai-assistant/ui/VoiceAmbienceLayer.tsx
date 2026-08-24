/**
 * VoiceAmbienceLayer — decorative audio-reactive glow wrapped around the
 * composer input area. Pure markup; this component NEVER re-renders after
 * mount. The ambience controller mutates `data-voice-state`, `data-amp-live`
 * and the --voice-amp/--voice-amp-fast custom properties directly on the root
 * element; all motion/color logic lives in voice-ambience.css keyed off
 * those attributes.
 *
 * Re-wired for the post-refactor voice stack: the controller now lives at
 * `ui/voice/ambience-controller` (was `lib/voice-agent/ambience-controller`,
 * which was removed with the third voice system).
 *
 * Layers (back → front):
 *   .va-glow-gradient — soft radial wash, opacity/scale driven by amplitude
 *   .va-glow-ring     — inset ring whose blur/spread breathe with amplitude
 *
 * Place as a child of a `relative` container covering the composer shell.
 */
import { type FC, useEffect, useRef } from "react";

import { voiceAmbience } from "./voice/ambience-controller";

export const VoiceAmbienceLayer: FC = () => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    voiceAmbience.registerElement(ref.current);
    return () => voiceAmbience.registerElement(null);
  }, []);

  return (
    <div
      ref={ref}
      data-voice-state="idle"
      data-amp-live="false"
      aria-hidden="true"
      className="voice-ambience pointer-events-none absolute inset-0 -z-10 overflow-visible rounded-3xl"
    >
      <span className="va-glow-gradient" />
      <span className="va-glow-ring" />
    </div>
  );
};
