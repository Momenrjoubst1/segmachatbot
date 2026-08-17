/**
 * Chat file router — the "material vs regular file" flow.
 *
 * When a user attaches a PDF in the chat composer:
 *   1. First PDF  → bot asks: add as study material (pipeline + sidebar)
 *      or treat as a regular chat-only file?
 *   2. "Yes" answer → the textbook pipeline starts (progress happens in the
 *      background; the worker posts a "ready" message back into this thread)
 *      and a course entry is created so it shows in the sidebar.
 *   3. "No" answer → the PDF text is extracted once and kept as thread-scoped
 *      context (Redis, 24h) — usable only in this chat, like other bots.
 *
 * All three intercept the pipeline and stream a canned bot reply directly
 * (same plain-text protocol as the response-cache-hit path).
 */
import crypto from "crypto";
import { supabase } from "../../config/supabase.config.js";
import redis from "../../config/redis/client.js";
import { createLogger } from "../../utils/logger.js";
import { uploadR2Object, downloadR2ObjectToBuffer, deleteR2ObjectsByPrefix } from "../textbook/r2-client.js";
import { enqueueTextbookJob } from "../textbook/textbook-queue.js";
import type { Response } from "express";

const log = createLogger("chat-file-router");

const PENDING_TTL_SECONDS = 3600; // decision window: 1 hour
const THREAD_FILE_TTL_SECONDS = 24 * 3600;
const MAX_PDF_BYTES = 500 * 1024 * 1024;
const MAX_THREAD_FILE_CHARS = 180_000;

const PENDING_KEY = (userId: string) => `chatfile:pending:${userId}`;
const THREAD_FILE_KEY = (threadId: string) => `chatfile:thread:${threadId}`;

const PDF_PROCESSOR_URL = process.env.PDF_PROCESSOR_URL || "http://localhost:8000";

interface PendingFile {
  r2Key: string;
  fileName: string;
  createdAt: number;
}

interface ThreadFile {
  fileName: string;
  text: string;
}

// ── answer classification (bilingual) ───────────────────────────────────────

const YES_RE = /(مادة|مواد|اكيد|أكيد|اي|أي|نعم|ايوه|أيوه|اضفه|أضفه|ضيفه|ضيفوا|ارفعه|أرفعه|ثبت|خزن|احفظه|احفظه|yes|yeah|yep|sure|add it|material)/i;
const NO_RE = /(ملف عادي|عادي|بس|لا|لأ|مش مادة|مو مادة|just.*(file|read)|regular|normal file|no\b)/i;

function classifyAnswer(text: string): "yes" | "no" | "ambiguous" {
  const yes = YES_RE.test(text);
  const no = NO_RE.test(text);
  if (yes && !no) return "yes";
  if (no && !yes) return "no";
  if (yes && no) return "ambiguous";
  return "ambiguous";
}

// ── attachment extraction ───────────────────────────────────────────────────

interface PdfAttachment {
  fileName: string;
  bytes: Buffer;
}

function extractPdfAttachment(messages: any[]): PdfAttachment | null {
  const lastUser = [...messages].reverse().find((m) => m?.role === "user");
  if (!lastUser) return null;

  const parts = Array.isArray(lastUser.content)
    ? lastUser.content
    : Array.isArray(lastUser.parts)
      ? lastUser.parts
      : [];
  if (!Array.isArray(parts) || parts.length === 0) return null;

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const mimeType: string =
      part.mimeType || part.mediaType || part.file?.type || part.file?.mimeType || "";
    const fileName: string = part.filename || part.fileName || part.file?.name || "";
    const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
    if (!isPdf) continue;

    const rawData: string =
      part.data || part.url || part.base64 || part.file?.data || part.file?.url || part.file?.base64 || "";
    if (!rawData || typeof rawData !== "string") continue;

    const b64 = rawData.includes(",") ? rawData.split(",")[1] : rawData;
    try {
      const bytes = Buffer.from(b64, "base64");
      if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) continue;
      if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") continue; // sniff magic
      return { fileName: fileName || "file.pdf", bytes };
    } catch {
      continue;
    }
  }
  return null;
}

