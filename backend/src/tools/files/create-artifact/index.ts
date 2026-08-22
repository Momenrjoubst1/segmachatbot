import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createArtifact } from "./in-memory-artifact-store.js";
import { injectFontsIntoHtml, resolveFontLinks } from "../../utils/fonts/library.js";

registerTool("create_artifact", {
  description:
    "أنشيء محتوى تفاعلي في اللوحة الجانبية (Artifact). استخدم لإنشاء رسومات بيانية، أكواد تفاعلية، جداول، " +
    "خرائط ذهنية، اختبارات، ومحتوى تعليمي، أو بيئة تطوير متكاملة (IDE). المحتوى يظهر في لوحة منفصلة بجانب الشات. " +
    "يدعم تمرير `fonts` لحقن خطوط Google Fonts (عربي/لاتيني/مونو/ديكور/يدوي) في HTML و React. " +
    "عند استخدام type='ide'، يتم إنشاء بيئة تطوير كاملة مع محرر أكواد، شجرة ملفات، وتيرمينال.",
  inputSchema: z.object({
    type: z.enum(["html", "svg", "mermaid", "markdown", "code", "chart", "quiz", "react", "ide"]).describe("نوع المحتوى: html, svg, mermaid, markdown, code, chart, quiz, react, ide"),
    title: z.string().describe("عنوان الـ Artifact"),
    content: z.string().describe("محتوى الـ Artifact (HTML, SVG, Mermaid, Markdown, كود برمجي، JSON للـ charts/quizzes/ide)"),
    language: z.string().optional().describe("لغة الكود إذا كان النوع 'code' (مثال: python, javascript, typescript, java)"),
    projectFiles: z.array(z.object({
      name: z.string(),
      type: z.enum(["file", "folder"]),
      content: z.string().optional(),
      path: z.string(),
      children: z.any().optional(),
    })).optional().describe("ملفات المشروع للـ IDE (مطلوب عند type='ide')"),
    fonts: z.array(z.string()).optional().describe(
      "اختياري: أسماء خطوط Google Fonts لتطبيقها على HTML/React (مثال: ['Cairo', 'JetBrains Mono']). تُقبل الأسماء المستعارة. تُحقن خطوط Google تلقائياً داخل <head>.",
    ),
    bodyFontFamily: z.string().optional().describe(
      "اختياري: قيمة CSS font-family تُطبّق على body عند غياب خطوط صريحة.",
    ),
  }),
  execute: async (args: {
    type: string;
    title: string;
    content: string;
    language?: string;
    fonts?: string[];
    bodyFontFamily?: string;
    projectFiles?: Array<{ name: string; path: string; content?: string } | Record<string, unknown>>;
    __userId?: string;
  }) => {
    const { type, title, content, language, fonts, bodyFontFamily, projectFiles, __userId } = args;
    try {
      let finalContent = content;
      let appliedFonts: string[] = [];
      let missingFonts: string[] = [];
      let linkHref = '';

      // Handle IDE type with project files
      if (type === "ide" && projectFiles) {
        finalContent = JSON.stringify({
          projectName: title,
          files: projectFiles,
        });
      }

      // Auto-inject Google Fonts for HTML/React artifacts when fonts are requested
      if (fonts && fonts.length > 0 && (type === "html" || type === "react")) {
        const resolved = resolveFontLinks(fonts);
        appliedFonts = resolved.names;
        missingFonts = resolved.missing;
        linkHref = resolved.linkHref;
        if (linkHref) {
          finalContent = injectFontsIntoHtml(content, resolved.names, bodyFontFamily);
        }
      }

      const artifact = createArtifact(type, title, finalContent, language, __userId);

      return JSON.stringify({
        status: "success",
        artifact_id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        applied_fonts: appliedFonts,
        missing_fonts: missingFonts,
        fonts_link: linkHref || undefined,
        message:
          missingFonts.length > 0
            ? `تم إنشاء "${title}" بنجاح. تحذير: خطوط غير معروفة: ${missingFonts.join(", ")}.`
            : appliedFonts.length > 0
              ? `تم إنشاء "${title}" مع الخطوط: ${appliedFonts.join(", ")}.`
              : `تم إنشاء "${title}" بنجاح.`,
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "فشل في إنشاء الـ Artifact", error: err instanceof Error ? err.message : String(err) });
    }
  },
});
