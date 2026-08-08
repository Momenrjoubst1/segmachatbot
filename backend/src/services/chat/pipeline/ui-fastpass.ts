/**
 * Step 10a — UI Action fast-passes
 *
 * Detects user intents that map directly to UI actions and injects them
 * into the stream BEFORE the model starts generating.  Provides instant
 * UI feedback (open calendar, open email, jump to thread) without
 * waiting for the LLM.
 */

import { Response } from "express";
import { log } from "../../../routes/chat/chat-shared.js";
import {
  injectUIActionToStream,
  panelOpenCalendar,
  panelOpenEmail,
  sidebarOpenThread,
} from "../ui-action-emitter.js";
import {
  findThreadByTitle,
  extractThreadSearchTitle,
} from "../thread-lookup.service.js";
import type { CoreMessage } from "./types.js";

const CALENDAR_KEYWORDS = [
  "open calendar", "show calendar", "افتح التقويم", "اعرض التقويم",
  "جدولي", "show my schedule", "open my schedule",
];

const EMAIL_KEYWORDS = [
  "open email", "show email", "افتح الايميل", "افتح البريد",
  "show my emails", "email history",
];

function extractUserText(coreMessages: CoreMessage[]): string {
  const lastUser = [...coreMessages].reverse().find((m) => m.role === "user");
  if (!lastUser) return "";
  if (typeof lastUser.content === "string") return lastUser.content;
  if (Array.isArray(lastUser.content)) {
    return lastUser.content
      .filter((p): p is { type: string; text?: string } => p?.type === "text")
      .map((p) => p.text ?? "")
      .join(" ");
  }
  return "";
}

export interface UIFastPassResult {
  injected: boolean;
  /** When set, the orchestrator must return early — the response was streamed. */
  terminal: boolean;
}

export async function runUIFastPasses(args: {
  res: Response;
  coreMessages: CoreMessage[];
  userId: string;
}): Promise<UIFastPassResult> {
  const { res, coreMessages, userId } = args;

  // ---- Calendar / Email keywords ----
  try {
    const text = extractUserText(coreMessages).toLowerCase();
    if (text) {
      if (CALENDAR_KEYWORDS.some((kw) => text.includes(kw))) {
        injectUIActionToStream(res, panelOpenCalendar());
      }
      if (EMAIL_KEYWORDS.some((kw) => text.includes(kw))) {
        injectUIActionToStream(res, panelOpenEmail());
      }
    }
  } catch (err) {
    log.warn("Octopus fast-pass UI action injection failed", {
      error: (err as Error)?.message,
    });
  }

  // ---- Thread summoner fast-pass ----
  try {
    const userText = extractUserText(coreMessages);
    const extracted = userText ? extractThreadSearchTitle(userText) : null;
    if (!extracted) return { injected: true, terminal: false };

    const summon = await findThreadByTitle(userId, userText);
    if (summon.found && summon.threadId) {
      res.write(
        `0:${JSON.stringify(
          `جاري الانتقال إلى شات: **${summon.matchedTitle}**... 🚀\n`,
        )}\n`,
      );
      injectUIActionToStream(res, sidebarOpenThread(summon.threadId));
      res.end();
      return { injected: true, terminal: true };
    }

    // Intent matched but no thread found — friendly fallback
    const fallback =
      `عذراً، لم أجد محادثة بعنوان "**${extracted.searchTitle}**" في سجّلك. ` +
      `جرّب البحث باسم أقرب أو ابدأ محادثة جديدة. 😊\n`;
    res.write(`0:${JSON.stringify(fallback)}\n`);
    res.end();
    return { injected: true, terminal: true };
  } catch (err) {
    log.warn("Thread summoner fast-pass failed", {
      error: (err as Error)?.message,
    });
    return { injected: false, terminal: false };
  }
}
