import { type FC, useEffect, useRef, useState } from "react";
import { MicIcon, Loader2Icon, SquareIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useGuestMode } from "@/context/GuestModeContext";
import { unstable_useComposerInput } from "../shims/assistant-ui-compat-shim";
import { useDictation } from "@/hooks/useDictation";

interface MicButtonProps {
  className?: string;
}

/**
 * Claude-style dictation button bound to the composer:
 *   click -> mic opens, words stream live into the text box
 *   click again (square) -> stops; text stays ready to send.
 *
 * Existing composer text is snapshotted at mic press and the live transcript
 * is appended after it, so users can dictate a follow-up to typed text.
 *
 * Must render inside ComposerPrimitive.Root (ThreadComposer guarantees this).
 * Hidden for guests (relay requires auth) and when backend STT is disabled.
 */
export const MicButton: FC<MicButtonProps> = ({ className }) => {
  const { t } = useTranslation("chat");
  const { isGuestMode, limitReached } = useGuestMode();
  const input = unstable_useComposerInput();
  const { status, error, start, stop } = useDictation({
    onTranscript: (full) => {
      const base = baseRef.current;
      const combined =
        base.trim() && full ? base.replace(/\s+$/, "") + " " + full : full;
      input.setText(combined);
    },
  });
  const [seconds, setSeconds] = useState(0);
  const baseRef = useRef<string>("");
  const recording = status === "recording";

  // Session seconds counter while recording
  useEffect(() => {
    if (!recording) { setSeconds(0); return; }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  if (isGuestMode || limitReached || status === "disabled") return null;

  const handleClick = async () => {
    if (recording || status === "stopping") {
      await stop();
      return;
    }
    if (status !== "ready") return;
    baseRef.current = input.value;
    await start();
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          disabled={status === "starting" || status === "stopping"}
          aria-label={recording ? t("voice.stop") : t("voice.start")}
          aria-pressed={recording}
          className={cn(
            "state-layer inline-flex size-10 items-center justify-center rounded-full p-1 transition-colors",
            "text-muted-foreground hover:text-foreground",
            recording &&
              "relative animate-pulse bg-rose-500/15 text-rose-600 hover:text-rose-600",
            (status === "starting" || status === "stopping") &&
              "cursor-wait opacity-60",
            className,
          )}
        >
          {status === "starting" || status === "stopping" ? (
            <Loader2Icon className="size-5 animate-spin stroke-[1.5px]" />
          ) : recording ? (
            <SquareIcon className="size-4 fill-current" />
          ) : (
            <MicIcon className="size-5 stroke-[1.5px]" />
          )}
          {recording && seconds > 0 && (
            <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1.5 text-[9px] font-bold text-white">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {error === "mic_denied"
          ? t("voice.micDenied")
          : recording
            ? t("voice.stop")
            : t("voice.start")}
      </TooltipContent>
    </Tooltip>
  );
};