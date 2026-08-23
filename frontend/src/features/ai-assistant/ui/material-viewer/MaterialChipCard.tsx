/**
 * Interactive card rendered in place of `material://` markdown links inside
 * assistant replies. Clicking opens the global MaterialViewerDialog.
 */

import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { BookOpenIcon, ChevronRightIcon, Loader2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useAuiState } from "@assistant-ui/react";
import { useChatHistory } from "@/hooks/useChatHistory";
import {
  MATERIAL_LINK_PREFIX,
  type MaterialRef,
  parseMaterialHref,
} from "./material-link";
import { useMaterialViewer } from "./material-viewer-store";

/** Pull every material link out of a message's markdown text. */
function extractMaterialRefsFromContent(content: string): MaterialRef[] {
  if (!content) return [];
  const refs: MaterialRef[] = [];
  const linkRe = /\[[^\]]*\]\((material:\/\/textbook\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(content)) !== null) {
    const ref = parseMaterialHref(m[1]);
    if (ref && !refs.some((r) => r.id === ref.id)) refs.push(ref);
  }
  return refs;
}

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-500",
  ready: "bg-emerald-500",
  processing: "bg-amber-500",
  pending: "bg-amber-500 animate-pulse",
  failed: "bg-rose-500",
};

export const statusDotClass = (status?: string): string =>
  STATUS_STYLES[status || ""] || "bg-muted-foreground/50";

const MaterialChipCardImpl = ({ material }: { material: MaterialRef }) => {
  const { t } = useTranslation("materials");
  const openMaterialViewer = useMaterialViewer((s) => s.openMaterialViewer);
  const messageId = useAuiState((s) => s.message.id);
  const { activeThreadMessages } = useChatHistory();

  // Sibling cards from the same reply share one viewer session so the user
  // can flip between matched materials without closing the dialog.
  const siblings = useMemo<MaterialRef[]>(() => {
    const msg = activeThreadMessages?.find((m) => m.id === messageId);
    const refs = msg ? extractMaterialRefsFromContent(msg.content || "") : [];
    return refs.length > 0 ? refs : [material];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadMessages, messageId, material.id]);

  const startIndex = Math.max(
    siblings.findIndex((r) => r.id === material.id),
    0
  );

  const handleClick = () => openMaterialViewer(siblings, startIndex);

  const label = material.name?.replace(/\.pdf$/i, "") || t("card.unnamed");
  const isProcessing = material.status === "processing" || material.status === "pending";

  return (
    <motion.span
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="my-2 block"
    >
      <motion.button
        type="button"
        onClick={handleClick}
        whileTap={{ scale: 0.98 }}
        whileHover={{ y: -2 }}
        transition={{ type: "spring", stiffness: 400, damping: 24 }}
        className={cn(
          "group/material-card relative flex w-full max-w-md items-center gap-3 overflow-hidden",
          "rounded-xl border border-border/60 bg-card p-3 text-start shadow-sm",
          "transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-primary/50 cursor-pointer"
        )}
        dir="auto"
        aria-label={t("card.openAria", { name: label })}
      >
        {/* soft gradient wash on hover */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.07] via-transparent to-primary/[0.05] opacity-0 transition-opacity duration-300 group-hover/material-card:opacity-100"
        />
        <span className="relative flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform duration-300 group-hover/material-card:scale-105">
          <BookOpenIcon className="size-5" />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">
            {label}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {material.course && (
              <span className="max-w-[10rem] truncate rounded-full bg-muted px-1.5 py-px font-medium">
                {material.course}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className={cn("size-1.5 rounded-full", statusDotClass(material.status))} />
              {isProcessing
                ? t("card.statusProcessing")
                : material.status === "failed"
                  ? t("card.statusFailed")
                  : t("card.statusReady")}
            </span>
            {material.pages ? (
              <span className="tabular-nums">
                {t("card.pages", { count: material.pages })}
              </span>
            ) : null}
          </span>
        </span>
        {/* trailing affordance */}
        <span className="relative ms-auto hidden shrink-0 text-primary/70 transition-transform duration-300 group-hover/material-card:translate-x-0.5 sm:block rtl:group-hover/material-card:-translate-x-0.5">
          {isProcessing ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <ChevronRightIcon className="size-4 opacity-60 transition-opacity group-hover/material-card:opacity-100 rtl:rotate-180" />
          )}
        </span>
      </motion.button>
    </motion.span>
  );
};

/**
 * Public entry used by the markdown `a` override. Non-material hrefs must
 * never reach this; malformed ids render as an inert placeholder rather
 * than crashing the whole message.
 */
export const MaterialChipCard = memo(MaterialChipCardImpl);

export { MATERIAL_LINK_PREFIX };
