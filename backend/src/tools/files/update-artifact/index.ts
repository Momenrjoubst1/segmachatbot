import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { updateArtifact, getArtifact } from "../create-artifact/artifact-store.js";

/**
 * Apply sequential find/replace edits against the current content.
 * Exported pure so the tool logic is unit-testable without a DB.
 *
 * Every `find` must exist exactly once unless `replace_all` is set —
 * ambiguity silently corrupting unrelated sections is worse than failing.
 */
export function applyReplacements(
  content: string,
  edits: Array<{ find: string; replace: string; replace_all?: boolean; occurrence?: number }>,
): { content: string; applied: number } {
  let result = content;
  let applied = 0;

  for (const edit of edits) {
    const occurrences = result.split(edit.find).length - 1;
    if (occurrences === 0) {
      throw new Error(
        `لم يتم العثور على النص المطلوب استبداله: "${truncate(edit.find, 80)}". اقرأ أرتفاكت الحالي (route GET /api/artifacts/:id أو اطلب من المستخدم عرض الكود) وحاول مجددًا بنص مطابق تمامًا.`,
      );
    }
    if (edit.replace_all || edit.occurrence === undefined) {
      result = edit.replace_all
        ? result.split(edit.find).join(edit.replace)
        : result.replace(edit.find, edit.replace);
    } else {
      const idx = indexOfOccurrence(result, edit.find, edit.occurrence);
      if (idx === -1) {
        throw new Error(`الحدوث رقم ${edit.occurrence} غير موجود للنص: "${truncate(edit.find, 80)}".`);
      }
      result = result.slice(0, idx) + edit.replace + result.slice(idx + edit.find.length);
    }
    applied++;
  }

  return { content: result, applied };
}

function indexOfOccurrence(haystack: string, needle: string, occurrence: number): number {
  let idx = -1;
  for (let i = 0; i < occurrence; i++) {
    idx = haystack.indexOf(needle, idx + 1);
    if (idx === -1) return -1;
  }
  return idx;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

registerTool("update_artifact", {
  description:
    "عدّل أرتفاكتًا موجودًا بدل إعادة إنشائه — يحافظ على الإصدارات السابقة ويسجّل كل تعديل كإصدار جديد. " +
    "مرّر `content` لاستبدال المحتوى بالكامل، أو `find_replace` لإجراء تعديلات موضعية دقيقة (مفضّل للملفات الطويلة)، " +
    "أو `title` لإعادة التسمية فقط. يمكنك الدمج بينها في نداء واحد.",
  inputSchema: z.object({
    artifact_id: z.string().describe("معرّف الأرتفاكت المراد تعديله (من نتيجة create_artifact)"),
    title: z.string().optional().describe("عنوان جديد اختياري"),
    content: z.string().optional().describe("المحتوى الجديد الكامل (يستبدل القديم)"),
    find_replace: z.array(z.object({
      find: z.string().describe("النص الحالي المطابق تمامًا (بما فيه المسافات والأسطر)"),
      replace: z.string().describe("النص البديل"),
      replace_all: z.boolean().optional().describe("استبدال كل الحدوثات (افتراضيًا يُستبدل أول حدوث فقط)"),
      occurrence: z.number().int().positive().optional().describe("رقم الحدث المطلوب استبداله (1-based)"),
    })).optional().describe("تعديلات موضعية متسلسلة تُطبَّق على المحتوى الحالي"),
    change_summary: z.string().optional().describe("وصف قصير للتغيير يظهر في سجل الإصدارات"),
  }),
  execute: async (args: {
    artifact_id: string;
    title?: string;
    content?: string;
    find_replace?: Array<{ find: string; replace: string; replace_all?: boolean; occurrence?: number }>;
    change_summary?: string;
    __userId?: string;
  }) => {
    const { artifact_id, title, content, find_replace, change_summary, __userId } = args;
    try {
      if (!__userId) {
        return JSON.stringify({ status: "error", message: "لا يمكن تعديل Artifact بدون مستخدم مسجّل." });
      }
      if (!title && !content && (!find_replace || find_replace.length === 0)) {
        return JSON.stringify({
          status: "error",
          message: "لا يوجد تعديل. مرّر content أو find_replace أو title على الأقل.",
        });
      }

      const current = await getArtifact(artifact_id, __userId);
      if (!current) {
        return JSON.stringify({ status: "error", message: `الأرتفاكت ${artifact_id} غير موجود أو غير متاح.` });
      }

      // Composition order: full replacement first, then targeted edits run
      // on top of the NEW content — so "rewrite it and fix these strings"
      // works as one intuitive call.
      let baseContent = current.content;
      if (content !== undefined) {
        baseContent = content;
      }
      let finalContent = baseContent;
      let replacementsApplied = 0;
      if (find_replace && find_replace.length > 0) {
        const result = applyReplacements(baseContent, find_replace);
        finalContent = result.content;
        replacementsApplied = result.applied;
      }

      const updated = await updateArtifact(artifact_id, __userId, {
        ...(title !== undefined ? { title } : {}),
        content: finalContent,
        changeSummary: change_summary ?? (replacementsApplied > 0 ? `${replacementsApplied} targeted edit(s)` : undefined),
        author: "assistant",
      });

      return JSON.stringify({
        status: "success",
        artifact_id: updated.id,
        version: updated.version,
        previous_version: current.version,
        title: updated.title,
        replacements_applied: replacementsApplied,
        message: `تم تحديث "${updated.title}" — الإصدار ${updated.version}.`,
      });
    } catch (err: unknown) {
      return JSON.stringify({
        status: "error",
        message: err instanceof Error ? err.message : "فشل تحديث الـ Artifact",
      });
    }
  },
});

createToolMetadata(
  "update_artifact",
  "Edit an existing artifact with full-content or targeted find/replace changes; every save creates a restorable version",
  { requiresUserId: true, category: "files", enabledByDefault: true },
);
