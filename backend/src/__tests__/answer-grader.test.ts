import { describe, it, expect } from "vitest";
import {
  extractNumbers,
  isBareNumericAnswer,
  attemptNumericGrade,
  normalizeForLexicalMatch,
  lexicalOverlapScore,
  parseGraderResponse,
} from "../services/study/answer-grader.service.js";

describe("extractNumbers", () => {
  it("extracts plain integers and decimals", () => {
    expect(extractNumbers("There are 12 items, or 3.5 kg")).toEqual(["12", "3.5"]);
  });

  it("normalizes Arabic-Indic digits", () => {
    expect(extractNumbers("عدد الطلاب ٤٥")).toEqual(["45"]);
  });

  it("treats decimal comma as a dot", () => {
    expect(extractNumbers("السرعة 9,8")).toEqual(["9.8"]);
  });

  it("returns empty for text without numbers", () => {
    expect(extractNumbers("لا توجد أرقام هنا")).toEqual([]);
  });
});

describe("isBareNumericAnswer", () => {
  it("accepts a plain number", () => {
    expect(isBareNumericAnswer("42")).toBe(true);
    expect(isBareNumericAnswer(" 3.14 ")).toBe(true);
    expect(isBareNumericAnswer("٤٥")).toBe(true);
  });

  it("rejects numbers mixed with words", () => {
    expect(isBareNumericAnswer("حوالي 42 سنة")).toBe(false);
  });

  it("rejects long or empty answers", () => {
    expect(isBareNumericAnswer("")).toBe(false);
    expect(isBareNumericAnswer("1 2 3 4 5 6 7 8 9 10 11 12")).toBe(false);
  });
});

describe("attemptNumericGrade", () => {
  const reference = "[صفحة 12]\nبلغ عدد الكواكب 8 في المجموعة الشمسية، وتبعد الشمس 150 مليون كم.";

  it("confirms a matching bare number", () => {
    const result = attemptNumericGrade("8", reference);
    expect(result).not.toBeNull();
    expect(result?.verdict).toBe("correct");
    expect(result?.score).toBe(1);
  });

  it("accepts Arabic-Indic digits when they match", () => {
    const result = attemptNumericGrade("١٥٠", reference);
    expect(result?.verdict).toBe("correct");
  });

  it("returns null for a number that is not in the reference (defers to LLM)", () => {
    expect(attemptNumericGrade("9", reference)).toBeNull();
  });

  it("returns null when there is no reference context", () => {
    expect(attemptNumericGrade("8", "")).toBeNull();
  });

  it("returns null for wordy answers even if the number matches", () => {
    expect(attemptNumericGrade("عدد الكواكب هو 8", reference)).toBeNull();
  });
});

describe("normalizeForLexicalMatch", () => {
  it("strips diacritics, tatweel, and unifies Alef/Ya/Teh-Marbuta", () => {
    expect(normalizeForLexicalMatch("الْعِلْمُ")).toEqual(["العلم"]);
    expect(normalizeForLexicalMatch("أحمد أمين")).toEqual(["احمد", "امين"]);
    expect(normalizeForLexicalMatch("مدرسة")).toEqual(["مدرسه"]);
  });

  it("lowercases and strips punctuation", () => {
    expect(normalizeForLexicalMatch("Hello, World!")).toEqual(["hello", "world"]);
  });
});

describe("lexicalOverlapScore", () => {
  it("returns 1 for identical content", () => {
    expect(lexicalOverlapScore("الطاقة الحركية", "الطاقة! الحركية؟")).toBe(1);
  });

  it("returns 0 for disjoint content", () => {
    expect(lexicalOverlapScore("الطاقة", "الكيمياء العضوية")).toBe(0);
  });

  it("returns a partial score for overlapping content", () => {
    const score = lexicalOverlapScore("قانون نيوتن الأول", "قانون نيوتن الثاني والحركة");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("handles empty inputs", () => {
    expect(lexicalOverlapScore("", "anything")).toBe(0);
  });
});

describe("parseGraderResponse", () => {
  it("parses a clean JSON object", () => {
    const parsed = parseGraderResponse(
      JSON.stringify({
        verdict: "partial",
        score: 0.6,
        feedback: "أحسنت لكن نقصتك نقطة",
        model_answer: "...",
        missed_points: ["التعريف"],
      })
    );
    expect(parsed.verdict).toBe("partial");
    expect(parsed.score).toBe(0.6);
    expect(parsed.missed_points).toEqual(["التعريف"]);
  });

  it("strips code fences and surrounding prose", () => {
    const raw = 'هذه النتيجة:\n```json\n{"verdict":"correct","score":1,"feedback":"ممتاز","model_answer":"x","missed_points":[]}\n```\nشكراً';
    expect(parseGraderResponse(raw).verdict).toBe("correct");
  });

  it("rejects invalid verdicts", () => {
    const bad = '{"verdict":"maybe","score":1,"feedback":"x","model_answer":"x","missed_points":[]}';
    expect(() => parseGraderResponse(bad)).toThrow();
  });

  it("rejects out-of-range scores", () => {
    const bad = '{"verdict":"correct","score":1.5,"feedback":"x","model_answer":"x","missed_points":[]}';
    expect(() => parseGraderResponse(bad)).toThrow();
  });
});
