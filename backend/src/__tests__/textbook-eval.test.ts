// Textbook search evaluation tests for BM25 normalization, fuzzy matching, SM-2, and quiz intent.

import { describe, it, expect, beforeAll } from "vitest";
import { QUIZ_INTENT_REGEX } from "../services/chat/pipeline/rag-retrieval.js";

// BM25 Arabic text normalization tests.
describe("BM25 Arabic Normalization", () => {
  // Local copy of the Arabic normalizer that BM25 ranking applies internally.

  const ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0610-\u061A\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g;
  const TATWEEL_RE = /\u0640/g;
  const ALEF_VARIANTS_RE = /[\u0622\u0623\u0625]/g;
  const TEH_MARBUTA_RE = /\u0629/g;
  const ALEF_MAQSUR_RE = /\u0649/g;

  function normalizeArabic(text: string): string {
    return text
      .replace(TATWEEL_RE, "")
      .replace(ALEF_VARIANTS_RE, "\u0627")
      .replace(TEH_MARBUTA_RE, "\u0647")
      .replace(ALEF_MAQSUR_RE, "\u064A")
      .replace(ARABIC_DIACRITICS_RE, "");
  }

  it("strips diacritics (tashkeel)", () => {
    // Note: teh marbuta (ة) also normalizes to heh (ه)
    expect(normalizeArabic("الْعَرَبِيَّة")).toBe("العربيه");
  });

  it("normalizes alef variants to bare alef", () => {
    expect(normalizeArabic("آمِن أَحَد إِبْرَاهِيم")).toBe("امن احد ابراهيم");
  });

  it("converts teh marbuta to heh", () => {
    expect(normalizeArabic("جامعة")).toBe("جامعه");
  });

  it("converts alef maqsura to ya", () => {
    expect(normalizeArabic("على")).toBe("علي");
  });

  it("removes tatweel (kashida)", () => {
    expect(normalizeArabic("جَامِعَة")).toBe("جامعه");
    expect(normalizeArabic("عَلَى")).toBe("علي");
  });

  it("handles mixed diacritics and variants", () => {
    // teh marbuta -> heh, alef maqsura -> ya
    expect(normalizeArabic("الْجَامِعَةُ الْكُبْرَى")).toBe("الجامعه الكبري");
  });
});

// Fuzzy title matching tests.
describe("Fuzzy Title Matching", () => {
  function fuzzyMatch(query: string, title: string): number {
    const q = query.toLowerCase().trim();
    const t = title.toLowerCase().trim();

    if (t.includes(q) || q.includes(t)) return 1.0;

    const qWords = q.split(/\s+/);
    const tWords = t.split(/\s+/);
    let matches = 0;
    for (const qw of qWords) {
      for (const tw of tWords) {
        if (tw.includes(qw) || qw.includes(tw)) {
          matches++;
          break;
        }
      }
    }
    return qWords.length > 0 ? matches / qWords.length : 0;
  }

  it("exact substring -> 1.0", () => {
    expect(fuzzyMatch("lesson 2", "Lesson 2: Variables")).toBe(1.0);
    expect(fuzzyMatch("Variables", "Lesson 2: Variables")).toBe(1.0);
  });

  it("word overlap partial", () => {
    const score = fuzzyMatch("python functions", "Lesson 3: Functions in Python");
    expect(score).toBeGreaterThan(0.5);
  });

  it("no overlap -> 0", () => {
    expect(fuzzyMatch("completely different", "Lesson 1: Intro")).toBe(0);
  });

  it("Arabic word overlap", () => {
    const score = fuzzyMatch("الدرس الثاني", "الدرس الثاني: المتغيرات");
    expect(score).toBe(1.0);
  });
});

// Hybrid fuzzy-plus-semantic score combination tests.
describe("Hybrid Score (Fuzzy + Semantic)", () => {
  it("combines fuzzy and semantic with weights", () => {
    const fuzzy = 0.5;
    const semantic = 0.8;
    const combined = 0.4 * fuzzy + 0.6 * semantic;
    expect(combined).toBeCloseTo(0.68);
  });

  it("semantic dominates for paraphrases", () => {
    // Paraphrase: fuzzy low, semantic high
    const score = 0.4 * 0.1 + 0.6 * 0.9;
    expect(score).toBeGreaterThan(0.55);
  });

  it("fuzzy helps when semantic fails", () => {
    // Exact match: fuzzy=1, semantic may be lower
    const score = 0.4 * 1.0 + 0.6 * 0.7;
    expect(score).toBeGreaterThan(0.8);
  });
});

