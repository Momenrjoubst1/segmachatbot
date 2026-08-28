// Injects instant UI actions (open calendar, email, jump to thread) before the LLM responds.

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
import {
  matchMaterialOpenRequest,
  type MaterialMatch,
} from "../../../tools/education/find-materials/match-materials.js";
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

// Material open fast-pass: deterministically opens a library textbook without the LLM.

// Streams a canned material-card reply using the cache-hit wire protocol and persists it.
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

// Tries the material fast-pass; returns true when it fully handled the request.
async function runMaterialFastPass(args: {
  res: Response;
  coreMessages: CoreMessage[];
  userId: string;
  threadId?: string;
}): Promise<boolean> {
  const { res, coreMessages, userId, threadId } = args;
  const userText = extractUserText(coreMessages);
  if (!userText) return false;

  // Runs before the thread-summoner pass so material requests never match chat titles.
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

  // Material open fast-pass (runs before the thread summoner)
  try {
    const handled = await runMaterialFastPass({ res, coreMessages, userId, threadId });
    if (handled) return { injected: true, terminal: true };
  } catch (err) {
    log.warn("Material fast-pass failed", { error: (err as Error)?.message });
  }

  // Calendar / Email keyword fast-passes
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

  // Thread summoner fast-pass
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
