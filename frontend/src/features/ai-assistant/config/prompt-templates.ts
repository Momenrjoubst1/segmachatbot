import type { LucideIcon } from "lucide-react";
import {
  BookOpenIcon,
  BrainIcon,
  ClipboardListIcon,
  CodeIcon,
  GraduationCapIcon,
  LanguagesIcon,
  LightbulbIcon,
  ListChecksIcon,
  PenLineIcon,
  SparklesIcon,
} from "lucide-react";

/**
 * Prompt templates surfaced by the "/" trigger in the chat composer,
 * Claude-AI style: type "/" → pick a template → its prompt fills the box.
 */
export interface PromptTemplate {
  /** Used as the slash-command id and trigger-item id (e.g. "/quiz-me"). */
  id: string;
  label: string;
  description: string;
  prompt: string;
  icon: LucideIcon;
}

export const PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  {
    id: "explain-simply",
    label: "Explain simply",
    description: "Break a hard topic down like I'm new to it",
    prompt:
      "Explain this topic in simple terms, step by step, with a real-world example at the end:\n\n",
    icon: LightbulbIcon,
  },
  {
    id: "quiz-me",
    label: "Quiz me",
    description: "Test my understanding with practice questions",
    prompt:
      "Create a quiz on this topic with 5 questions (mix of multiple choice and short answer), then wait for my answers before revealing solutions:\n\n",
    icon: ListChecksIcon,
  },
  {
    id: "summarize",
    label: "Summarize",
    description: "Condense long text into key points",
    prompt:
      "Summarize the following into clear bullet points, then list the 3 most important takeaways:\n\n",
    icon: ClipboardListIcon,
  },
  {
    id: "study-plan",
    label: "Study plan",
    description: "A day-by-day plan for an exam or goal",
    prompt:
      "Build me a study plan for this subject/goal. Include daily sessions, topics per session, and quick self-check questions:\n\n",
    icon: GraduationCapIcon,
  },
  {
    id: "flashcards",
    label: "Make flashcards",
    description: "Turn material into question/answer pairs",
    prompt:
      "Turn the following material into flashcards as a numbered list of Q/A pairs, ordered from easiest to hardest:\n\n",
    icon: BrainIcon,
  },
  {
    id: "solve-step-by-step",
    label: "Solve step by step",
    description: "Work through a problem with full reasoning",
    prompt:
      "Solve this problem showing every step of the reasoning, then verify the final answer:\n\n",
    icon: BookOpenIcon,
  },
  {
    id: "fix-writing",
    label: "Fix my writing",
    description: "Grammar, clarity, and tone improvements",
    prompt:
      "Improve this text: fix grammar and clarity, keep my voice, and show the corrected version followed by a short list of what you changed:\n\n",
    icon: PenLineIcon,
  },
  {
    id: "translate",
    label: "Translate",
    description: "Translate while preserving meaning and tone",
    prompt:
      "Translate the following to English. Keep the tone and meaning exact, then note any untranslatable expressions:\n\n",
    icon: LanguagesIcon,
  },
  {
    id: "code-help",
    label: "Code help",
    description: "Debug or explain a code snippet",
    prompt:
      "Review this code: explain what it does, find bugs or issues, and suggest an improved version with comments:\n\n",
    icon: CodeIcon,
  },
  {
    id: "brainstorm",
    label: "Brainstorm ideas",
    description: "Generate creative options fast",
    prompt:
      "Brainstorm 10 ideas for the following, grouped by theme, with one-line pros/cons for each:\n\n",
    icon: SparklesIcon,
  },
] as const;
