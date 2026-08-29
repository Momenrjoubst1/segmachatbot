// Education eval suite — the quality gate for the teaching layer.
//
// Runs in two modes:
//   • Offline (default): deterministic fixtures exercise the parsing, fast-path
//     and fallback logic. Always green, always fast — part of CI.
//   • Live (RUN_LLM_EVALS=true): the same fixtures are graded by the real
//     small-model grader/judge and must agree with the expected labels at or
//     above the thresholds below. Run this before merging any prompt change:
//       RUN_LLM_EVALS=true npm test -- evals
//
// A prompt tweak that drops grader agreement below 80% or judge precision
// below 70% fails the suite — that is the gate.

import { describe, it, expect } from "vitest";
import {
  attemptNumericGrade,
  isBareNumericAnswer,
  lexicalOverlapScore,
  parseGraderResponse,
  type ParsedGraderResponse,
} from "../../services/study/answer-grader.service.js";
import { parseJudgeResponse } from "../../services/study/misconception-catcher.service.js";

const LIVE = !!process.env.RUN_LLM_EVALS;

// ─── Grading fixtures (Arabic + English) ────────────────────────────────────────

interface GradingFixture {
  question: string;
  reference: string;
  studentAnswer: string;
  expected: "correct" | "partial" | "incorrect";
}

const GRADING_FIXTURES: GradingFixture[] = [
  {
    question: "كم عدد الكواكب في المجموعة الشمسية؟",
    reference: "تتكوّن المجموعة الشمسية من 8 كواكب تدور حول الشمس.",
    studentAnswer: "8",
    expected: "correct", // objective fast-path must catch this
  },
  {
    question: "What is the boiling point of water at sea level in Celsius?",
    reference: "At sea level, water boils at 100 degrees Celsius.",
    studentAnswer: "100",
    expected: "correct",
  },
  {
    question: "عرّف التمثيل الضوئي.",
    reference: "التمثيل الضوئي هي عملية تحول النبات الطاقة الضوئية إلى طاقة كيميائية لإنتاج الجلوكوز والأكسجين.",
    studentAnswer: "عملية يحوّل فيها النبات الضوء إلى غذاء وينتج أكسجين",
    expected: "correct",
  },
  {
    question: "State Newton's second law.",
    reference: "Newton's second law: the acceleration of an object is directly proportional to the net force and inversely proportional to its mass (F = ma).",
    studentAnswer: "Force equals mass times acceleration.",
    expected: "correct",
  },
  {
    question: "اشرح الفرق بين الخلية النباتية والخلية الحيوانية.",
    reference: "الخلية النباتية تحتوي على جدار سليولوزي وبلاستيدات خضراء، أما الخلية الحيوانية فلا تحتوي عليهما.",
    studentAnswer: "الخلية النباتية لها جدار وبلاستيدات، والحيوانية ليس لها",
    expected: "correct",
  },
  {
    question: "لماذا ينقص ضغط الجو مع الارتفاع؟",
    reference: "ينقص ضغط الجو مع الارتفاع لأن كثافة الهواء تقل فتقل عدد جزيئات الهواء فوق الوحدة.",
    studentAnswer: "لأن الجو يصير أبرد",
    expected: "partial",
  },
  {
    question: "ما هي وظيفة الميتوكوندريا؟",
    reference: "الميتوكوندريا هي عضية مسؤولة عن إنتاج الطاقة (ATP) عبر التنفس الخلوي.",
    studentAnswer: "تصنع البروتينات",
    expected: "incorrect", // protein synthesis is the ribosome's job
  },
  {
    question: "ما الذي يقيسه مقياس الزلازل (ريختر)؟",
    reference: "مقياس ريختر يقيس مقدار الطاقة المنطلقة من الزلزال.",
    studentAnswer: "يقيس سرعة الرياح",
    expected: "incorrect",
  },
];

// ─── Misconception-judge fixtures ────────────────────────────────────────────────

const MISCONCEPTION_FIXTURES: Array<{ message: string; misunderstood: boolean }> = [
  { message: "يعني الجذر التربيعي لأي رقم دايماً بيطلع موجب؟", misunderstood: true },
  { message: "يعني نيوتن اكتشف الجاذبية لما شاف التفاحة وهي طايرة لفوق؟", misunderstood: true },
  { message: "طيب إذا القوة صفر معناها الجسم لازم يكون واقف تماماً صح؟", misunderstood: true },
  { message: "اشرح لي قانون نيوتن الأول", misunderstood: false },
  { message: "ممكن تعطيني مثال إضافي على التمثيل الضوئي؟", misunderstood: false },
  { message: "شكراً، هلأ فهمت الدرس", misunderstood: false },
];

