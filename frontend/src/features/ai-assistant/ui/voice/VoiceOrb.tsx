/**
 * VoiceOrb — the animated gradient sphere at the center of the overlay.
 *
 * Pure presentation: reads --voice-amp from the nearest .voice-overlay
 * ancestor (written per rAF by the ambience controller) and reacts to
 * [data-state] set by VoiceOverlay. All motion lives in CSS; this
 * component never re-renders after mount.
 */

import { type FC } from "react";

export const VoiceOrb: FC = () => (
  <div className="vo-orb" aria-hidden="true">
    <span className="vo-orb-ring" />
    <span className="vo-orb-core" />
    <span className="vo-orb-highlight" />
  </div>
);
