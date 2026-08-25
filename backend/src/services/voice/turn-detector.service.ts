/**
 * Semantic turn-end detection for live voice (Claude-style endpointing).
 *
 * Answers ONE question about the live partial transcript:
 *   "did the user finish their thought, or is this pause mid-sentence?"
 *
 * Two engines, chosen lazily per process:
 *
 *  1. ONNX (preferred) — LiveKit's open turn-detector (Apache-2.0), a tiny
 *     Llama classifier converted for transformers.js by onnx-community
 *     (repo: onnx-community/turn-detector-ONNX). Inference follows LiveKit's
 *     reference method: feed "<|im_start|>user\n…<|im_end|>\n
 *     <|im_start|>assistant\n" and compare the next-token logits of
 *     "Yes" vs "No" — P(Yes) is P(the user finished).
 *     Loaded through @huggingface/transformers ONLY when weights exist
 *     locally (scripts/download-turn-model.mjs) and the optional dependency
 *     is installed. ANY failure degrades permanently to the heuristic.
 *
 *  2. Heuristic (always available) — cheap linguistic analysis tuned for
 *     this product's Arabic-first traffic: light Arabic prefix stripping,
 *     an MSA+Levantine continuation lexicon, terminal-punctuation
 *     fast-paths, and list/enumeration markers.
 *
 * Decision policy when BOTH are available:
 *   verdict.complete = P(Yes) >= threshold  AND  NOT heuristic.dangling
 * The heuristic veto exists because the open models were trained mostly on
 * European languages — on Levantine Arabic their score alone must not cut a
 * sentence that clearly dangles ("...و", "...على", trailing comma).
 */

import fs from "fs";
import path from "path";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("turn-detector");

export type TurnDetectorEngine = "onnx" | "heuristic";

export interface TurnVerdict {
  /** true = the utterance is semantically complete; safe to hand over the turn. */
  complete: boolean;
  /** Model P(complete) ∈ [0,1] when the ONNX engine produced this verdict. */
  probability?: number;
  source: TurnDetectorEngine;
}

export interface TurnDetectorStatus {
  mode: string;
  engine: TurnDetectorEngine | "loading";
  modelLoaded: boolean;
  modelDir: string;
  threshold: number;
}

const MODE = (process.env.VOICE_TURN_DETECTOR || "auto").toLowerCase();
const THRESHOLD = (() => {
  const v = Number(process.env.VOICE_TURN_THRESHOLD);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.5;
})();

const MODEL_DIR =
  process.env.VOICE_TURN_DETECTOR_MODEL_DIR?.trim() ||
  path.resolve(process.cwd(), "models/turn-detector");

/** LiveKit's EOU prompt: transcript as the user turn, assistant reply begun. */
function buildPrompt(transcript: string): string {
  const cleaned = transcript.replace(/\s+/g, " ").trim();
  return `<|im_start|>user\n${cleaned}<|im_end|>\n<|im_start|>assistant\n`;
}

// ---------------------------------------------------------------------------
// ONNX engine (optional)
// ---------------------------------------------------------------------------

interface OnnxDetector {
  completeProbability(transcript: string): Promise<number>;
}

let detectorPromise: Promise<OnnxDetector | null> | null = null;

/**
 * First-token ids for the polarity words across common BPE spellings.
 * The Qwen/Llama tokenizers used by LiveKit models encode each of these as
 * ONE token; we keep every variant found so capitalization can't flip us.
 */
async function resolvePolarityTokenIds(
  tokenizer: unknown,
): Promise<{ yesIds: number[]; noIds: number[] }> {
  const tok = tokenizer as {
    (text: string, opts?: Record<string, unknown>): PromiseLike<{
      input_ids: { data: ArrayLike<bigint> | number[] };
    }>;
  };
  const firstIdOf = async (word: string): Promise<number[]> => {
    const enc = await tok(word, { add_special_tokens: false });
    return Array.from(enc.input_ids.data as ArrayLike<number>).map(Number);
  };
  const collect = async (words: string[]) => {
    const ids: number[] = [];
    for (const w of words) {
      for (const id of await firstIdOf(w)) if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  };
  const yesIds = await collect(["Yes", " Yes"]);
  const noIds = await collect(["No", " No"]);
  return { yesIds, noIds };
}

async function tryLoadOnnxDetector(): Promise<OnnxDetector | null> {
  if (MODE === "heuristic") return null;

  const weightsPath = path.join(MODEL_DIR, "onnx", "model_quantized.onnx");
  const tokenizerPath = path.join(MODEL_DIR, "tokenizer.json");
  if (!fs.existsSync(weightsPath) || !fs.existsSync(tokenizerPath)) {
    log.info("Turn-detector weights not found — using heuristic endpointer", {
      modelDir: MODEL_DIR,
      hint: "run scripts/download-turn-model.mjs to enable the ONNX engine",
    });
    return null;
  }

  try {
    // Optional dependency: absent at runtime → permanent heuristic mode.
    const { env, AutoTokenizer, AutoModelForCausalLM } = await import(
      "@huggingface/transformers"
    );
    env.allowLocalModels = true;

    const startedAt = Date.now();
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(MODEL_DIR),
      // q8 → resolves <MODEL_DIR>/onnx/model_quantized.onnx
      AutoModelForCausalLM.from_pretrained(MODEL_DIR, { dtype: "q8" }),
    ]);
    const { yesIds, noIds } = await resolvePolarityTokenIds(tokenizer);
    if (!yesIds.length || !noIds.length) throw new Error("polarity tokens unresolved");

    log.info("Turn-detector ONNX model loaded", {
      modelDir: MODEL_DIR,
      ms: Date.now() - startedAt,
      threshold: THRESHOLD,
      yesIds,
      noIds,
    });

    return {
      async completeProbability(transcript: string): Promise<number> {
        const enc = await (tokenizer as unknown as (t: string, o?: Record<string, unknown>) => PromiseLike<{
          input_ids: { dims: number[]; data: ArrayLike<bigint> | number[] };
        }>)(buildPrompt(transcript));

        const ids = Array.from(enc.input_ids.data as ArrayLike<number>).map((n) => BigInt(n));
        const seqLen = ids.length;
        const output = await (model as unknown as (o: Record<string, unknown>) => PromiseLike<{
          logits: { dims: number[]; data: Float32Array };
        }>)({ input_ids: ids });

        const [ , , vocab ] = output.logits.dims;
        const rowOffset = (seqLen - 1) * vocab;
        const row = output.logits.data;

        let bestYes = -Infinity;
        for (const id of yesIds) bestYes = Math.max(bestYes, row[rowOffset + id] ?? -Infinity);
        let bestNo = -Infinity;
        for (const id of noIds) bestNo = Math.max(bestNo, row[rowOffset + id] ?? -Infinity);

        // Stable two-way softmax over the Yes/No logits.
        const m = Math.max(bestYes, bestNo);
        const ey = Math.exp(bestYes - m);
        const en = Math.exp(bestNo - m);
        return ey / (ey + en);
      },
    };
  } catch (err) {
    log.warn("Turn-detector ONNX unavailable — falling back to heuristic", {
      error: (err as Error)?.message,
    });
    return null;
  }
}

