// Heuristic intent detection for chat messages — no LLM calls; decides RAG and tool needs.

import { createLogger } from "../../utils/logger.js";

const log = createLogger("intent-detector");

// Intent and result types.

export enum UserIntent {
  KNOWLEDGE_QUERY = "knowledge_query",
  TOOL_REQUEST = "tool_request",
  SMALL_TALK = "small_talk",
  FOLLOW_UP = "follow_up",
  PERSONAL_QUERY = "personal_query",
}

export interface IntentResult {
  intent: UserIntent;
  confidence: number; // 0-1
  needsRAG: boolean;
  needsTools: boolean;
  suggestedQuery?: string; // Rewritten query for RAG
}

// Keyword sets per intent.

const TOOL_KEYWORDS_AR = [
  "أرسل", "ارسل", "ابعث", "ابعت", "بعث",
  "أنشئ", "انشئ", "أضف", "اضف",
  "احسب", "حاسبة",
  "ابحث", "بحث",
  "جدول", "فعالية", "حدث",
  "إيميل", "ايميل", "بريد",
  "مهمة", "مهام", "تذكير", "موعد", "التقويم",
] as const;

const TOOL_KEYWORDS_EN = [
  "send", "email", "compose",
  "create", "make", "add",
  "calculate", "compute",
  "search", "find", "look up",
  "event", "calendar", "schedule",
  "task", "todo", "to-do", "reminder", "appointment", "meeting",
] as const;

const SMALL_TALK_PATTERNS_AR = [
  /^(مرحبا?|أهلا?|هلا|سلام|السلام عليكم)[\s!!.،]*$/u,
  /^(شكرا?|شكراً|مشكور|يعطيك العافية)[\s!!.،]*$/u,
  // Only match standalone greetings — require end of string or punctuation only
  /^(كيف حالك|كيفك|شلونك|شخبارك|ايش أخبارك)([\s!.،?؟]*|[؟!]?)$/u,
  /^(أهلا وسهلا|حياك الله)[\s!!.،]*$/u,
] as const;

const SMALL_TALK_PATTERNS_EN = [
  /^(hi|hello|hey|greetings|good\s*(morning|afternoon|evening))[\s!!.]*$/i,
  /^(thanks|thank\s*you|thx|ty|appreciate\s*it)[\s!!.]*$/i,
  // Only match standalone greetings
  /^(how\s*are\s*you|how'?s\s*it\s*going|what'?s\s*up|sup)([\s!.?]*|[?!]?)$/i,
  /^(bye|goodbye|see\s*ya|later|take\s*care)[\s!!.]*$/i,
] as const;

const FOLLOW_UP_PREFIXES_AR = [
  // Only interrogative follow-up phrases — bare "و" over-matched.
  "وماذا", "ماذا عن", "وكيف", "ولماذا", "وأين", "ومتى",
  "وهل", "وطيب", "وزين", "وما هو", "وما هي",
] as const;

const FOLLOW_UP_PREFIXES_EN = [
  "what about", "how about", "and what", "and how", "and why",
  "and where", "and when", "also", "more on",
] as const;

const PERSONAL_KEYWORDS_AR = [
  "مواد", "مادتي", "جدولي", "جدولي الدراسي",
  "علاماتي", "درجاتي", "معدلي",
  "تسجيلي", "موادي", "فصلي",
  "مهامي", "مهماتي", "قائمة مهامي",
] as const;

const PERSONAL_KEYWORDS_EN = [
  "my courses", "my schedule", "my grades", "my gpa",
  "my classes", "my subjects", "my enrollment",
  "my tasks", "my todos", "my to-dos", "task list",
] as const;

const QUESTION_INDICATORS_AR = [
  "ما", "ماذا", "كيف", "لماذا", "أين", "متى", "هل", "من",
  "كم", "أي",
] as const;

const QUESTION_INDICATORS_EN = [
  "what", "how", "why", "where", "when", "who", "which",
  "can", "is", "are", "does", "do", "will", "would",
] as const;

// Normalises Arabic text (removes tatweel, unifies alef/ya).

function normaliseArabic(text: string): string {
  return text
    .replace(/[\u0640]/g, "")       // remove tatweel
    .replace(/[أإآا]/g, "ا")        // normalise alef
    .replace(/ة/g, "ه")             // taa marbuta → haa
    .replace(/ى/g, "ي")             // alef maqsura → ya
    .trim();
}

// Scoring helpers for keyword, prefix, and pattern matching.

function containsAny(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();
  const normalAr = normaliseArabic(text);
  return keywords.some((kw) => {
    const normKw = normaliseArabic(kw);
    return lower.includes(kw.toLowerCase()) || normalAr.includes(normKw);
  });
}

function startsWithAny(text: string, prefixes: readonly string[]): boolean {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const normalAr = normaliseArabic(trimmed);
  return prefixes.some((p) => {
    const normP = normaliseArabic(p);
    return lower.startsWith(p.toLowerCase()) || normalAr.startsWith(normP);
  });
}

