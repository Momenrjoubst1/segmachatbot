// File router helpers: PDF extraction, text utilities, persistence.

import crypto from "crypto";
import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";
import { uploadR2Object, downloadR2ObjectToBuffer } from "../textbook/r2-client.js";
import type { Response } from "express";
import type { ChatMsg, PdfAttachment } from "./file-router-types.js";

const log = createLogger("file-router-helpers");

const MAX_PDF_BYTES = 500 * 1024 * 1024;
const PDF_PROCESSOR_URL = process.env.PDF_PROCESSOR_URL || "http://localhost:8000";

const R2_REF_PREFIX = (userId: string) => `r2://chat-attachments/${userId}/`;

const YES_RE = /(مادة|مواد|اكيد|أكيد|اي|أي|نعم|ايوه|أيوه|اضفه|أضفه|ضيفه|ضيفوا|ارفعه|أرفعه|ثبت|خزن|احفظه|احفظه|yes|yeah|yep|sure|add it|material)/i;
const NO_RE = /(ملف عادي|عادي|بس|لا|لأ|مش مادة|مو مادة|just.*(file|read)|regular|normal file|no\b)/i;

export function classifyAnswer(text: string): "yes" | "no" | "ambiguous" {
  const yes = YES_RE.test(text);
  const no = NO_RE.test(text);
  if (yes && !no) return "yes";
  if (no && !yes) return "no";
  if (yes && no) return "ambiguous";
  return "ambiguous";
}

export async function extractPdfAttachment(messages: ChatMsg[], userId: string): Promise<PdfAttachment | null> {
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

    if (rawData.startsWith("r2://")) {
      if (!rawData.startsWith(R2_REF_PREFIX(userId))) {
        log.warn("Rejected cross-user chat attachment reference", { userId });
        continue;
      }
      try {
        const key = rawData.slice("r2://".length);
        const bytes = await downloadR2ObjectToBuffer(key);
        if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) continue;
        if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") continue;
        return { fileName: fileName || "file.pdf", bytes, r2Key: key };
      } catch {
        continue;
      }
    }

    const b64 = rawData.includes(",") ? rawData.split(",")[1] : rawData;
    try {
      const bytes = Buffer.from(b64, "base64");
      if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) continue;
      if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") continue;
      return { fileName: fileName || "file.pdf", bytes };
    } catch {
      continue;
    }
  }
  return null;
}

export function lastUserText(messages: ChatMsg[]): string {
  const lastUser = [...messages].reverse().find((m) => m?.role === "user");
  if (!lastUser) return "";
  const parts = Array.isArray(lastUser.content) ? lastUser.content : Array.isArray(lastUser.parts) ? lastUser.parts : [];
  if (Array.isArray(parts) && parts.length > 0) {
    return parts
      .filter((p) => p?.type === "text" || !p?.type)
      .map((p) => p?.text || "")
      .join(" ")
      .trim();
  }
  return typeof lastUser.content === "string" ? lastUser.content.trim() : "";
}

export async function persistAndStreamReply(
  res: Response,
  threadId: string,
  messages: ChatMsg[],
  reply: string,
): Promise<void> {
  const userText = lastUserText(messages);
  if (userText) {
    await supabase.from("chat_messages").insert([{ session_id: threadId, role: "user", content: userText }]);
  }
  await supabase.from("chat_messages").insert([{ session_id: threadId, role: "assistant", content: reply, model: "canned" }]);

  if (!res.headersSent) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
  }
  res.write(reply);
  res.end();
}

export async function extractPdfText(bytes: Buffer): Promise<string> {
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
