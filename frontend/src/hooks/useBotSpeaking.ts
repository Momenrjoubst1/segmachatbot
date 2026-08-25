/**
 * useSpeakingPlaceholder — true while the bot's TTS audio is playing.
 * Driven by the karaoke bridge (active exactly during spoken turns), so the
 * composer placeholder can flip to "Sigma is speaking…" without opening any
 * voice session from the composer itself.
 */
import { useEffect, useState } from "react";
import { voiceKaraoke } from "@/lib/tts/voice-karaoke";

export function useBotSpeaking(): boolean {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    return voiceKaraoke.subscribe(() => setSpeaking(voiceKaraoke.isActive));
  }, []);
  return speaking;
}