function getDetector(): Promise<OnnxDetector | null> {
  detectorPromise ??= tryLoadOnnxDetector();
  return detectorPromise;
}

// ---------------------------------------------------------------------------
// Heuristic engine
// ---------------------------------------------------------------------------

/** Strip common Arabic clitics so lexicon matches inflected tokens. */
function normalizeArabicToken(raw: string): string {
  let t = raw.replace(/[\u064B-\u0652\u0670]/g, ""); // harakat
  t = t.replace(/^(وال|فال|بال|كال|لل|ال)/, "");
  t = t.replace(/^[وفبكس]/, "");
  t = t.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة$/g, "ه");
  return t;
}

const CONTINUATION_STEMS = new Set([
  // MSA + Levantine connectors / prepositions / relatives / auxiliaries
  "و","او","في","من","الى","على","عن","ان","لكن","ثم","مع","هذا","هذه",
  "التي","الذي","كل","بين","بعد","قبل","حتى","اذا","كما","لان","عندما",
  "هل","ليش","كيف","وين","متى","شو","ايش","ايمتى","يعني","زي","متل","لما",
  "بس","برضو","كمان","يع","يا","لا","ولا","ام","بل","اذن","لكي","كي",
  "منشان","عشان","ضل","عم","رح","بد","الي","يلي","هيدا","هاي","هدول",
  // English
  "the","a","an","and","or","but","so","if","of","to","in","on","with","for",
  "which","who","that","because","when","while","before","after","then","is",
  "are","was","were","my","our","your","their","its","this","these","those",
  "there","here","it","as","by","from","at","than","also","just","like",
]);

/** Utterance ends mid-enumeration: "أولًا..", "ثانيًا..", trailing dash. */
function endsMidEnumeration(trimmed: string): boolean {
  if (/[-–—]$/.test(trimmed)) return true;
  const last = trimmed.split(/\s+/).pop() ?? "";
  return /^(اولا?|ثانيا?|ثالثا?|رابعا?|خامسا?|[٠-٩0-9]+[.)]?)$/.test(
    last.replace(/^و/, ""),
  );
}

/**
 * Cheap heuristic verdict. `dangling` marks STRONG incompleteness — used as a
 * veto against the ONNX engine on languages it was not trained for.
 */
function heuristicVerdict(text: string): { complete: boolean; dangling: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { complete: false, dangling: false };

  // Terminal punctuation is the strongest completion signal we have
  // (Deepgram smart_format already punctuates finals).
  if (/[.!?؟…]$/.test(trimmed)) return { complete: true, dangling: false };

  // Clearly unfinished: dangling clause punctuation or enumeration marker.
  if (/[:،,؛;]$/.test(trimmed)) return { complete: false, dangling: true };
  if (endsMidEnumeration(trimmed)) return { complete: false, dangling: true };

  const words = trimmed.split(/\s+/);
  const lastRaw = words[words.length - 1] ?? "";
  const stem = normalizeArabicToken(lastRaw.toLowerCase());
  if (CONTINUATION_STEMS.has(stem) || CONTINUATION_STEMS.has(lastRaw.toLowerCase())) {
    return { complete: false, dangling: true };
  }

  // Nothing signals either way — lean complete (silence timers still gate).
  return { complete: true, dangling: false };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function judgeUtterance(text: string): Promise<TurnVerdict> {
  const heuristic = heuristicVerdict(text);

  const detector = await getDetector();
  if (!detector) {
    return { complete: heuristic.complete, source: "heuristic" };
  }
  try {
    const probability = await detector.completeProbability(text);
    return {
      complete: probability >= THRESHOLD && !heuristic.dangling,
      probability,
      source: "onnx",
    };
  } catch (err) {
    log.warn("ONNX inference failed — heuristic verdict returned", {
      error: (err as Error)?.message,
    });
    return { complete: heuristic.complete, source: "heuristic" };
  }
}

export async function getTurnDetectorStatus(): Promise<TurnDetectorStatus> {
  const detector = await getDetector();
  return {
    mode: MODE,
    engine: detector ? "onnx" : "heuristic",
    modelLoaded: !!detector,
    modelDir: MODEL_DIR,
    threshold: THRESHOLD,
  };
}
