import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { MicIcon, Loader2Icon, SquareIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useGuestMode } from "@/context/GuestModeContext";
import { unstable_useComposerInput } from "../shims/assistant-ui-compat-shim";
import { useDictation } from "@/hooks/useDictation";
import { voiceDebugBus } from "@/lib/stt/voice-debug-bus";

interface MicButtonProps {
  className?: string;
}

interface DebugLine {
  t: number;
  kind: string;
  detail?: string;
}

const VOICE_DEBUG = new URLSearchParams(window.location.search).has("voiceDebug");

/**
 * Claude-style dictation button bound to the composer:
 *   click -> mic opens, words stream live into the text box
 *   click again (square) -> stops; text stays ready to send.
 *
 * Existing composer text is snapshotted at mic press; the live transcript is
 * appended after it. With ?voiceDebug=1 a diagnostic overlay shows the raw
 * pipeline events (frames / relay messages / composer writes).
 */
export const MicButton: FC<MicButtonProps> = ({ className }) => {
  const { t } = useTranslation("chat");
  const { isGuestMode, limitReached } = useGuestMode();
  const input = unstable_useComposerInput();
  const [debugLines, setDebugLines] = useState<DebugLine[]>([]);
  const baseRef = useRef<string>("");

  const pushDebug = useCallback((kind: string, detail?: string) => {
    voiceDebugBus.event(kind, detail);
    if (!VOICE_DEBUG) return;
    setDebugLines((prev) =>
      [...prev.slice(-9), { t: Date.now() % 100000, kind, detail }],
    );
  }, []);

  /**
   * Write text into the composer with a Lexical-safe fallback:
   * unstable_useComposerInput.setText can be a no-op while the Lexical
   * editor holds focus, so we verify and fall back to execCommand.
   */
  const applyText = useCallback(
    (text: string) => {
      const before = input?.value ?? "";
      if (text === before) return;
      input?.setText(text);
      pushDebug("composer_setText", `len=${text.length} beforeLen=${before.length}`);
      window.setTimeout(() => {
        const after = input?.value ?? "";
        if (after === before && text) {
          pushDebug("fallback_execCommand", `afterLen=${after.length}`);
          const el = document.querySelector<HTMLElement>(
            '[data-slot="aui_composer-shell"] [contenteditable="true"]',
          );
          if (el) {
            el.focus();
            document.execCommand("insertText", false, text);
          }
        }
      }, 60);
    },
    [input, pushDebug],
  );

  const onTranscript = useCallback(
    (full: string) => {
      const base = baseRef.current.trim();
      const combined =
        base && full ? base.replace(/\s+$/, "") + " " + full : full;
      applyText(combined);
    },
    [applyText],
  );

  const { status, error, start, stop } = useDictation({
    onTranscript,
    onEvent: (evt) => pushDebug(evt.kind, evt.detail),
  });

  const [seconds, setSeconds] = useState(0);
  const recording = status === "recording";
  const recordingRef = useRef(false);
  recordingRef.current = recording;

  // Snapshot composer text at the moment recording actually begins
  useEffect(() => {
    if (recording) baseRef.current = input?.value ?? "";
  }, [recording, input]);

  useEffect(() => {
    if (!recording) { setSeconds(0); return; }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  // Publish lifecycle to the debug bus
  useEffect(() => {
    voiceDebugBus.setState(status);
  }, [status]);
  useEffect(() => {
    voiceDebugBus.setMounted(true, "");
    voiceDebugBus.event("mic_mounted", "composer mic ready");
    return () => voiceDebugBus.setMounted(false, "unmounted");
  }, []);

  const hideReason =
    isGuestMode
      ? "guest_mode"
      : limitReached
        ? "limit_reached"
        : status === "disabled"
          ? "stt_disabled"
          : "";

  // Publish hide reason and show it under ?voiceDebug=1 instead of silence
  useEffect(() => {
    if (hideReason) voiceDebugBus.setMounted(false, hideReason);
  }, [hideReason]);

  if (hideReason) {
    if (VOICE_DEBUG) {
      return (
        <div
          data-testid="voice-debug-hidden"
          dir="ltr"
          className="fixed bottom-24 left-4 z-[99999] rounded-lg border border-amber-400/40 bg-black/90 p-2 font-mono text-[10px] text-amber-300"
        >
          MIC HIDDEN: {hideReason} (status={status})
        </div>
      );
    }
    return null;
  }

  const handleClick = async () => {
    if (recording || status === "stopping") {
      await stop();
      return;
    }
    if (status !== "ready") return;
    baseRef.current = input?.value ?? "";
    await start();
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            disabled={status === "starting" || status === "stopping"}
            aria-label={recording ? t("voice.stop") : t("voice.start")}
            aria-pressed={recording}
            data-testid="mic-button"
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

      {VOICE_DEBUG && (
        <div
          data-testid="voice-debug"
          dir="ltr"
          className="fixed bottom-24 left-4 z-[99999] max-h-56 w-80 overflow-y-auto rounded-lg border border-white/20 bg-black/90 p-2 font-mono text-[10px] leading-relaxed text-lime-300 shadow-2xl"
        >
          <div className="mb-1 font-bold text-white">VOICE DEBUG (state={status})</div>
          {debugLines.length === 0 && <div className="opacity-50">no events yet…</div>}
          {debugLines.map((l, i) => (
            <div key={i}>
              [{l.t}] {l.kind}
              {l.detail !== undefined && l.detail !== "" ? ` :: ${String(l.detail).substring(0, 60)}` : ""}
            </div>
          ))}
        </div>
      )}
    </>
  );
};