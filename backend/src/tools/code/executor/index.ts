import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { executeCode } from "./wandbox-code-executor.js";

registerTool("code_executor", {
  description: "نفذ كود برمجي بلغات متعددة (Python, JavaScript, Java, C++, Rust, Go, وغيرها). استخدم عندما يطلب المستخدم تشغيل كود ورؤية المخرجات. مهم: لا تستخدم إلا بطلب مباشر من المستخدم.",
  inputSchema: z.object({
    code: z.string().describe("الكود البرمجي المراد تنفيذه"),
    language: z.string().describe("لغة البرمجة (python, javascript, typescript, java, cpp, c, rust, go, ruby, php, sql, bash)"),
    stdin: z.string().optional().describe("المدخلات القياسية للبرنامج (اختياري)"),
  }),
  execute: async (args: { code: string; language: string; stdin?: string; __userId?: string }) => {
    const { code, language, stdin, __userId } = args;
    const result = await executeCode(code, language, stdin, __userId);
    if (result.artifact_id) {
      return JSON.stringify(result);
    }
    try {
      const { createArtifact } = await import("../../files/create-artifact/artifact-store.js");
      const outputHtml = `<div class="code-execution" dir="ltr">
<style>
  .ce-header { display:flex; justify-content:space-between; align-items:center; padding:8px 16px; background:#1a1a2e; border-bottom:1px solid #333; border-radius:8px 8px 0 0; font-family:monospace; font-size:12px; color:#888; }
  .ce-status { padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; }
  .ce-status.success { background:#10b98120; color:#10b981; }
  .ce-status.error { background:#ef444420; color:#ef4444; }
  .ce-status.timeout { background:#f59e0b20; color:#f59e0b; }
  .ce-body { background:#1e1e2e; padding:16px; border-radius:0 0 8px 8px; }
  .ce-code { margin-bottom:16px; }
  .ce-code pre { background:#111; padding:12px; border-radius:6px; overflow-x:auto; font-size:13px; line-height:1.5; color:#e0e0e0; }
  .ce-output { background:#0d0d1a; padding:12px; border-radius:6px; font-family:monospace; font-size:13px; line-height:1.5; white-space:pre-wrap; color:#10b981; }
  .ce-error { background:#0d0d1a; padding:12px; border-radius:6px; font-family:monospace; font-size:13px; line-height:1.5; white-space:pre-wrap; color:#ef4444; }
  .ce-label { font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px; }
</style>
<div class="ce-header"><span>${language}</span><span class="ce-status ${result.status}">${result.status}</span></div>
<div class="ce-body">
  <div class="ce-code"><div class="ce-label">Code</div><pre><code>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre></div>
  ${result.output ? `<div><div class="ce-label">Output</div><div class="ce-output">${result.output.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div></div>` : ""}
  ${result.error ? `<div style="margin-top:${result.output ? 16 : 0}px"><div class="ce-label">Error</div><div class="ce-error">${result.error.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div></div>` : ""}
</div></div>`;
      if (__userId) {
        await createArtifact({ ownerId: __userId, type: "html", title: `Code Output (${language})`, content: outputHtml, language: "html", author: "assistant" });
      }
    } catch { /* artifact creation is optional */ }
    return JSON.stringify(result);
  },
});
