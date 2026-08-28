// Live media-path probe (video_url acceptance + Gemini staging) — run from backend/: npx tsx scripts/media-probe.mts
import "dotenv/config";
import fs from "fs";
import crypto from "crypto";

const SAMPLE_PATH = process.env.PROBE_SAMPLE_PATH || "/tmp/probe-sample.mp4";
const SAMPLE_URL = "https://download.samplelib.com/mp4/sample-5s.mp4";

async function downloadSample(): Promise<Buffer> {
  if (fs.existsSync(SAMPLE_PATH) && fs.statSync(SAMPLE_PATH).size > 100_000) {
    return fs.readFileSync(SAMPLE_PATH);
  }
  console.log(`Downloading sample video → ${SAMPLE_PATH}`);
  const res = await fetch(SAMPLE_URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`sample download failed (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(SAMPLE_PATH, bytes);
  return bytes;
}

// OpenRouter video_url acceptance probes.

interface ORResult {
  variant: string;
  ok: boolean;
  detail: string;
}

async function probeOpenRouter(model: string, content: unknown[], variant: string): Promise<ORResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { variant, ok: false, detail: "OPENROUTER_API_KEY missing" };

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.FRONTEND_URL || "http://localhost:5173",
        "X-Title": "media-probe",
      },
      body: JSON.stringify({
        model,
        max_tokens: 32,
        messages: [{
          role: "user",
          content: [
            ...(content as object[]),
            { type: "text", text: "Reply with exactly: OK" },
          ],
        }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const bodyText = await res.text();
    if (res.ok) {
      let snippet = "";
      try {
        const json = JSON.parse(bodyText) as { choices?: Array<{ message?: { content?: string } }> };
        snippet = json.choices?.[0]?.message?.content?.slice(0, 40) ?? "(empty)";
      } catch { snippet = bodyText.slice(0, 80); }
      return { variant, ok: true, detail: `200 — model replied "${snippet}"` };
    }
    return { variant, ok: false, detail: `${res.status} — ${bodyText.slice(0, 220)}` };
  } catch (err) {
    return { variant, ok: false, detail: `request failed: ${(err as Error).message}` };
  }
}

// Gemini Files API staging probe over the real R2 upload path.

async function probeGeminiStaging(bytes: Buffer): Promise<void> {
  console.log("\n── Gemini Files API staging (real R2 → Files API path) ──");
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    console.log("SKIP: GEMINI_API_KEY missing");
    return;
  }

  const { isR2Configured, uploadR2Object, deleteR2Object } = await import(
    "../src/services/textbook/r2-client.js"
  );
  if (!isR2Configured()) {
    console.log("SKIP: R2 not configured");
    return;
  }

  const userId = "probe-user";
  const r2Key = `chat-attachments/${userId}/probe-${crypto.randomBytes(4).toString("hex")}.mp4`;
  const uploaded = await uploadR2Object(r2Key, bytes, "video/mp4");
  if (!uploaded) {
    console.log("FAIL: could not upload probe object to R2");
    return;
  }
  console.log(`R2 probe object: ${r2Key}`);

  try {
    const { stageMediaForGemini } = await import("../src/services/media/gemini-files.js");
    const started = Date.now();
    const staged = await stageMediaForGemini(r2Key, "video/mp4", "probe-sample.mp4");
    if (staged) {
      console.log(`PASS: staged in ${Date.now() - started}ms`);
      console.log(`  uri: ${staged.uri}`);
      // Second call must hit the Redis cache (fast, no re-upload).
      const t2 = Date.now();
      const cached = await stageMediaForGemini(r2Key, "video/mp4", "probe-sample.mp4");
      console.log(`  cache hit: ${cached?.uri === staged.uri ? "YES" : "NO"} (${Date.now() - t2}ms)`);
      // Cleanup the Gemini copy.
      try {
        const delRes = await fetch(`${staged.name.startsWith("files/") ? `https://generativelanguage.googleapis.com/v1beta/${staged.name}` : staged.uri}`, {
          method: "DELETE",
          headers: { "X-Goog-Api-Key": key },
          signal: AbortSignal.timeout(30_000),
        });
        console.log(`  gemini cleanup: ${delRes.ok || delRes.status === 404 ? "deleted" : `status ${delRes.status}`}`);
      } catch (e) {
        console.log(`  gemini cleanup failed (non-fatal): ${(e as Error).message}`);
      }
    } else {
      console.log("FAIL: stageMediaForGemini returned null (see gemini-files logs above)");
    }
  } finally {
    const del = await deleteR2Object(r2Key);
    console.log(`R2 cleanup: ${del ? "deleted" : "FAILED (delete manually)"}`);
  }
}

// Main flow: download sample, run probes, print recommendation.

async function main() {
  const model = process.env.PROBE_MODEL || process.env.ASSISTANT_DEFAULT_MODEL || "stealth/ox-alpha";
  console.log(`Media probe — model: ${model}\n`);

  const bytes = await downloadSample();
  console.log(`Sample video: ${(bytes.length / (1024 * 1024)).toFixed(2)}MB`);
  const dataUrl = `data:video/mp4;base64,${bytes.toString("base64")}`;

  const results: ORResult[] = [];

  console.log("\n── OpenRouter acceptance probes ──");
  results.push(await probeOpenRouter(model, [], "control (text only)"));
  results.push(await probeOpenRouter(model, [{ type: "video_url", video_url: { url: SAMPLE_URL } }], "video_url https"));
  results.push(await probeOpenRouter(model, [{ type: "video_url", video_url: { url: dataUrl } }], "video_url dataURL"));

  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.variant.padEnd(22)} ${r.detail}`);
  }

  await probeGeminiStaging(bytes);

  // A 402/403 mentioning credits/balance means the format was routed; only the account balance blocks it.
  const formatSupported = (r: ORResult | undefined): boolean | "credits" =>
    !r ? false : r.ok ? true : /40[23]/.test(r.detail) && /(balance|credits)/i.test(r.detail) ? "credits" : false;

  const wire = formatSupported(results.find((r) => r.variant === "video_url dataURL"));
  const url = formatSupported(results.find((r) => r.variant === "video_url https"));

  console.log("\n── Recommendation ──");
  if (wire === true && url === true) {
    console.log("ox-alpha accepts both flavors — current defaults are fine.");
  } else if (wire === true || wire === "credits") {
    console.log("dataURL video is ROUTED by this model" + (wire === "credits" ? " (OpenRouter needs ≥$1.00 balance for video requests!)" : "") + ".");
    if (url === false) {
      console.log("https URLs are NOT routable → MEDIA_DATA_URL_MAX_BYTES governs what stays on this model; larger videos auto-swap to Gemini (step 1.5).");
    }
  } else if (url === true || url === "credits") {
    console.log("Only https URLs work → keep MEDIA_DATA_URL_MAX_BYTES low so videos use signed URLs.");
  } else {
    console.log("No video_url flavor routed for this model → remove it from MODEL_MEDIA_CAPABILITIES; the automatic fallback sends video to Gemini instead.");
  }
}

main().catch((e) => {
  console.error("Probe crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
