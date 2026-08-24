import { describe, expect, it } from "vitest";
import { splitThinkBlocks } from "../../features/ai-assistant/ui/bot-activity/thinkTags";

describe("splitThinkBlocks", () => {
  it("returns text untouched when no think tags", () => {
    const r = splitThinkBlocks("Hello world");
    expect(r).toEqual({ thinking: "", answer: "Hello world", open: false });
  });

  it("handles empty input", () => {
    const r = splitThinkBlocks("");
    expect(r).toEqual({ thinking: "", answer: "", open: false });
  });

  it("splits a complete block", () => {
    const r = splitThinkBlocks("<think>reasoning here</think>The answer.");
    expect(r.thinking).toBe("reasoning here");
    expect(r.answer).toBe("The answer.");
    expect(r.open).toBe(false);
  });

  it("handles an unclosed block while streaming", () => {
    const r = splitThinkBlocks("<think>still thinking");
    expect(r.thinking).toBe("still thinking");
    expect(r.answer).toBe("");
    expect(r.open).toBe(true);
  });

  it("keeps partial answer after an unclosed reopen", () => {
    // Model finished one thought, produced some text, then started another.
    const text = "<think>first</think>Partial answer<think>second thought";
    const r = splitThinkBlocks(text);
    expect(r.thinking).toBe("first\n\nsecond thought");
    expect(r.answer).toBe("Partial answer");
    expect(r.open).toBe(true);
  });

  it("concatenates multiple complete blocks", () => {
    const text = "<think>a</think>middle<think>b</think>end";
    const r = splitThinkBlocks(text);
    expect(r.thinking).toBe("a\n\nb");
    expect(r.answer).toContain("middle");
    expect(r.answer).toContain("end");
    expect(r.answer).not.toContain("<think>");
    expect(r.open).toBe(false);
  });

  it("does not treat a lone closing tag as thinking", () => {
    const r = splitThinkBlocks("no tags but </think> appears literally");
    expect(r.open).toBe(false);
    expect(r.thinking).toBe("");
    expect(r.answer).toContain("</think>");
  });
});