// ─── Offline: deterministic pieces ──────────────────────────────────────────────

describe("Eval: objective fast-path on grading fixtures", () => {
  for (const fx of GRADING_FIXTURES.filter((f) => isBareNumericAnswer(f.studentAnswer))) {
    it(`numeric fast-path grades "${fx.studentAnswer}" as correct`, () => {
      const result: ParsedGraderResponse | null = attemptNumericGrade(fx.studentAnswer, fx.reference);
      expect(result).not.toBeNull();
      expect(result?.verdict).toBe(fx.expected);
    });
  }

  it("never marks a non-matching number incorrect (defers to LLM)", () => {
    expect(attemptNumericGrade("9", "المجموعة الشمسية فيها 8 كواكب")).toBeNull();
  });
});

describe("Eval: grader JSON contract", () => {
  it("accepts a well-formed grader reply for every fixture", () => {
    for (const fx of GRADING_FIXTURES) {
      const reply = JSON.stringify({
        verdict: fx.expected,
        score: fx.expected === "correct" ? 1 : fx.expected === "partial" ? 0.5 : 0.1,
        feedback: "ok",
        model_answer: fx.reference.slice(0, 50),
        missed_points: [],
      });
      expect(parseGraderResponse(reply).verdict).toBe(fx.expected);
    }
  });
});

describe("Eval: lexical fallback bands", () => {
  it("ranks a paraphrased correct answer above a wildly wrong one", () => {
    const paraphrase = GRADING_FIXTURES[2]; // photosynthesis paraphrase
    const wrong = GRADING_FIXTURES[6]; // mitochondria vs proteins
    const correctOverlap = lexicalOverlapScore(paraphrase.studentAnswer, paraphrase.reference);
    const wrongOverlap = lexicalOverlapScore(wrong.studentAnswer, wrong.reference);
    expect(correctOverlap).toBeGreaterThan(wrongOverlap);
  });
  it("wildly wrong answers stay below the partial band", () => {
    const fx = GRADING_FIXTURES[6]; // mitochondria vs proteins
    expect(lexicalOverlapScore(fx.studentAnswer, fx.reference)).toBeLessThan(0.25);
  });
});

describe("Eval: judge JSON contract", () => {
  it("parses both shapes the judge can produce", () => {
    expect(parseJudgeResponse('{"misunderstood": true, "topic": "الجذور"}').misunderstood).toBe(true);
    expect(parseJudgeResponse('{"misunderstood": false, "topic": ""}').misunderstood).toBe(false);
  });
});

// ─── Live gate (RUN_LLM_EVALS=true): real small-model agreement ────────────────

describe.skipIf(!LIVE)("Eval LIVE: small-model grader agreement", () => {
  it("agrees with expected verdicts on >= 80% of fixtures", async () => {
    const { gradeAnswer } = await import("../../services/study/answer-grader.service.js");
    let agreed = 0;
    const misses: string[] = [];

    for (const fx of GRADING_FIXTURES) {
      const result = await gradeAnswer({
        userId: "00000000-0000-0000-0000-00000000evid",
        question: fx.question,
        studentAnswer: fx.studentAnswer,
        topic: "eval",
      });
      if (result.verdict === fx.expected) agreed++;
      else misses.push(`${fx.question} → ${result.verdict} (expected ${fx.expected})`);
    }

    const rate = agreed / GRADING_FIXTURES.length;
    // The numeric fixtures are fast-path (deterministic); the rest are LLM.
    expect(
      rate,
      `Grader agreement ${(rate * 100).toFixed(0)}% (threshold 80%). Misses:\n${misses.join("\n")}`
    ).toBeGreaterThanOrEqual(0.8);
  }, 240_000);
});

describe.skipIf(!LIVE)("Eval LIVE: misconception judge precision", () => {
  it("misunderstanding fixtures are flagged and normal ones are not (>= 70% precision/recall combined)", async () => {
    const { judgeMisconception } = await import("../../services/study/misconception-catcher.service.js");
    let agreed = 0;
    const misses: string[] = [];

    for (const fx of MISCONCEPTION_FIXTURES) {
      const verdict = await judgeMisconception(fx.message, "");
      const matched = verdict.misunderstood === fx.misunderstood;
      if (matched) agreed++;
      else misses.push(`"${fx.message}" → ${verdict.misunderstood} (expected ${fx.misunderstood})`);
    }

    const rate = agreed / MISCONCEPTION_FIXTURES.length;
    expect(
      rate,
      `Judge agreement ${(rate * 100).toFixed(0)}% (threshold 70%). Misses:\n${misses.join("\n")}`
    ).toBeGreaterThanOrEqual(0.7);
  }, 240_000);
});
