// Rewrites the user query before embedding via heuristics (direct, contextualized, expanded, HyDE).

import { createLogger } from "../../utils/logger.js";
import type { IntentResult } from "./intent-detector.js";
import { UserIntent } from "./intent-detector.js";

const log = createLogger("query-rewriter");

// Query rewrite result type

export interface RewrittenQuery {
  original: string;
  rewritten: string;
  strategy: "direct" | "contextualized" | "hyde" | "expanded";
}

// Arabic academic term expansion map

const EXPANSION_MAP: Record<string, string> = {
  "تسجيل": "تسجيل المواد registration enrollment",
  "معدل": "معدل تراكمي GPA cumulative average",
  "تخرج": "تخرج graduation graduate",
  "قبول": "قبول قبول جامعي admission",
  "منحة": "منحة scholarship منح دراسية",
  "رسوم": "رسوم جامعية tuition fees الرسوم",
  "سكن": "سكن جامعي housing dormitory سكن طلابي",
  "مكتبة": "مكتبة جامعية library",
  "امتحان": "امتحان اختبار exam test",
  "محاضرة": "محاضرة lecture درس",
  "مختبر": "مختبر مختبرات lab laboratory",
  "نظام": "نظام جامعي system regulations",
  "لوائح": "لوائح regulations policies",
  "دراسات عليا": "دراسات عليا graduate studies ماجستير دكتوراه",
  "بكالوريوس": "بكالوريوس bachelor undergraduate",
  "موازي": "برنامج موازي parallel program",
  "عام": "برنامج عام regular program",
  "تأديب": "نظام تأديبي disciplinary",
  "تدريب": "تدريب عملي training internship",
  "بحث علمي": "بحث علمي scientific research",
  "كلية": "كلية faculty college",
  "قسم": "قسم department",
  "تقويم": "تقويم جامعي academic calendar",
  "فصل دراسي": "فصل دراسي semester",
  "صيفي": "فصل صيفي summer semester",
  "إرشاد": "إرشاد أكاديمي academic advising",
  "ساعات": "ساعات معتمدة credit hours",
};

// Helpers

function expandArabicTerms(text: string): string {
  let expanded = text;
  const addedParts: string[] = [];

  for (const [term, expansion] of Object.entries(EXPANSION_MAP)) {
    if (expanded.includes(term)) {
      addedParts.push(expansion);
    }
  }

  if (addedParts.length > 0) {
    // Append unique expansions that aren't already in the text
    const uniqueExpansions = [...new Set(addedParts)].filter(
      (e) => !expanded.includes(e.split(" ")[0]) || !expanded.includes(e),
    );
    if (uniqueExpansions.length > 0) {
      expanded = `${expanded} ${uniqueExpansions.join(" ")}`;
    }
  }

  return expanded;
}

function buildHydeSnippet(topic: string): string {
  // HyDE: build a hypothetical answer snippet whose embedding matches stored documents better.
  const cleanTopic = topic.replace(/[?؟]/g, "").trim();
  return `Document about: ${cleanTopic} at Jordan University of Science and Technology (JUST). This document provides detailed information regarding ${cleanTopic}, including relevant regulations, procedures, and academic guidelines for students at JUST.`;
}

// Main rewrite function

export function rewriteQuery(
  userMessage: string,
  recentMessages: { role: string; content?: string }[],
  intent: IntentResult,
): RewrittenQuery {
  const msg = (userMessage ?? "").trim();
  const msgLen = msg.length;
  const isQuestion = /[?؟]/.test(msg) || /^(what|how|why|where|when|who|which|ما|كيف|لماذا|أين|متى|هل|من|ماذا|كم)/i.test(msg);

  // Strategy selection

  // 1. HyDE for knowledge queries (best semantic match)
  if (
    intent.intent === UserIntent.KNOWLEDGE_QUERY &&
    intent.confidence >= 0.7 &&
    msgLen > 10
  ) {
    const hydeText = buildHydeSnippet(msg);
    log.info("Query rewrite strategy: hyde", {
      original: msg.substring(0, 60),
      rewrittenLen: hydeText.length,
    });
    return {
      original: msg,
      rewritten: hydeText,
      strategy: "hyde",
    };
  }

  // 2. Contextualized for follow-ups
  if (intent.intent === UserIntent.FOLLOW_UP) {
    let contextSnippet = "";
    if (recentMessages.length >= 2) {
      const prevAssistant = recentMessages[recentMessages.length - 2];
      if (prevAssistant?.role === "assistant" && typeof prevAssistant.content === "string") {
        // Take the first 200 chars of the assistant's response as context
        contextSnippet = prevAssistant.content.substring(0, 200);
      }
    }

    const rewritten = contextSnippet
      ? `Context: ${contextSnippet}... Query: ${msg}`
      : msg;

    log.info("Query rewrite strategy: contextualized", {
      hasContext: !!contextSnippet,
      original: msg.substring(0, 60),
    });

    return {
      original: msg,
      rewritten,
      strategy: "contextualized",
    };
  }

  // 3. Expanded for short knowledge queries with Arabic academic terms
  if (msgLen < 80 && intent.intent === UserIntent.KNOWLEDGE_QUERY) {
    const expanded = expandArabicTerms(msg);
    const wasExpanded = expanded !== msg;

    if (wasExpanded) {
      log.info("Query rewrite strategy: expanded", {
        original: msg.substring(0, 60),
        expandedLen: expanded.length,
      });
      return {
        original: msg,
        rewritten: expanded,
        strategy: "expanded",
      };
    }
  }

  // 4. Direct — message is clear and self-contained
  if (msgLen > 50 && isQuestion) {
    log.info("Query rewrite strategy: direct (long question)", {
      msgLen,
    });
    return {
      original: msg,
      rewritten: msg,
      strategy: "direct",
    };
  }

  // 5. Fallback — still try expansion for anything that has Arabic terms
  const expanded = expandArabicTerms(msg);
  const wasExpanded = expanded !== msg;

  if (wasExpanded) {
    log.info("Query rewrite strategy: expanded (fallback)", {
      original: msg.substring(0, 60),
    });
    return {
      original: msg,
      rewritten: expanded,
      strategy: "expanded",
    };
  }

  // 6. Final fallback — pass through as-is
  log.info("Query rewrite strategy: direct (passthrough)", {
    msgLen,
  });
  return {
    original: msg,
    rewritten: msg,
    strategy: "direct",
  };
}