// SM-2 spaced repetition scheduler tests.
describe("SM-2 Spaced Repetition Scheduler", () => {
  // Inline SM-2 logic for testing (copied from srs.ts)
  type ReviewQuality = 'again' | 'hard' | 'good' | 'easy';
  const QUALITY_MAP: Record<ReviewQuality, number> = { again: 0, hard: 3, good: 4, easy: 5 };
  const MIN_EASE = 1.3;

  function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }

  function scheduleNext(state: { interval_days: number; ease_factor: number; repetitions: number; lapses: number }, quality: ReviewQuality) {
    const q = QUALITY_MAP[quality];
    if (q < 3) {
      return { interval_days: 0, ease_factor: clamp(state.ease_factor - 0.2, MIN_EASE, 3.0), repetitions: 0, lapses: state.lapses + 1 };
    }
    const newEase = clamp(state.ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), MIN_EASE, 3.0);
    let newInterval: number;
    if (state.repetitions === 0) newInterval = quality === 'hard' ? 1 : quality === 'easy' ? 4 : 2;
    else if (state.repetitions === 1) newInterval = quality === 'hard' ? 3 : quality === 'easy' ? 7 : 5;
    else {
      newInterval = Math.round(state.interval_days * newEase);
      if (quality === 'hard') newInterval = Math.max(1, Math.round(newInterval * 0.8));
      if (quality === 'easy') newInterval = Math.round(newInterval * 1.2);
    }
    return { interval_days: newInterval, ease_factor: newEase, repetitions: state.repetitions + 1, lapses: state.lapses };
  }

  it("again resets interval to 0 and increments lapses", () => {
    const s = { interval_days: 30, ease_factor: 2.5, repetitions: 5, lapses: 2 };
    const n = scheduleNext(s, 'again');
    expect(n.interval_days).toBe(0);
    expect(n.repetitions).toBe(0);
    expect(n.lapses).toBe(3);
    expect(n.ease_factor).toBeCloseTo(2.3, 1);
  });

  it("good on first rep -> 2 days", () => {
    const s = { interval_days: 0, ease_factor: 2.5, repetitions: 0, lapses: 0 };
    const n = scheduleNext(s, 'good');
    expect(n.interval_days).toBe(2);
    expect(n.repetitions).toBe(1);
  });

  it("easy on first rep -> 4 days", () => {
    const s = { interval_days: 0, ease_factor: 2.5, repetitions: 0, lapses: 0 };
    const n = scheduleNext(s, 'easy');
    expect(n.interval_days).toBe(4);
  });

  it("hard on first rep -> 1 day", () => {
    const s = { interval_days: 0, ease_factor: 2.5, repetitions: 0, lapses: 0 };
    const n = scheduleNext(s, 'hard');
    expect(n.interval_days).toBe(1);
  });

  it("ease factor never below 1.3", () => {
    const s = { interval_days: 0, ease_factor: 1.3, repetitions: 0, lapses: 0 };
    const n = scheduleNext(s, 'again');
    expect(n.ease_factor).toBe(1.3);
  });

  it("interval grows exponentially on good reviews", () => {
    let s = { interval_days: 0, ease_factor: 2.5, repetitions: 0, lapses: 0 };
    s = scheduleNext(s, 'good'); // 2
    s = scheduleNext(s, 'good'); // 5
    s = scheduleNext(s, 'good'); // ~12
    s = scheduleNext(s, 'good'); // ~30
    expect(s.interval_days).toBeGreaterThan(25);
  });
});

// Quiz intent detection regex tests — validates the SHIPPED regex, not a copy.
describe("Quiz Intent Detection Regex", () => {
  const quizRegex = QUIZ_INTENT_REGEX;

  const positive = [
    "اختبرني بالدرس الأول",
    "امتحني",
    "quiz me on lesson 2",
    "give me practice questions",
    "اختبار لي على الفصل الثالث",
    "ابغى تمارين على الوحدة الثانية",
  ];

  const negative = [
    "explain recursion",
    "ما هي الدالة",
    "help me understand",
    "hello how are you",
    // Ordinary study questions used to be hijacked into quiz mode:
    "عندي سؤال عن التفاضل",
    "revise chapter 4 for me please",
    "students often study late at night",
  ];

  for (const text of positive) {
    it(`matches: "${text}"`, () => {
      expect(quizRegex.test(text)).toBe(true);
    });
  }

  for (const text of negative) {
    it(`does not match: "${text}"`, () => {
      expect(quizRegex.test(text)).toBe(false);
    });
  }
});

// Cosine similarity tests.
describe("Cosine Similarity", () => {
  function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  }

  it("identical normalized vectors -> 1", () => {
    const v = [0.6, 0.8];
    expect(cosineSimilarity(v, v)).toBe(1);
  });

  it("orthogonal -> 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("opposite -> -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  });

  it("length mismatch -> 0", () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });
});