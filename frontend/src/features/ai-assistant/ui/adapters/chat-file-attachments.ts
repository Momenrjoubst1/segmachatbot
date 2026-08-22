/**
 * Chat composer attachment adapters.
 *
 * Replaces the assistant-ui default `vercelAttachmentAdapter`, which read the
 * entire file into a base64 data URL on send — for a ~300MB file that meant
 * ~1.5–2 GB of transient renderer memory (read buffer + base64 string +
 * JSON stringify/parse copies) and an "Aw, Snap! Out of Memory" tab crash
 * before any request reached the backend.
 *
 * Strategy:
 *  - Images    → inline data URL (unchanged; downscale keeps them small).
 *  - Video/audio/documents → streamed to POST /api/chat/attachments while the
 *                user is still composing (progress surfaced via
 *                AsyncGenerator yields); the message carries only an `r2://`
 *                reference. The backend routes media to models that can ingest
 *                it and extracts text from documents.
 *  - Text/code → inlined as text, capped so it can never blow up the payload.
 */
import type {
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
} from "@assistant-ui/react";
import { generateId } from "@assistant-ui/react";
import { toast } from "sonner";
import i18n from "@/i18n/i18next";
import { deleteChatAttachment, uploadChatAttachment } from "@/lib/chatAttachmentUpload";

/** Files above this are rejected instead of read into memory as text. */
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

/** Accept string shared by every non-image adapter (mirrors ACCEPTED_FILE_TYPES). */
const TEXT_ACCEPT =
  "text/plain,text/markdown,text/csv,text/html,text/xml,text/css,application/json," +
  "text/javascript,application/javascript,text/typescript,application/typescript," +
  "text/x-python,.txt,.md,.csv,.html,.xml,.css,.json,.js,.ts,.py";

/** Everything that must be uploaded rather than inlined. */
export const UPLOAD_ACCEPT =
  "video/*,audio/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx," +
  "application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation";

// ── video / audio / documents → R2 reference ────────────────────────────────

export function createUploadAttachmentAdapter(options: { enabled: boolean }): AttachmentAdapter {
  // Upload results by attachment id, filled during add() and consumed on send().
  const uploads = new Map<string, { r2Key: string }>();

  return {
    accept: UPLOAD_ACCEPT,

    async *add({ file }: { file: File }) {
      const attachment: PendingAttachment = {
        id: generateId(),
        type: file.type.startsWith("video/") || file.type.startsWith("audio/") ? "file" : "document",
        name: file.name,
        contentType: file.type || "application/octet-stream",
        file,
        status: { type: "requires-action", reason: "composer-send" },
      };
      yield attachment;

      if (!options.enabled) {
        toast.error(i18n.t("chat.attachment.signinRequired"));
        throw new Error("Sign-in required for file attachments");
      }

      const controller = new AbortController();
      try {
        const progressQueue: number[] = [];
        let notify: (() => void) | null = null;
        let settled = false;

        const uploadPromise = uploadChatAttachment(file, (fraction) => {
          progressQueue.push(fraction);
          notify?.();
        }, controller.signal)
          .then((uploaded) => {
            uploads.set(attachment.id, uploaded);
          })
          .finally(() => {
            settled = true;
            notify?.();
          });
        // If the composer cancels the add mid-upload the generator unwinds
        // without ever reaching the await below — swallow the rejection there.
        uploadPromise.catch(() => {});

        // Surface upload progress to the runtime between yields.
        while (!settled || progressQueue.length > 0) {
          const fraction = progressQueue.shift();
          if (fraction === undefined) {
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
            continue;
          }
          yield {
            ...attachment,
            status: { type: "running", reason: "uploading", progress: fraction },
          };
        }
        await uploadPromise;
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        toast.error(i18n.t("chat.attachment.uploadFailed"), {
          description: (err as Error).message,
        });
        throw err;
      } finally {
        // No-op once finished; stops wasted bandwidth when the attachment
        // is removed mid-upload.
        controller.abort();
      }

      yield {
        ...attachment,
        status: { type: "requires-action", reason: "composer-send" },
      };
    },

    async send(attachment) {
      let r2Key = uploads.get(attachment.id)?.r2Key;
      if (!r2Key) {
        // add() never completed (page kept open, send forced) — upload now.
        const uploaded = await uploadChatAttachment(attachment.file);
        uploads.set(attachment.id, uploaded);
        r2Key = uploaded.r2Key;
      }
      const complete: CompleteAttachment = {
        ...attachment,
        status: { type: "complete" },
        content: [
          {
            type: "file",
            mimeType: attachment.contentType || "application/octet-stream",
            filename: attachment.name,
            data: `r2://${r2Key}`,
            sourceType: "id",
          },
        ],
      };
      return complete;
    },

    async remove(attachment) {
      const uploaded = uploads.get(attachment.id);
      if (uploaded) {
        uploads.delete(attachment.id);
        void deleteChatAttachment(uploaded.r2Key);
      }
    },
  };
}

// ── small text/code files → inline text part ───────────────────────────────

export function createTextSnippetAdapter(): AttachmentAdapter {
  return {
    accept: TEXT_ACCEPT,

    async add({ file }: { file: File }) {
      if (file.size > MAX_TEXT_FILE_BYTES) {
        toast.error(i18n.t("chat.attachment.textTooLarge", { maxMb: MAX_TEXT_FILE_BYTES / (1024 * 1024) }));
        throw new Error(`Text files must be under ${MAX_TEXT_FILE_BYTES / (1024 * 1024)}MB`);
      }
      return {
        id: generateId(),
        type: "document",
        name: file.name,
        contentType: file.type,
        file,
        status: { type: "requires-action", reason: "composer-send" },
      };
    },

    async send(attachment) {
      return {
        ...attachment,
        status: { type: "complete" },
        content: [
          {
            type: "text",
            text: `<attachment name=${attachment.name}>\n${await attachment.file.text()}\n</attachment>`,
          },
        ],
      };
    },

    async remove() {},
  };
}