function lastUserText(messages: any[]): string {
  const lastUser = [...messages].reverse().find((m) => m?.role === "user");
  if (!lastUser) return "";
  const parts = Array.isArray(lastUser.content) ? lastUser.content : Array.isArray(lastUser.parts) ? lastUser.parts : [];
  if (Array.isArray(parts) && parts.length > 0) {
    return parts
      .filter((p: any) => p?.type === "text" || !p?.type)
      .map((p: any) => p?.text || "")
      .join(" ")
      .trim();
  }
  return typeof lastUser.content === "string" ? lastUser.content.trim() : "";
}

// ── canned reply streaming (same wire format as the cache-hit path) ────────

async function persistAndStreamReply(
  res: Response,
  threadId: string,
  messages: any[],
  reply: string
): Promise<void> {
  // persist the exchange so it survives thread switches
  const userText = lastUserText(messages);
  if (userText) {
    await supabase.from("chat_messages").insert([{ session_id: threadId, role: "user", content: userText }]);
  }
  await supabase.from("chat_messages").insert([{ session_id: threadId, role: "assistant", content: reply }]);

  if (!res.headersSent) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
  }
  res.write(reply);
  res.end();
}

// ── regular-file text extraction (thread-scoped) ───────────────────────────

async function extractPdfText(bytes: Buffer): Promise<string> {
  const os = await import("os");
  const path = await import("path");
  const fs = await import("fs/promises");

  const tmpPath = path.join(os.tmpdir(), `chatfile_${crypto.randomBytes(8).toString("hex")}.pdf`);
  await fs.writeFile(tmpPath, bytes);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.PDF_PROCESSOR_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.PDF_PROCESSOR_TOKEN}`;
    }
    const r = await fetch(`${PDF_PROCESSOR_URL}/extract-text`, {
      method: "POST",
      headers,
      body: JSON.stringify({ pdf_path: tmpPath }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) {
      throw new Error(`extract-text failed (${r.status})`);
    }
    const data = (await r.json()) as { text: string };
    return data.text || "";
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

// ── main router ────────────────────────────────────────────────────────────

export async function handleChatFileFlow(args: {
  userId: string;
  threadId: string;
  messages: any[];
  res: Response;
}): Promise<boolean> {
  const { userId, threadId, messages, res } = args;

  const attachment = extractPdfAttachment(messages);
  const pendingRaw = await redis.get(PENDING_KEY(userId));
  const pending: PendingFile | null = pendingRaw ? JSON.parse(pendingRaw) : null;
  const userText = lastUserText(messages);

  // ── case 1: new PDF attached — supersedes any stale pending decision ──
  if (attachment) {
    // a fresh upload supersedes any stale pending file
    if (pending) {
      await deleteR2ObjectsByPrefix(`pending/${userId}/`).catch(() => {});
    }

    const r2Key = `pending/${userId}/${crypto.randomUUID()}.pdf`;
    const uploaded = await uploadR2Object(r2Key, attachment.bytes, "application/pdf");
    if (!uploaded) {
      log.warn("Failed to stage chat PDF", { userId });
      return false; // fall through to normal chat (bot can't decide flow)
    }

    const next: PendingFile = { r2Key, fileName: attachment.fileName, createdAt: Date.now() };
    await redis.set(PENDING_KEY(userId), JSON.stringify(next), "EX", PENDING_TTL_SECONDS);

    await persistAndStreamReply(
      res,
      threadId,
      messages,
      `وصلني الملف «${attachment.fileName}» 📄\n\n` +
        `قبل ما أكمل — بدك فيني أعمل فيه؟\n\n` +
        `1️⃣ **مادة دراسية**: رح أتعلمها بعمق (دروسها، رسماتها، مصطلحاتها) وبتظهر بالقايمة الجانبية كمادة — والمعالجة بتاخد شوية دقايق، وببلغك هون أول ما تخلص.\n` +
        `2️⃣ **ملف عادي**: أقرأه وأجاوبك منه بهالمحادثة بس — بدون معالجة، جاهز فوراً.\n\n` +
        `جاوبني بكلمة: «مادة» أو «ملف عادي»`
    );
    log.info("Chat PDF staged, asked user for decision", { userId, fileName: attachment.fileName });
    return true;
  }

  if (!pending) return false;

  // ── case 2: user answered — route by decision ──
  const answer = classifyAnswer(userText);
  if (answer === "ambiguous") {
    // not a clear yes/no — let the normal pipeline handle the message;
    // the pending decision stays alive until TTL
    return false;
  }

  const { r2Key, fileName } = pending;
  await redis.del(PENDING_KEY(userId));

  if (answer === "yes") {
    // ── material path: create course + textbook row + enqueue ──
    try {
      const bytes = await downloadR2ObjectToBuffer(r2Key);
      const fileHash = crypto.createHash("sha256").update(bytes).digest("hex");

      // sidebar entry: a course named after the file
      const courseName = fileName.replace(/\.pdf$/i, "").substring(0, 80) || "مادة جديدة";
      const { data: course } = await supabase
        .from("student_courses")
        .insert({ user_id: userId, course_name: courseName, credit_hours: 0 })
        .select("id")
        .single();

      const { data: textbook, error: tbError } = await supabase
        .from("textbooks")
        .insert({
          user_id: userId,
          course_id: course?.id || null,
          file_name: fileName,
          file_url: `r2://${r2Key}`,
          file_hash: fileHash,
          file_size_bytes: bytes.length,
          status: "pending",
          source_thread_id: threadId,
        })
        .select("id")
        .single();

      if (tbError || !textbook) throw new Error(tbError?.message || "insert failed");

      await enqueueTextbookJob({
        textbookId: textbook.id,
        fileUrl: `r2://${r2Key}`,
        userId,
        fileHash,
      });

      await persistAndStreamReply(
        res,
        threadId,
        messages,
        `تم ✅ رفعت «${fileName}» كمادة وبلشت المعالجة (استخراج، فهم الدروس والرسمات، فهرسة).\n\n` +
          `مش لازم تستنى — تقدر تكمل تحكي معي عادي، وببعثلك رسالة هون أول ما المادة تصير جاهزة 📚`
      );
      log.info("Chat PDF promoted to material", { userId, textbookId: textbook.id });
      return true;
    } catch (err) {
      log.error("Material promotion failed", { error: (err as Error).message });
      await persistAndStreamReply(
        res,
        threadId,
        messages,
        `صار في مشكلة برفع «${fileName}» كمادة 😕 جرّب ترفعه مرة تانية، أو قلي «ملف عادي» وبعامله بالمحادثة بس.`
      );
      return true;
    }
  }

  // ── answer === "no": regular thread-scoped file ──
  try {
    const bytes = await downloadR2ObjectToBuffer(r2Key);
    let text = "";
    try {
      text = await extractPdfText(bytes);
    } catch (err) {
      log.warn("Regular-file extraction failed", { error: (err as Error).message });
    }
    await deleteR2ObjectsByPrefix(`pending/${userId}/`).catch(() => {});

    if (!text || text.trim().length < 30) {
      await persistAndStreamReply(
        res,
        threadId,
        messages,
        `ما قدرت أقرأ نص من «${fileName}» (ممكن يكون سكان بدون طبقة نص، أو تالف). تقدر ترفعه كـ PDF رقمي وتجرب جديد، أو اسألني عن أي شي تاني.`
      );
      return true;
    }

    const threadFile: ThreadFile = { fileName, text: text.substring(0, MAX_THREAD_FILE_CHARS) };
    await redis.set(THREAD_FILE_KEY(threadId), JSON.stringify(threadFile), "EX", THREAD_FILE_TTL_SECONDS);

    await persistAndStreamReply(
      res,
      threadId,
      messages,
      `تمام 👍 رح أعامل «${fileName}» كملف عادي — قرأته وجاهز.\n\n` +
        `اسألني عن أي شي فيه بهالمحادثة. (الملف بضل معي هون بس — بمحادثة جديدة لازم ترفعه من جديد)`
    );
    log.info("Chat PDF bound to thread as regular file", { userId, threadId, chars: text.length });
    return true;
  } catch (err) {
    log.error("Regular-file path failed", { error: (err as Error).message });
    return false;
  }
}

/** Thread-scoped regular-file context, injected into the system prompt. */
export async function getThreadFileContext(threadId: string | undefined): Promise<string> {
  if (!threadId) return "";
  try {
    const raw = await redis.get(THREAD_FILE_KEY(threadId));
    if (!raw) return "";
    const file: ThreadFile = JSON.parse(raw);
    const preview = file.text.substring(0, MAX_THREAD_FILE_CHARS);
    return (
      `\n\n[ATTACHED FILE CONTEXT — "${file.fileName}" (this thread only)]\n` +
      preview
    );
  } catch {
    return "";
  }
}
