
import {
  ComposerAddAttachment,
  ComposerAttachments,
} from "../../../ui/attachment";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ComposerTriggerPopover } from "../../../ui/composer-trigger-popover";
import { ComposerQuotePreview, SelectionToolbar } from "../../../ui/quote";

import {
  ComposerPrimitive,
  useAuiState,
  useUnstableMentionAdapter,
} from "../../../shims/assistant-ui-compat-shim";
import {
  ArrowUpIcon,
  SquareIcon,
  WrenchIcon,
} from "lucide-react";
import { LexicalComposerInput } from "@assistant-ui/react-lexical";
import { type FC, useEffect, useCallback } from "react";
import { DirectiveChip } from "./MessageComponents";
import { useGuestMode } from "@/context/GuestModeContext";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSendState } from "@/context/SendStateContext";
import { ComposerStatus } from "../../../ui/bot-activity/components/ComposerStatus";

/**
 * Discrete send-button state machine:
 *   idle      → arrow-up icon, triggers send
 *   submitting → spinner, input disabled (waiting for first chunk)
 *   streaming  → stop icon, triggers abort
 */
const ComposerAction: FC<{ disabled?: boolean }> = ({ disabled }) => {
  const { t } = useTranslation();
  const { sendState } = useSendState();
  const isRunning = useAuiState((s) => s.thread.isRunning);

  // Fallback: if the runtime says we're not running but our state is stale,
  // snap back to idle. This catches edge cases where the stream ends
  // before our bridge callback fires.
  const effectiveState = !isRunning && sendState !== "idle" ? "idle" : sendState;

  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <ComposerAddAttachment />
      <div className="composer-send-group relative flex items-center gap-1.5">

        {/* ── live status indicator: tokens + elapsed ──────────
            Shown only while submitting or streaming. Sits to the LEFT
            of the action button so the visual hierarchy reads:
            "[Attach] ........ [X tokens · Y.Ys] [Stop]". */}
        <ComposerStatus active={effectiveState !== "idle"} />

        {/* ── idle: send button ─────────────────────────────────── */}
        {effectiveState === "idle" && (
          <ComposerPrimitive.Send asChild>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="state-layer aui-composer-send inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-[#A03C3C] disabled:pointer-events-none disabled:opacity-50"
                  aria-label={t("composerSend")}
                  disabled={disabled}
                >
                  <ArrowUpIcon className="aui-composer-send-icon size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("composerSend")}</TooltipContent>
            </Tooltip>
          </ComposerPrimitive.Send>
        )}

        {/* ── submitting: loading spinner ───────────────────────── */}
        {effectiveState === "submitting" && (
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground cursor-not-allowed"
            aria-label={t("botStatus:stopping")}
          >
            <svg
              className="size-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          </button>
        )}

        {/* ── streaming: stop button ───────────────────────────── */}
        {effectiveState === "streaming" && (
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel size-10 rounded-full"
              aria-label={t("botStatus:stop")}
            >
              <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        )}

      </div>
    </div>
  );
};

export const ThreadComposer: FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { limitReached } = useGuestMode();
  const mention = useUnstableMentionAdapter({ fallbackIcon: WrenchIcon });
  const isThreadEmpty = useAuiState((s) => s.thread.isEmpty);

  const updateComposerForKeyboard = useCallback(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    // iOS Safari: keyboard doesn't always trigger resize on visualViewport
    // Fall back to window.innerHeight comparison
    let offset = 0;
    if (window.visualViewport) {
      offset = window.innerHeight - viewport.height - viewport.offsetTop;
    } else {
      // Fallback for browsers without visualViewport API
      offset = Math.max(0, window.innerHeight - document.documentElement.clientHeight);
    }
    
    // iOS: keyboard can cause viewport.height to be 0 or incorrect
    // Clamp to reasonable values
    offset = Math.max(0, Math.min(offset, window.innerHeight * 0.8));
    
    document.documentElement.style.setProperty(
      "--composer-keyboard-offset",
      `${offset}px`
    );
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    viewport.addEventListener("resize", updateComposerForKeyboard);
    viewport.addEventListener("scroll", updateComposerForKeyboard);
    updateComposerForKeyboard();

    return () => {
      viewport.removeEventListener("resize", updateComposerForKeyboard);
      viewport.removeEventListener("scroll", updateComposerForKeyboard);
      document.documentElement.style.removeProperty("--composer-keyboard-offset");
    };
  }, [updateComposerForKeyboard]);

  if (limitReached) {
    return (
      <div className="w-full rounded-3xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
        <p className="text-sm text-amber-400 mb-2">{t("guestLimitTitle")}</p>
        <button
          onClick={() => navigate("/login", { state: { from: `` } })}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t("guestLimitSignIn")}
        </button>
      </div>
    );
  }

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div
            data-slot="aui_composer-shell"
            className="flex w-full flex-col gap-2 rounded-3xl border border-[#EBE5DF] bg-white p-2.5 text-[#2C2825] shadow-sm transition-[shadow,background-color] hover:bg-[#F9F6F0] focus-within:bg-white focus-within:border-ring/75 focus-within:ring-2 focus-within:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/50"
            style={{ marginBottom: "var(--composer-keyboard-offset, 0px)" }}
          >
            <ComposerQuotePreview />
            <ComposerAttachments />
            <div dir="auto" className="contents">
              <LexicalComposerInput
                directiveChip={DirectiveChip}
                formatter={mention.directive.formatter}
                placeholder={t("composerPlaceholder")}
                submitMode="enter"
                className="aui-composer-input relative max-h-32 min-h-10 w-full resize-none bg-transparent px-1.75 py-1 text-sm outline-none [&_.aui-directive-chip-icon]:self-center [&_.aui-directive-chip]:inline-flex [&_.aui-directive-chip]:items-baseline [&_.aui-directive-chip]:gap-1 [&_.aui-directive-chip]:rounded-md [&_.aui-directive-chip]:bg-blue-100 [&_.aui-directive-chip]:px-1.5 [&_.aui-directive-chip]:py-0.5 [&_.aui-directive-chip]:font-medium [&_.aui-directive-chip]:text-[13px] [&_.aui-directive-chip]:text-blue-700 [&_.aui-directive-chip]:leading-none [&_.aui-lexical-input]:min-h-lh [&_.aui-lexical-input]:outline-none [&_.aui-lexical-placeholder]:pointer-events-none [&_.aui-lexical-placeholder]:absolute [&_.aui-lexical-placeholder]:top-0 [&_.aui-lexical-placeholder]:left-0 [&_.aui-lexical-placeholder]:px-1.75 [&_.aui-lexical-placeholder]:py-1 [&_.aui-lexical-placeholder]:text-muted-foreground/80"
              />
            </div>
            <ComposerAction disabled={limitReached} />
            <ComposerTriggerPopover
              char="@"
              directive={mention.directive}
              iconMap={mention.iconMap}
              fallbackIcon={mention.fallbackIcon}
            />
          </div>
        </ComposerPrimitive.AttachmentDropzone>
        {!isThreadEmpty && (
          <p className="disclaimer-text px-1.5 pt-1.5 text-center text-xs text-muted-foreground/60">
            {t("composerDisclaimer")}
          </p>
        )}
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
};

// Re-export SelectionToolbar for convenience (used in Thread layout)
export { SelectionToolbar };
