// Real-provider guest-chat load probe.
//
// Start the backend with TRUST_PROXY_HOPS=1 so each virtual user's
// X-Forwarded-For creates its own rate bucket (simulating distributed
// clients), then run:
//   LOAD_VUS=12 LOAD_MSGS=2 node scripts/load-guest.mjs
//
// Metrics: SSE time-to-first-chunk, completion time, limiter hits,
// empty streams (fallback exhaustion) and HTTP errors.

const BASE = process.env.LOAD_BASE || "http://127.0.0.1:3004";
const VUS = Number(process.env.LOAD_VUS || 12);
const MSGS_PER_VU = Number(process.env.LOAD_MSGS || 2);

const QUESTIONS = [
  "بجملة وحدة: شو الفرق بين المتغير والثابت؟",
  "اشرحلي باختصار شو يعني الكمبيوتر؟",
  "عطني مثال بسيط على الحلقة for",
  "ليش السما زرقة؟ جواب قصير",
  "شو معنى الـCPU بالعربي؟",
  "كيف احفظ أسرع؟ نصيحة بجملتين",
];

const randIp = () =>
  `10.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function oneMessage(cookie) {
  const ip = randIp();
  const t0 = Date.now();
  const headers = {
    "Content-Type": "application/json",
    "X-Forwarded-For": ip,
    "Accept-Language": "ar",
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const message = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];

  let res;
  try {
    res = await fetch(`${BASE}/api/guest/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message }),
    });
  } catch (e) {
    return { kind: "fetch_error", ms: Date.now() - t0, error: String(e) };
  }
  const headerMs = Date.now() - t0;

  if (res.status === 429) return { kind: "rate_limited_429", ms: headerMs };
  if (!res.ok) return { kind: `http_${res.status}`, ms: headerMs };

  const setCookie = res.headers.get("set-cookie");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let firstChunkMs = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("0:")) continue;
        try {
          const s = JSON.parse(line.slice(2));
          if (typeof s === "string" && s) {
            text += s;
            if (firstChunkMs === null) firstChunkMs = Date.now() - t0;
          }
        } catch { /* partial line */ }
      }
    }
  } catch (e) {
    return { kind: "stream_error", ms: Date.now() - t0, error: String(e) };
  }
  return {
    kind: text.trim() ? "ok" : "empty_stream",
    ms: Date.now() - t0,
    ttfb: firstChunkMs,
    headerMs,
    chars: text.length,
    cookie: setCookie ?? cookie,
  };
}

async function virtualUser(vu) {
  const out = [];
  let cookie = null;
  for (let i = 0; i < MSGS_PER_VU; i++) {
    const r = await oneMessage(cookie);
    if (r.cookie) cookie = r.cookie;
    out.push({ vu, idx: i, ...r });
    if (i < MSGS_PER_VU - 1) await new Promise((res) => setTimeout(res, 1500 + Math.random() * 1500));
  }
  return out;
}

const t0 = Date.now();
const all = (await Promise.all(Array.from({ length: VUS }, (_, v) => virtualUser(v)))).flat();
const wall = ((Date.now() - t0) / 1000).toFixed(1);

const by = {};
for (const r of all) (by[r.kind] ??= []).push(r);
const oks = by.ok ?? [];
const ttfb = oks.map((r) => r.ttfb).filter(Number.isFinite);
const total = oks.map((r) => r.ms);

console.log(`\n=== real-provider guest load: ${VUS} VUs × ${MSGS_PER_VU} msgs — wall ${wall}s ===`);
for (const [kind, rows] of Object.entries(by)) console.log(`${kind}: ${rows.length}`);
if (oks.length) {
  console.log(`TTFB  p50=${pct(ttfb, 50)}ms p95=${pct(ttfb, 95)}ms`);
  console.log(`TOTAL p50=${pct(total, 50)}ms p95=${pct(total, 95)}ms`);
  console.log(`avg chars/response: ${Math.round(oks.reduce((a, r) => a + r.chars, 0) / oks.length)}`);
}
const failed = all.filter((r) => r.kind !== "ok" && r.kind !== "rate_limited_429");
if (failed.length) {
  console.log("\nfailures detail:");
  for (const f of failed.slice(0, 8)) console.log(" ", f.kind, f.error ?? "", `${f.ms}ms`);
}
