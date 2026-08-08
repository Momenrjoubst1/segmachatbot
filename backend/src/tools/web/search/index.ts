import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { searchWeb, isWebSearchAvailable } from "./search-engine.js";

registerTool("web_search", {
  description: "ابحث في الإنترنت عن معلومات حديثة أو أخبار. استخدم عندما يحتاج المستخدم معلومات خارج معرفتك أو آخر الأخبار.",
  inputSchema: z.object({
    query: z.string().describe("استعلام البحث بالعربية أو الإنجليزية"),
  }),
  execute: async ({ query }: { query: string }) => {
    try {
      const results = await searchWeb(query, 5);
      if (results.length === 0) {
        return JSON.stringify({ status: "no_results", message: "لم يتم العثور على نتائج", results: [] });
      }
      return JSON.stringify({
        status: "success",
        results: results.map((r, i) => ({ index: i + 1, title: r.title, url: r.url, snippet: r.snippet })),
        total_results: results.length,
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "خطأ في البحث", error: err instanceof Error ? err.message : String(err) });
    }
  },
});

export { isWebSearchAvailable };
