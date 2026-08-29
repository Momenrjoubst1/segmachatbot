// Tutor-mode pedagogy layer.
//
// The base persona historically modeled "answer-first" teaching (full solutions
// handed over immediately). This layer flips the behavior for explicit study
// requests only — ordinary factual questions must stay direct:
//   "socratic" — the student asked to be TAUGHT (علمني / teach me / مش فاهم).
//   "guided"   — the student asked for a problem to be SOLVED (حل لي / solve).
//                Show the method, hand the final step back to the student.
// Everything is injected into the system prompt for the current turn only.

export type TutorMode = "socratic" | "guided";
export type DetectedTutorMode = TutorMode | null;

const SOCRATIC_CUES = [
  "علمني",
  "علّمني",
  "فهمني",
  "درّبني",
  "دربني",
  "اشرح لي",
  "أشرح لي",
  "ما فهمت",
  "مش فاهم",
  "مو فاهم",
  "ما بعرف كيف",
  "ساعدني أفهم",
  "بدي أفهم",
  "teach me",
  "help me understand",
  "explain to me",
  "walk me through",
  "i don't understand",
  "i do not understand",
  "dont understand",
  "make me understand",
  "help me learn",
];

const GUIDED_CUES = [
  "حل لي",
  "حلّ لي",
  "حلي لي",
  "حل السؤال",
  "حل هذا",
  "ساعدني بحل",
  "كيف أحل",
  "كيف احل",
  "طريقة حل",
  "solve this",
  "solve the",
  "solve for",
  "help me solve",
  "how do i solve",
  "how to solve",
];

function matchesAny(text: string, cues: string[]): boolean {
  const lower = text.toLowerCase();
  return cues.some((cue) => lower.includes(cue));
}

/**
 * Detect an explicit study/teaching request. Returns null for ordinary
 * questions so the tutor layer never degrades quick factual answers.
 */
export function detectTutorMode(userText: string): DetectedTutorMode {
  const text = (userText ?? "").trim();
  if (text.length < 4) return null;
  if (matchesAny(text, SOCRATIC_CUES)) return "socratic";
  if (matchesAny(text, GUIDED_CUES)) return "guided";
  return null;
}

// Shared rules for both modes.
const COMMON_RULES = `
- Reply in the same language the student used.
- Work on ONE concept (or ONE question) at a time — never dump everything at once.
- Keep every turn short: explain, then let the student act.
- After TWO unsuccessful attempts, stop hinting and give the complete, clear explanation — never dead-end the student.
- End the session turn with a quick comprehension check the student can answer in one line.`;

const SOCRATIC_INSTRUCTION = `
## Tutor Mode — Active (Socratic)

The student explicitly asked you to TEACH them. Follow this protocol:

1. **Probe first (one short message):** ask what they already know about the topic, or pose a tiny warm-up question. Do not lecture yet.
2. **Hint ladder, never answer-first:** when the student is stuck, escalate gently:
   a. a nudge in the right direction,
   b. a stronger hint,
   c. a fully worked PARALLEL example (different numbers/context),
   d. only then the actual full solution.
3. **Check understanding:** after each explanation, ask one short question that proves they got it.
4. **Record progress:** whenever you evaluate one of the student's answers as correct or incorrect, call the record_quiz_result tool with the topic.
${COMMON_RULES}
Exception: a pure factual one-liner (a definition, a date, a name) may be answered directly — then ask a check question.`;

const GUIDED_INSTRUCTION = `
## Tutor Mode — Active (Guided Solving)

The student asked you to SOLVE a problem. Do homework WITH them, not for them:

1. **Method first:** restate what is being asked in one line, then list the solution plan (the steps) before doing any math/writing.
2. **Work the early steps:** carry out the first steps completely, showing your reasoning.
3. **Hand over the final step:** stop before the last step and ask the student to complete it themselves.
4. **Confirm:** when they attempt it, check their result. If they finish correctly, offer a slightly harder variant. If they cannot finish after TWO attempts, complete it fully and explain where they struggled.
5. **Record progress:** after evaluating the student's attempt, call the record_quiz_result tool with the topic.
${COMMON_RULES}`;

/** Build the system-prompt instruction block for the detected tutor mode. */
export function buildTutorModeInstruction(mode: TutorMode): string {
  return (mode === "socratic" ? SOCRATIC_INSTRUCTION : GUIDED_INSTRUCTION).trim();
}
