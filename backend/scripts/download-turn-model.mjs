#!/usr/bin/env node
/**
 * Download the open turn-detector weights (Apache-2.0) into the local layout
 * expected by services/voice/turn-detector.service.ts:
 *
 *   models/turn-detector/
 *     config.json  tokenizer.json  tokenizer_config.json
 *     special_tokens_map.json  vocab.json  merges.txt  added_tokens.json
 *     onnx/model_quantized.onnx          ← q8, ~30 MB, what we load
 *
 * Source: onnx-community/turn-detector-ONNX — the transformers.js-ready
 * conversion of LiveKit's turn-detector. Arabic is NOT among its training
 * languages; the service's heuristic veto covers that (see service header).
 *
 * Usage:  node scripts/download-turn-model.mjs [--fp32]
 *   --fp32 also fetches onnx/model.onnx (~10x larger) for max accuracy.
 */

import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { fileURLToPath } from "url";

const REPO = "onnx-community/turn-detector-ONNX";
const BASE = `https://huggingface.co/${REPO}/resolve/main`;
const ROOT_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "vocab.json",
  "merges.txt",
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../models/turn-detector");
const ONNX_DIR = path.join(OUT_DIR, "onnx");

/** Stream one HF file to disk; returns bytes written or null on 404. */
async function fetchTo(remoteFile, destFile) {
  const url = `${BASE}/${remoteFile}`;
  const res = await fetch(url, { redirect: "follow" });
  if (res.status === 404) {
    console.warn(`  ! missing upstream (skipped): ${remoteFile}`);
    return null;
  }
  if (!res.ok || !res.body) {
    throw new Error(`${res.status} ${res.statusText} while fetching ${url}`);
  }
  await fs.promises.mkdir(path.dirname(destFile), { recursive: true });
  const tmp = destFile + ".part";
  const out = fs.createWriteStream(tmp);
  // fetch() returns a WHATWG stream — wrap it for .pipe()
  const nodeStream = Readable.fromWeb(res.body);
  await new Promise((resolve, reject) => {
    nodeStream.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolve);
    nodeStream.pipe(out);
  });
  await fs.promises.rename(tmp, destFile);
  const { size } = fs.statSync(destFile);
  console.log(`  ✓ ${remoteFile} → ${path.relative(process.cwd(), destFile)} (${(size / 1e6).toFixed(1)} MB)`);
  return size;
}

async function main() {
  console.log(`Downloading turn-detector from ${REPO}`);
  console.log(`Destination: ${OUT_DIR}\n`);

  for (const file of ROOT_FILES) {
    await fetchTo(file, path.join(OUT_DIR, path.basename(file)));
  }

  const quantized = await fetchTo("onnx/model_quantized.onnx", path.join(ONNX_DIR, "model_quantized.onnx"));
  if (!quantized) throw new Error("model_quantized.onnx not found in the repo — cannot continue");

  if (process.argv.includes("--fp32")) {
    await fetchTo("onnx/model.onnx", path.join(ONNX_DIR, "model.onnx"));
  }

  // Sanity check: tokenizer must exist or the loader will never engage.
  if (!fs.existsSync(path.join(OUT_DIR, "tokenizer.json"))) {
    throw new Error("tokenizer.json missing after download — aborting");
  }

  console.log("\nDone. The backend picks the model up on next restart");
  console.log("(VOICE_TURN_DETECTOR=auto|onnx enables it; default auto).");
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