function matchesAnyPattern(
  text: string,
  patterns: readonly RegExp[],
): boolean {
  const trimmed = text.trim();
  return patterns.some((pat) => pat.test(trimmed));
}

function isQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  const normalAr = normaliseArabic(text);
  // Explicit question mark
  if (/[?؟]/.test(text)) return true;
  // Starts with question word
  return (
    QUESTION_INDICATORS_EN.some((w) => lower.startsWith(w + " ")) ||
    QUESTION_INDICATORS_AR.some((w) => normalAr.startsWith(normaliseArabic(w) + " ") || normalAr.startsWith(normaliseArabic(w)))
  );
}

// Main heuristic detection function.

export async function detectIntent(
  userMessage: string,
  recentMessages: { role: string; content?: string }[],
  _options?: { userId?: string },
): Promise<IntentResult> {
  const msg = (userMessage ?? "").trim();
  const msgLen = msg.length;

  // Detect small talk (short greetings and thanks).
  if (msgLen < 40 && matchesAnyPattern(msg, SMALL_TALK_PATTERNS_AR)) {
    log.info("Intent detected: SMALL_TALK (Ar pattern)", { msg: msg.substring(0, 60) });
    return {
      intent: UserIntent.SMALL_TALK,
      confidence: 0.92,
      needsRAG: false,
      needsTools: false,
    };
  }
  if (msgLen < 40 && matchesAnyPattern(msg, SMALL_TALK_PATTERNS_EN)) {
    log.info("Intent detected: SMALL_TALK (En pattern)", { msg: msg.substring(0, 60) });
    return {
      intent: UserIntent.SMALL_TALK,
      confidence: 0.92,
      needsRAG: false,
      needsTools: false,
    };
  }

  // Detect tool requests by keyword match.
  if (containsAny(msg, TOOL_KEYWORDS_AR) || containsAny(msg, TOOL_KEYWORDS_EN)) {
    // Tool keywords plus an academic question: lean TOOL_REQUEST but enable RAG.
    const alsoQuestion = isQuestion(msg);
    const confidence = alsoQuestion ? 0.65 : 0.88;

    log.info("Intent detected: TOOL_REQUEST", {
      alsoQuestion,
      confidence,
      msg: msg.substring(0, 60),
    });

    return {
      intent: UserIntent.TOOL_REQUEST,
      confidence,
      needsRAG: alsoQuestion, // RAG helps when tool + knowledge overlap
      needsTools: true,
    };
  }

  // Detect personal queries about the user's own data.
  if (containsAny(msg, PERSONAL_KEYWORDS_AR) || containsAny(msg, PERSONAL_KEYWORDS_EN)) {
    log.info("Intent detected: PERSONAL_QUERY", { msg: msg.substring(0, 60) });
    return {
      intent: UserIntent.PERSONAL_QUERY,
      confidence: 0.85,
      needsRAG: false, // Personal data comes from DB, not RAG
      needsTools: true, // May need calendar / email tools
    };
  }

  // Detect follow-ups on the previous assistant answer.
  const hasRecentAssistant =
    recentMessages.length >= 2 &&
    recentMessages[recentMessages.length - 2]?.role === "assistant";

  const isFollowUpPrefix =
    startsWithAny(msg, FOLLOW_UP_PREFIXES_AR) ||
    startsWithAny(msg, FOLLOW_UP_PREFIXES_EN);

  // Very short message (< 15 chars) after an assistant reply → likely follow-up
  const shortFollowUp = msgLen < 15 && hasRecentAssistant;

  if (isFollowUpPrefix || shortFollowUp) {
    const confidence = isFollowUpPrefix ? 0.82 : 0.6;

    // Follow-ups need RAG if the previous conversation was knowledge-based
    const prevAssistantMsg = hasRecentAssistant
      ? (recentMessages[recentMessages.length - 2]?.content ?? "")
      : "";
    const prevLooksKnowledge =
      prevAssistantMsg.length > 100 || /المصادر|Sources|📄|Source/.test(prevAssistantMsg);

    log.info("Intent detected: FOLLOW_UP", {
      isFollowUpPrefix,
      shortFollowUp,
      prevLooksKnowledge,
      confidence,
      msg: msg.substring(0, 60),
    });

    return {
      intent: UserIntent.FOLLOW_UP,
      confidence,
      needsRAG: prevLooksKnowledge,
      needsTools: false,
    };
  }

  // Default: knowledge query about university/academic content.
  const isQ = isQuestion(msg);
  const confidence = isQ ? 0.78 : 0.55;

  log.info("Intent detected: KNOWLEDGE_QUERY", {
    isQ,
    confidence,
    msgLen,
  });

  return {
    intent: UserIntent.KNOWLEDGE_QUERY,
    confidence,
    needsRAG: true,
    needsTools: false,
  };
}
