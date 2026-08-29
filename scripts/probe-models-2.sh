#!/usr/bin/env bash
# Round 2 — disambiguate + correct Novita path. Writes parse file to cwd.
set -u
cd "$(dirname "$0")/.."
OUT=.probe_out.tmp.json

# Keys come from backend/.env — never hardcode them here.
if [ -f backend/.env ]; then
  OR_KEY=$(grep -E '^OPENROUTER_API_KEY=' backend/.env | cut -d= -f2)
  GROQ_KEY=$(grep -E '^GROQ_API_KEY=' backend/.env | cut -d= -f2)
  NVIDIA_KEY=$(grep -E '^NVIDIA_API_KEY=' backend/.env | cut -d= -f2)
  GEMINI_KEY=$(grep -E '^GEMINI_API_KEY=' backend/.env | cut -d= -f2)
  BIGMODEL_KEY=$(grep -E '^BIGMODEL_API_KEY=' backend/.env | cut -d= -f2)
  NOVITA_KEY=$(grep -E '^NOVITA_API_KEY=' backend/.env | cut -d= -f2)
  BAICHAT_KEY=$(grep -E '^BAICHAT_API_KEY=' backend/.env | cut -d= -f2)
else
  echo "run from repo root"; exit 1
fi

parse_oai() {
python - <<'PY' 2>/dev/null
import json
try:
    d=json.load(open(r".probe_out.tmp.json",encoding="utf-8"))
    if "choices" in d and d["choices"]:
        c=d["choices"][0]; msg=(c.get("message") or {}).get("content") or c.get("text","")
        r=(c.get("message") or {}).get("reasoning_content")
        print("OK  | " + (msg or "").strip().replace("\n"," ")[:50] + (" [reasoning-only]" if not msg and r else ""))
    elif "error" in d:
        e=d["error"]; msg=e.get("message",e) if isinstance(e,dict) else e
        print("ERR | " + str(msg)[:120])
    else:
        print("ERR | " + json.dumps(d)[:120])
except Exception as ex:
    print("ERR | parse:", ex)
PY
}

parse_google() {
python - <<'PY' 2>/dev/null
import json
try:
    d=json.load(open(r".probe_out.tmp.json",encoding="utf-8"))
    if "candidates" in d and d["candidates"]:
        parts=d["candidates"][0].get("content",{}).get("parts",[])
        txt="".join(p.get("text","") for p in parts)
        print("OK  | " + txt.strip().replace("\n"," ")[:50])
    elif "error" in d:
        print("ERR | " + str(d["error"].get("message",""))[:120])
    else:
        print("ERR | " + json.dumps(d)[:120])
except Exception as ex:
    print("ERR | parse:", ex)
PY
}

probe_oai() { # label url auth model [timeout]
  local label="$1" url="$2" auth="$3" model="$4" t="${5:-30}"
  local http
  http=$(curl -s -o "$OUT" -w "%{http_code}" --max-time "$t" -X POST "$url" \
    -H "Content-Type: application/json" -H "$auth" \
    -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"Say OK\"}],\"max_tokens\":10}")
  printf "%-10s %-45s -> %s %s\n" "$label" "$model" "$http" "$(parse_oai)"
}

echo "=== GROQ (verify OK bodies) ==="
for m in qwen/qwen3.6-27b openai/gpt-oss-120b; do
  probe_oai "groq" "https://api.groq.com/openai/v1/chat/completions" "Authorization: Bearer $GROQ_KEY" "$m"
done

echo "=== NVIDIA (200s bodies + retries) ==="
for m in nvidia/llama-3.1-nemotron-70b-instruct nvidia/nemotron-3-super-120b-a12b nvidia/nemotron-3.5-lightning-30b-a3b nvidia/nemotron-3-ultra-550b-a55b deepseek-ai/deepseek-v4-flash-0731; do
  probe_oai "nvidia" "https://integrate.api.nvidia.com/v1/chat/completions" "Authorization: Bearer $NVIDIA_KEY" "$m" 40
done

echo "=== GOOGLE (2.5-pro why 404 + 3.7-flash retry) ==="
for m in gemini-3.7-flash gemini-2.5-pro gemini-2.5-flash gemini-3.5-flash; do
  http=$(curl -s -o "$OUT" -w "%{http_code}" --max-time 40 -X POST \
    "https://generativelanguage.googleapis.com/v1beta/models/$m:generateContent" \
    -H "Content-Type: application/json" -H "x-goog-api-key: $GEMINI_KEY" \
    -d '{"contents":[{"parts":[{"text":"Say OK"}]}],"generationConfig":{"maxOutputTokens":10}}')
  printf "%-10s %-45s -> %s %s\n" "google" "$m" "$http" "$(parse_google)"
done

echo "=== OPENROUTER (402/404 bodies) ==="
for m in openai/gpt-4o stealth/ox-alpha google/gemma-4-31b-it:free; do
  probe_oai "openrouter" "https://openrouter.ai/api/v1/chat/completions" "Authorization: Bearer $OR_KEY" "$m"
done

echo "=== BIGMODEL glm-5.2 retry ==="
probe_oai "bigmodel" "https://open.bigmodel.cn/api/paas/v4/chat/completions" "Authorization: Bearer $BIGMODEL_KEY" "glm-5.2" 40

echo "=== NOVITA (backend path: /openai/chat/completions) ==="
probe_oai "novita" "https://api.novita.ai/openai/chat/completions" "Authorization: Bearer $NOVITA_KEY" "inclusionai/ling-3.0-tiny"
probe_oai "novita" "https://api.novita.ai/v3/openai/chat/completions" "Authorization: Bearer $NOVITA_KEY" "inclusionai/ling-3.0-tiny"

echo "=== BAICHAT (long timeout) ==="
probe_oai "baichat" "https://api.chat.b.ai/v1/chat/completions" "Authorization: Bearer $BAICHAT_KEY" "deepseek-v4-flash" 45

rm -f "$OUT"
echo "=== done ==="
