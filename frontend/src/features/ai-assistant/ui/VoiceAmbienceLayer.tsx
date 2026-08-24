/**
 * VoiceAmbienceLayer — STUB during voice-mode refactor.
 *
 * The original implementation tied the audio-reactive glow to the deleted
 * Deepgram Voice Agent (single WebSocket full-duplex). After removing that
 * system, the live-voice visuals live inside the new VoiceOverlay
 * (Claude/Grok-style modal) — Phase 3 of the voice-mode overhaul.
 *
 * This stub remains so any leftover imports compile. Renders nothing.
 * Will be deleted once the new overlay's orb/waveform land.
 */
import { type FC } from "react";

export const VoiceAmbienceLayer: FC = () => null;
