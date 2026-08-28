// Routes attached PDFs: asks material-vs-regular, promotes to materials, or binds text to the thread.
import crypto from "crypto";
import { supabase } from "../../config/supabase.config.js";
import redis from "../../config/redis/client.js";
import { createLogger } from "../../utils/logger.js";
import { uploadR2Object, downloadR2ObjectToBuffer, deleteR2ObjectsByPrefix } from "../textbook/r2-client.js";
import { enqueueTextbookJob } from "../textbook/textbook-queue.js";
import { matchMaterialOpenRequest } from "../../tools/education/find-materials/match-materials.js";
import type { Response } from "express";
import type { ChatMsg, PendingFile, ThreadFile } from "./file-router-types.js";
import { classifyAnswer, extractPdfAttachment, lastUserText, persistAndStreamReply, extractPdfText } from "./file-router-helpers.js";

const log = createLogger("chat-file-router");

const PENDING_TTL_SECONDS = 3600;
const THREAD_FILE_TTL_SECONDS = 24 * 3600;
const MAX_THREAD_FILE_CHARS = 180_000;

const PENDING_KEY = (userId: string) => `chatfile:pending:${userId}`;
const THREAD_FILE_KEY = (threadId: string) => `chatfile:thread:${threadId}`;

export async function handleChatFileFlow(args: {
  userId: string;
  threadId: string;
  messages: ChatMsg[];
  res: Response;
}): Promise<boolean> {
  const { userId, threadId, messages, res } = args;

  const attachment = await extractPdfAttachment(messages, userId);
  const pendingRaw = await redis.get(PENDING_KEY(userId));
  const pending: PendingFile | null = pendingRaw ? JSON.parse(pendingRaw) : null;
  const userText = lastUserText(messages);

  if (attachment) {
    let r2Key: string;
    if (attachment.r2Key) {
      r2Key = attachment.r2Key;
    } else {
      if (pending) {
        await deleteR2ObjectsByPrefix(`pending/${userId}/`).catch(() => {});
      }

      r2Key = `pending/${userId}/${crypto.randomUUID()}.pdf`;
      const uploaded = await uploadR2Object(r2Key, attachment.bytes, "application/pdf");
      if (!uploaded) {
        log.warn("Failed to stage chat PDF", { userId });
        return false;
      }
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

  const answer = classifyAnswer(userText);
  if (answer === "ambiguous" || matchMaterialOpenRequest(userText)) {
    return false;
  }

  const { r2Key, fileName } = pending;
  await redis.del(PENDING_KEY(userId));

  if (answer === "yes") {
    try {
      const bytes = await downloadR2ObjectToBuffer(r2Key);
      const fileHash = crypto.createHash("sha256").update(bytes).digest("hex");

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

export async function getThreadFileContext(threadId: string | undefined): Promise<string> {
  if (!threadId) return "";
  try {
    const raw = await redis.get(THREAD_FILE_KEY(threadId));
    if (!raw) return "";
    const file: ThreadFile = JSON.parse(raw);
    const preview = file.text.substring(0, MAX_THREAD_FILE_CHARS);
    return `\n\n[ATTACHED FILE CONTEXT — "${file.fileName}" (this thread only)]\n` + preview;
  } catch {
    return "";
  }
}
