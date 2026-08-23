import { describe, expect, it } from "vitest";
import { extractWebSources } from "@/features/ai-assistant/ui/web-search-sources";

describe("extractWebSources", () => {
  it("parses the web_search tool's array output", () => {
    const result = [
      { index: 1, title: "Limits — Khan Academy", url: "https://khanacademy.org/limits", snippet: "Intro to limits" },
      { index: 2, title: "Paul's Notes", url: "https://tutorial.math.lamar.edu/limits" },
    ];
    const out = extractWebSources(result);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      title: "Limits — Khan Academy",
      url: "https://khanacademy.org/limits",
      snippet: "Intro to limits",
    });
    expect(out[1].snippet).toBeUndefined();
  });

  it("unwraps a { results: [...] } envelope", () => {
    const out = extractWebSources({ results: [{ title: "T", url: "https://x.com" }] });
    expect(out).toEqual([{ title: "T", url: "https://x.com" }]);
  });

  it("dedupes by URL and drops entries without a link", () => {
    const out = extractWebSources([
      { title: "A", url: "https://x.com/a" },
      { title: "A-dup", url: "https://x.com/a" },
      { title: "no link" },
      null,
      "garbage",
    ]);
    expect(out).toHaveLength(1);
  });

  it("accepts `link` as an alternative to `url` and falls back to url as title", () => {
    const out = extractWebSources([{ link: "https://y.com/page" }]);
    expect(out).toEqual([{ title: "https://y.com/page", url: "https://y.com/page" }]);
  });

  it("caps results at the requested maximum", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      title: `t${i}`,
      url: `https://x.com/${i}`,
    }));
    expect(extractWebSources(many)).toHaveLength(8);
    expect(extractWebSources(many, 3)).toHaveLength(3);
  });

  it("truncates long snippets", () => {
    const out = extractWebSources([
      { title: "t", url: "https://x.com", snippet: "x".repeat(500) },
    ]);
    expect(out[0].snippet).toHaveLength(200);
  });

  it("returns empty for unusable shapes", () => {
    expect(extractWebSources(undefined)).toEqual([]);
    expect(extractWebSources("nope")).toEqual([]);
    expect(extractWebSources({ results: "not-an-array" })).toEqual([]);
  });
});
