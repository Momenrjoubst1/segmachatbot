import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import {
  buildFontsCatalogPrompt,
  injectFontsIntoHtml,
  listFonts,
  resolveFontLinks,
} from "./library.js";

/**
 * apply_fonts — طبّق خطوط Google Fonts على مقتطف HTML/SVG/Markdown موجود
 *
 * The bot uses this when it already generated an artifact and wants to
 * retro-fit it with a specific font set, OR to inspect the available fonts.
 */
registerTool("apply_fonts", {
  description:
    "طبّق خطوط Google Fonts على محتوى HTML/SVG/Markdown موجود، أو اعرض قائمة الخطوط المتاحة في مكتبة الخطوط. " +
    "استخدم عند توليد محتوى يحتاج خطاً معيناً (عربي، لاتيني، مونو، ديكور، خط يدوي). " +
    "المحتوى يغلّف داخل مستند HTML كامل مع <link> لخطوط Google و font-family مناسب.",
  inputSchema: z.object({
    action: z.enum(["apply", "list", "resolve"]).describe(
      "الإجراء: 'apply' لتطبيق الخطوط على محتوى، 'list' لعرض الخطوط المتاحة، 'resolve' للحصول على معلومات CSS لخطوط محددة.",
    ),
    fonts: z.array(z.string()).optional().describe(
      "أسماء الخطوط المطلوبة (مثال: ['Cairo', 'JetBrains Mono']). تُقبل الأسماء المستعارة والجزئية.",
    ),
    content: z.string().optional().describe(
      "محتوى HTML/SVG/Markdown لتطبيق الخطوط عليه (مطلوب عند action='apply').",
    ),
    bodyFontFamily: z.string().optional().describe(
      "قيمة CSS font-family اختيارية تُطبّق على body (تستخدم إذا كانت مختلفة عن الخطوط المطلوبة).",
    ),
    category: z
      .enum(["arabic", "sans", "serif", "mono", "display", "handwriting", "all"])
      .optional()
      .describe("تصفية حسب الفئة عند action='list'."),
    maxItems: z.number().int().min(1).max(200).optional().describe("الحد الأقصى لعدد العناصر في action='list'."),
  }),
  execute: async (args: {
    action: "apply" | "list" | "resolve";
    fonts?: string[];
    content?: string;
    bodyFontFamily?: string;
    category?: "arabic" | "sans" | "serif" | "mono" | "display" | "handwriting" | "all";
    maxItems?: number;
    __userId?: string;
  }) => {
    try {
      const { action, fonts, content, bodyFontFamily, category, maxItems } = args;

      if (action === "list") {
        const { count, byCategory } = listFonts();
        if (category && category !== "all") {
          const items = byCategory[category] || [];
          return JSON.stringify({
            status: "success",
            count: items.length,
            category,
            fonts: items.slice(0, maxItems ?? 100),
            prompt: buildFontsCatalogPrompt(),
            message: `يوجد ${items.length} خط في فئة '${category}'.`,
          });
        }
        return JSON.stringify({
          status: "success",
          count,
          byCategory,
          prompt: buildFontsCatalogPrompt(),
          message: `إجمالي ${count} خط متاح في ${Object.keys(byCategory).length} فئات.`,
        });
      }

      if (action === "resolve") {
        if (!fonts || fonts.length === 0) {
          return JSON.stringify({ status: "error", message: "fonts مطلوب عند action='resolve'." });
        }
        const resolved = resolveFontLinks(fonts);
        return JSON.stringify({
          status: "success",
          requested: fonts,
          names: resolved.names,
          missing: resolved.missing,
          categories: resolved.categories,
          linkHref: resolved.linkHref,
          familyStack: resolved.familyStack,
          usage: {
            htmlLink: `<link rel="stylesheet" href="${resolved.linkHref}">`,
            cssFamily: `font-family: ${resolved.familyStack};`,
            tailwindFamily: `font-['${resolved.names.join("','")}']`,
          },
          message:
            resolved.missing.length > 0
              ? `تم حل ${resolved.names.length} خط. لم يُعثر على: ${resolved.missing.join(", ")}.`
              : `تم حل ${resolved.names.length} خط بنجاح.`,
        });
      }

      // action === "apply"
      if (!fonts || fonts.length === 0) {
        return JSON.stringify({ status: "error", message: "fonts مطلوب عند action='apply'." });
      }
      if (!content) {
        return JSON.stringify({ status: "error", message: "content مطلوب عند action='apply'." });
      }

      const resolved = resolveFontLinks(fonts);
      if (!resolved.linkHref) {
        return JSON.stringify({
          status: "error",
          message: "لم يُعثر على أي خط من الأسماء المُدخلة.",
          missing: resolved.missing,
        });
      }

      const finalHtml = injectFontsIntoHtml(content, resolved.names, bodyFontFamily);

      return JSON.stringify({
        status: "success",
        applied: resolved.names,
        missing: resolved.missing,
        linkHref: resolved.linkHref,
        familyStack: resolved.familyStack,
        html: finalHtml,
        message:
          resolved.missing.length > 0
            ? `طُبّقت ${resolved.names.length} خط. تحذير: لم يُعثر على ${resolved.missing.join(", ")}.`
            : `طُبّقت ${resolved.names.length} خط بنجاح.`,
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "فشل تطبيق الخطوط", error: err instanceof Error ? err.message : String(err) });
    }
  },
});
