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
import { searchUserMaterials } from "../../../tools/education/find-materials/search-textbooks.js";
import { buildMaterialCardMarkdown } from "../../../tools/education/find-materials/material-card.js";
import type { MaterialMatch } from "../../../tools/education/find-materials/match-materials.js";
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

// ── Material open fast-pass ─────────────────────────────────────────────────
// "افتح مادة الفيزياء" / "show my materials" — deterministic open of a
// library textbook without waiting for the LLM. Deliberately NARROW: the
// message must be a short imperative (≤6 words) that starts with an
// open/show verb, otherwise it falls through to the normal pipeline so
// regular questions mentioning the word "مادة" are never hijacked.

export interface MaterialOpenRequest {
  /** Search query; empty string = list recent materials. */
  query: string;
}

const MATERIAL_OPEN_AR =
  /^(?:افتحلي|افتح|اعرضلي|اعرض|وريني|ورني|هاات|هات|جيب(?:\s+لي)?)\s+(?:ال)?(?:مادة|المادة|كتاب|الكتاب|ملف|الملف)\s+(?:ال)?([\u0600-\u06FF\w][\u0600-\u06FF\w\s.-]{1,60})$/;
const MATERIAL_OPEN_EN =
  /^(?:open|show(?:\s+me)?|get|bring)\s+(?:the\s+|my\s+)?(?:material|book|file|textbook)\s+([\w][\w\s.-]{1,60})$/i;
/** Bare list-my-library requests. */
const MATERIAL_LIST_RE =
  /^(?:شو\s+موادي|موادي|وين\s+موادي|وريني\s+موادي|اعرض\s+موادي|قائمتي\s+المواد|show\s+my\s+materials|my\s+materials|list\s+my\s+materials)$/i;

const MAX_FASTPASS_WORDS = 6;

/**
 * Match an explicit material-open request. Returns null unless the WHOLE
 * message is a short imperative — anything longer or more complex goes to
 * the LLM path (which can also emit material cards via find_materials).
 */
export function matchMaterialOpenRequest(rawText: string): MaterialOpenRequest | null {
  const text = rawText.trim().replace(/[.!؟?]+$/u, "").trim();
  if (!text || text.split(/\s+/).length > MAX_FASTPASS_WORDS) return null;

  if (MATERIAL_LIST_RE.test(text)) return { query: "" };

  const ar = text.match(MATERIAL_OPEN_AR);
  if (ar) return { query: ar[1].trim() };

  const en = text.match(MATERIAL_OPEN_EN);
  if (en) return { query: en[1].trim() };

  return null;
}

/**
 * Stream a canned material-card reply using the same wire protocol as the
 * response-cache-hit path (`0:"..."` deltas), and persist the exchange so
 * the cards survive thread reloads.
 */
async function streamAndPersistMaterialReply(args: {
  res: Response;
  threadId: string | undefined;
  userText: string;
  reply: string;
}): Promise<void> {
  const { res, threadId, userText, reply } = args;
  try {
    if (threadId && userText) {
      const { supabase } = await import("../../../services/rag/rag-supabase-client.js");
      await supabase.from("chat_messages").insert([{ session_id: threadId, role: "user", content: userText }]);
      await supabase.from("chat_messages").insert([{ session_id: threadId, role: "assistant", content: reply, model: "canned" }]);
    }
  } catch (err) {
    log.warn("Material fast-pass persist failed", { error: (err as Error)?.message });
  }

  res.write(`0:${JSON.stringify(reply)}\n`);
  res.end();
}

function buildMaterialListReply(matches: MaterialMatch[]): string {
  const cards = matches.map(buildMaterialCardMarkdown).join("\n");
  if (matches.length === 1) {
    return (
      `هيك هي «${matches[0].fileName.replace(/\.pdf$/i, "")}» 📚\n\n` +
      `${cards}\n\n` +
      `اضغط على البطاقة وبتنفتح المادة بتقدر تصفحها كاملة.`
    );
  }
  return (
    `لقيت ${matches.length} مواد بمكتبتك 📚\n\n` +
    `${cards}\n\n` +
    `اضغط على البطاقة اللي بدك ياها وبتنفتح لتصفحها.`
  );
}

/**
 * Try the material fast-pass. Returns true when it fully handled the
 * request (terminal). A phrasing match with zero results falls through to
 * the LLM so the user still gets a natural answer.
 */
async function runMaterialFastPass(args: {
  res: Response;
  coreMessages: CoreMessage[];
  userId: string;
  threadId?: string;
}): Promise<boolean> {
  const { res, coreMessages, userId, threadId } = args;
  const userText = extractUserText(coreMessages);
  if (!userText) return false;

  // Runs BEFORE the thread-summoner pass below: "افتح مادة X" must open a
  // material, not be mistaken for a chat-title search.
  const request = matchMaterialOpenRequest(userText);
  if (!request) return false;

  let matches;
  try {
    matches = await searchUserMaterials(userId, request.query);
  } catch (err) {
    log.warn("Material fast-pass lookup failed", { error: (err as Error)?.message });
    return false;
  }
  if (matches.length === 0) return false;

  await streamAndPersistMaterialReply({
    res,
    threadId,
    userText,
    reply: buildMaterialListReply(matches),
  });
  log.info("Material fast-pass served", {
    userId,
    query: request.query,
    matched: matches.length,
  });
  return true;
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
  threadId?: string;
}): Promise<UIFastPassResult> {
  const { res, coreMessages, userId, threadId } = args;

  // ---- Material open fast-pass (before thread summoner — see note above) ----
  try {
    const handled = await runMaterialFastPass({ res, coreMessages, userId, threadId });
    if (handled) return { injected: true, terminal: true };
  } catch (err) {
    log.warn("Material fast-pass failed", { error: (err as Error)?.message });
  }

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
