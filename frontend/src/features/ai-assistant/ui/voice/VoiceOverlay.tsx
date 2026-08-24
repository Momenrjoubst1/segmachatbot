/**
 * VoiceOverlay — Claude/Grok-style full-screen live-voice modal.
 *
 * STUB: The full implementation (orb, live waveform, sample prompts, voice
 * persona picker, ElevenLabs Flash v2.5 streaming) lands in Phase 2/3.
 * For now this returns a no-op dialog so the build is unblocked.
 */

import { type FC, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

interface VoiceOverlayProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s2c: any;
}

export const VoiceOverlay: FC<VoiceOverlayProps> = ({ open, onOpenChange }) => {
  const { t } = useTranslation("chat");

  useEffect(() => {
    if (!open) return;
    // Trap focus inside the overlay while open (a11y nicety; a11y.spec.ts
    // covers the actual behavior).
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="voice-overlay-stub w-[min(640px,92vw)] rounded-3xl border-none bg-gradient-to-b from-neutral-50 to-white p-8 dark:from-neutral-900 dark:to-neutral-950"
        data-testid="voice-overlay"
        data-overlay-state="stub"
      >
        <DialogTitle className="text-center text-base font-medium text-neutral-600 dark:text-neutral-300">
          {t("voice.overlay_stub_title", {
            defaultValue: "Voice overlay — coming next",
          })}
        </DialogTitle>
        <p className="mt-3 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {t("voice.overlay_stub_body", {
            defaultValue:
              "The Claude/Grok-style live voice canvas (animated orb, live waveform, sample prompts, voice personas) lands in the next phase.",
          })}
        </p>
      </DialogContent>
    </Dialog>
  );
};
