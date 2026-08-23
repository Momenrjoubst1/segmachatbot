import { describe, it, expect } from "vitest";
import {
  StreamingSentenceSplitter,
  stripMarkdownForSpeech,
} from "../sentence-splitter";

describe("stripMarkdownForSpeech", () => {
  it("removes code fences entirely", () => {
    const out = stripMarkdownForSpeech("قبل\n```py\nprint(1)\n```\nبعد");
    expect(out).not.toContain("print");
    expect(out).toContain("قبل");
    expect(out).toContain("بعد");
  });
  it("keeps link text, drops URL", () => {
    const out = stripMarkdownForSpeech("[الدليل](https://x.com/a)");
    expect(out).toContain("الدليل");
    expect(out).not.toContain("https");
  });
  it("strips emphasis markers and headers", () => {
    const out = stripMarkdownForSpeech("## عنوان\n**مهم** جداً");
    expect(out).toContain("عنوان");
    expect(out).toContain("مهم");
    expect(out).not.toContain("**");
    expect(out).not.toContain("#");
  });
});

describe("StreamingSentenceSplitter", () => {
  it("emits sentences as they close across chunks", () => {
    const s = new StreamingSentenceSplitter();
    expect(s.push("مرحبًا بك في سيجما.")).toEqual(["مرحبًا بك في سيجما."]);
    expect(s.push("كيف أساعد")).toEqual([]);
    expect(s.push("ك اليوم؟")).toEqual(["كيف أساعدك اليوم؟"]);
    expect(s.flush()).toBeNull();
  });

  it("handles newlines as boundaries", () => {
    const s = new StreamingSentenceSplitter();
    const got = s.push("السطر الأول\nوالسطر الثاني");
    expect(got).toEqual(["السطر الأول"]);
    expect(s.flush()).toBe("والسطر الثاني");
  });

  it("does not split decimal numbers", () => {
    const s = new StreamingSentenceSplitter();
    const got = s.push("النسبة 3.14 تقريبًا. تمام؟");
    // 3.14 must stay intact inside the first sentence
    expect(got.join(" ")).toContain("3.14");
    expect(got[got.length - 1]).toContain("تمام");
  });

  it("hard-wraps pathological punctuation-free runs", () => {
    const s = new StreamingSentenceSplitter();
    const longRun = "كلمة ".repeat(220); // ~1100 chars, no sentence enders
    const got = s.push(longRun);
    expect(got.length).toBeGreaterThanOrEqual(2);
    for (const seg of got) expect(seg.length).toBeLessThanOrEqual(300);
  });

  it("flushes markdown-stripped tail", () => {
    const s = new StreamingSentenceSplitter();
    s.push("جملة مكتملة. وبقيت هذه");
    expect(s.flush()).toContain("وبقيت هذه");
  });
});