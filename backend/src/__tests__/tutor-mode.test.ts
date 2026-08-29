import { describe, it, expect } from "vitest";
import {
  detectTutorMode,
  buildTutorModeInstruction,
} from "../prompts/tutor-mode.js";
import { difficultyFromMastery } from "../services/study/quiz-generator.service.js";

describe("detectTutorMode", () => {
  it("detects explicit teaching requests as socratic", () => {
    expect(detectTutorMode("علمني التفاضل")).toBe("socratic");
    expect(detectTutorMode("مش فاهم قانون نيوتن الثاني")).toBe("socratic");
    expect(detectTutorMode("can you teach me recursion?")).toBe("socratic");
    expect(detectTutorMode("help me understand photosynthesis")).toBe("socratic");
    expect(detectTutorMode("درّبني على الموضوع")).toBe("socratic");
  });

  it("detects solving requests as guided", () => {
    expect(detectTutorMode("حل لي هذا السؤال")).toBe("guided");
    expect(detectTutorMode("كيف أحل هذه المسألة؟")).toBe("guided");
    expect(detectTutorMode("solve this equation for x")).toBe("guided");
  });

  it("never triggers on ordinary factual questions", () => {
    expect(detectTutorMode("ما عاصمة الأردن؟")).toBeNull();
    expect(detectTutorMode("hello")).toBeNull();
    expect(detectTutorMode("كم عدد الكواكب؟")).toBeNull();
    expect(detectTutorMode("")).toBeNull();
    expect(detectTutorMode("ok")).toBeNull();
  });

  it("treats teaching cues as stronger than solving cues", () => {
    // "اشرح لي" wins even though "سؤال"-style text may contain other words
    expect(detectTutorMode("اشرح لي كيف أحل المسألة")).toBe("socratic");
  });
});

describe("buildTutorModeInstruction", () => {
  it("socratic instruction demands hint-before-answer", () => {
    const s = buildTutorModeInstruction("socratic");
    expect(s).toContain("Tutor Mode");
    expect(s).toContain("Hint ladder");
    expect(s).toContain("record_quiz_result");
  });

  it("guided instruction hands the final step to the student", () => {
    const g = buildTutorModeInstruction("guided");
    expect(g).toContain("Guided Solving");
    expect(g).toContain("final step");
  });

  it("both modes keep the never-dead-end rule", () => {
    expect(buildTutorModeInstruction("socratic")).toContain("TWO unsuccessful attempts");
    expect(buildTutorModeInstruction("guided")).toContain("TWO unsuccessful attempts");
  });
});

describe("difficultyFromMastery", () => {
  it("maps mastery bands to difficulty", () => {
    expect(difficultyFromMastery(null)).toBe("medium");
    expect(difficultyFromMastery(0.0)).toBe("easy");
    expect(difficultyFromMastery(0.34)).toBe("easy");
    expect(difficultyFromMastery(0.5)).toBe("medium");
    expect(difficultyFromMastery(0.69)).toBe("medium");
    expect(difficultyFromMastery(0.9)).toBe("hard");
  });
});
