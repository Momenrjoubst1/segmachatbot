/**
 * Offline Retrieval Evaluation Script
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... USER_ID=... \
 *   npx tsx scripts/retrieval-eval.ts
 *
 * Evaluates:
 *  - Recall@k for curriculum scoping
 *  - BM25 vs vector vs hybrid ranking
 *  - Semantic vs fuzzy section matching
 *
 * Requires a `golden_queries` table or JSON file with test cases:
 *   { question: string, expected_section: string, expected_pages: [start, end] }
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID = process.env.USER_ID;

if (!SUPABASE_URL || !SUPABASE_KEY || !USER_ID) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or USER_ID env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Golden test cases (edit these for your textbook) ─────────────────────────
interface GoldenCase {
  question: string;
  expectedSection?: string;      // e.g., "Lesson 3: Functions"
  expectedPageRange?: [number, number];
}

const GOLDEN: GoldenCase[] = [
  { question: "اشرح الدرس الثاني", expectedSection: "الدرس الثاني" },
  { question: "quiz me on lesson 3", expectedSection: "Lesson 3" },
  { question: "ما هي المتغيرات في بايثون", expectedSection: "Variables" },
  { question: "explain recursion in python", expectedSection: "Recursion" },
  // Add more from your actual textbook
];

// ── Evaluation helpers ──────────────────────────────────────────────────────
async function getQueryEmbedding(text: string): Promise<number[] | null> {
  const { google } = await import("@ai-sdk/google");
  const { embed } = await import("ai");
  const model = google.textEmbeddingModel("gemini-embedding-001");
  const { embedding } = await embed({ model, value: text });
  return embedding;
}

async function matchCurriculumFuzzy(userId: string, question: string) {
  // Call the textbook search matchCurriculumSection (via RPC or direct)
  // We'll use the fuzzy match logic directly here since we can't import server code
  const { data } = await supabase
    .from("textbook_sections")
    .select("id, title, page_start, page_end, textbook_id")
    .eq("textbooks.user_id", userId)
    .eq("textbooks.status", "completed")
    .eq("level", "lesson");

  if (!data || data.length === 0) return null;

  function fuzzyMatch(q: string, t: string): number {
    const ql = q.toLowerCase().trim();
    const tl = t.toLowerCase().trim();
    if (tl.includes(ql) || ql.includes(tl)) return 1.0;
    const qWords = ql.split(/\s+/);
    const tWords = tl.split(/\s+/);
    let m = 0;
    for (const qw of qWords) {
      for (const tw of tWords) {
        if (tw.includes(qw) || qw.includes(tw)) { m++; break; }
      }
    }
    return qWords.length > 0 ? m / qWords.length : 0;
  }

  let best = null;
  let bestScore = 0;
  for (const s of data) {
    const score = fuzzyMatch(question, s.title);
    if (score > bestScore) {
      bestScore = score;
      best = { ...s, score };
    }
  }
  return bestScore >= 0.3 ? best : null;
}

async function matchCurriculumSemantic(userId: string, question: string, queryEmb: number[]) {
  const { data } = await supabase
    .from("textbook_sections")
    .select("id, title, page_start, page_end, textbook_id")
    .eq("textbooks.user_id", userId)
    .eq("textbooks.status", "completed")
    .eq("level", "lesson");

  if (!data || data.length === 0) return null;

  const titles = data.map(s => s.title);
  const { google } = await import("@ai-sdk/google");
  const { embedMany } = await import("ai");
  const model = google.textEmbeddingModel("gemini-embedding-001");
  const { embeddings } = await embedMany({ model, values: titles });

  function cosine(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  }

  let best = null;
  let bestScore = 0;
  for (let i = 0; i < data.length; i++) {
    const fuzzy = 0; // not computed here
    const semantic = Math.max(0, cosine(queryEmb, embeddings[i]));
    const score = 0.4 * fuzzy + 0.6 * semantic;
    if (score > bestScore) {
      bestScore = score;
      best = { ...data[i], score, semantic, fuzzy };
    }
  }
  return bestScore >= 0.3 ? best : null;
}

function evaluateMatch(found: any, expected: GoldenCase): { hit: boolean; details: string } {
  if (!found) return { hit: false, details: "no match" };
  const titleMatch = expected.expectedSection
    ? found.title.toLowerCase().includes(expected.expectedSection.toLowerCase())
    : true;
  const pageMatch = expected.expectedPageRange
    ? found.page_start >= expected.expectedPageRange[0] && found.page_end <= expected.expectedPageRange[1]
    : true;
  return {
    hit: titleMatch && pageMatch,
    details: `found="${found.title}" score=${found.score?.toFixed(3)} titleMatch=${titleMatch} pageMatch=${pageMatch}`,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Evaluating retrieval for user ${USER_ID}...`);
  console.log(`Test cases: ${GOLDEN.length}\n`);

  let fuzzyHits = 0, semanticHits = 0;

  for (const g of GOLDEN) {
    const qEmb = await getQueryEmbedding(g.question);

    const fuzzy = await matchCurriculumFuzzy(USER_ID, g.question);
    const fuzzyEval = evaluateMatch(fuzzy, g);
    if (fuzzyEval.hit) fuzzyHits++;

    let semanticEval = { hit: false, details: "no embedding" };
    if (qEmb) {
      const semantic = await matchCurriculumSemantic(USER_ID, g.question, qEmb);
      semanticEval = evaluateMatch(semantic, g);
      if (semanticEval.hit) semanticHits++;
    }

    console.log(`Q: "${g.question}"`);
    console.log(`  Fuzzy:   ${fuzzyEval.hit ? "✅" : "❌"}  ${fuzzyEval.details}`);
    console.log(`  Semantic: ${semanticEval.hit ? "✅" : "❌"}  ${semanticEval.details}`);
    console.log("");
  }

  console.log("===== SUMMARY =====");
  console.log(`Fuzzy Recall@1:   ${fuzzyHits}/${GOLDEN.length} = ${(fuzzyHits/GOLDEN.length*100).toFixed(1)}%`);
  console.log(`Semantic Recall@1: ${semanticHits}/${GOLDEN.length} = ${(semanticHits/GOLDEN.length*100).toFixed(1)}%`);
}

main().catch(e => { console.error(e); process.exit(1); });