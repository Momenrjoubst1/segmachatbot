import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { searchWeb, isWebSearchAvailable } from "./search-engine.js";

registerTool("web_search", {
  description: "Search the internet for recent information or news. Use when the user needs information beyond your knowledge or the latest news.",
  inputSchema: z.object({
    query: z.string().describe("Search query in Arabic or English"),
  }),
  execute: async ({ query }: { query: string }) => {
    try {
      const results = await searchWeb(query, 5);
      if (results.length === 0) {
        return JSON.stringify({ status: "no_results", message: "No results found", results: [] });
      }
      return JSON.stringify({
        status: "success",
        results: results.map((r, i) => ({ index: i + 1, title: r.title, url: r.url, snippet: r.snippet })),
        total_results: results.length,
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "Search error", error: err instanceof Error ? err.message : String(err) });
    }
  },
});

export { isWebSearchAvailable };
