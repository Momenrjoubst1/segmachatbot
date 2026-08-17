# Deep Code Review v2 — Scratch Notes (2026-08-16)

Branch: feature/custom-composer (107 files changed, +4233/-1817 uncommitted on top of 2ce70ad)
Previous review: DEEP-CODE-REVIEW-FINAL.md (Aug 13-14). This pass re-reviews current state + new delta (textbook pipeline, R2 migration, model-router, custom composer UI).

## Module checklist
- [ ] backend auth/middleware/proxy/guest (security-critical) — Agent 1 + me
- [ ] backend services/chat (pipeline, model-router, response-generator, moderation) — Agent 2
- [ ] backend memory + rag + textbook + pdf-processor + R2 — Agent 3
- [ ] backend tools + analytics + agent.service + validators + prompts — Agent 4
- [ ] frontend (runtime, composer, contexts, auth, sw) — Agent 5
- [ ] cross-cutting: secrets (esp. commit 2ce70ad "add Google API key"), CI, docker-compose, deps, .gitignore — me

## Findings log

### MY FINDINGS — chat pipeline (me, full read)
- CRITICAL: persistCacheHit writes user/assistant msgs to client-supplied threadId WITHOUT ownership check. rag-retrieval.ts:442-501; runs in step 5 before resolveThread (step 7, which does check via ensureThreadOwnership chat-shared.ts:217-240). Backend uses SERVICE ROLE key (supabase.config.ts:33) → RLS bypassed. Exploit: authenticated user seeds cache (asks cacheable Q), then replays with victim threadId → injects messages into victim's session. Also persists cached (possibly other-user-personalized) response into victim thread.
- CRITICAL/HIGH: RAG results cache key has no userId. rag-cache.service.ts:137 (`rag:results:{hash(query)}:{matchCount}`) but results include user-scoped textbook chunks (rag-retrieval.ts:281-293,331-348 merged then cached :362). User B identical query within 1800s TTL gets user A's private textbook chunks in context.
- HIGH: Response cache global (resp_cache:index single key, response-cache.service.ts:79). Bypass flags (rag-retrieval.ts:136-141) cover courses/tools/follow-up but NOT memory personalization (memory built later, step 6). Memory-personalized response cached (response-generator.service.ts:225 respects bypassed only) & served cross-user at ≥0.92 cosine. Cached hit also persisted into other user's thread.
- MEDIUM: persistCacheHit with no threadId attaches to user's LATEST session by created_at (rag-retrieval.ts:447-457) — lands in wrong/old thread; frontend gets X-Thread-Id of old session.
- MEDIUM: File encoding corruption (mojibake): thread-lookup.service.ts:41-110 — ALL Arabic regex/fillers stored as Ø§ÙØªØ­ garbage → Arabic thread-summoner fast-pass NEVER matches real input (feature silently dead). response-generator.service.ts:370 user-facing Arabic error is mojibake. Scattered â€” in logs/comments (rag-retrieval.ts:146, thread.ts, ui files). Files with CLEAN Arabic: moderation.service.ts:113, summarization.ts:103/138 → per-file corruption.
- MEDIUM: Moderation fail-open (input moderation.service.ts:131-137, output :182-193) when Edge Function unavailable. Test moderation-failclosed.test.ts does NOT test fail-closed (only exports + length) — misleading name, false confidence.
- MEDIUM (perf): response-cache checkCache JSON.parses whole index (up to 500 embeddings ×768 dims ≈ MBs) on EVERY chat request (response-cache.service.ts:121-125); checkCache hitCount read-modify-write unlocked (:143-149); invalidateByPattern not under write lock (:257-290) can resurrect evicted entries.
- LOW: getGracefulDegradationMessage computed+logged but never sent to user (response-generator.service.ts:351-354; model-router.ts:295-300) — dead user messaging.
- LOW: ilike wildcard chars (%/_) not escaped in thread lookup (thread-lookup.service.ts:217).
- LOW: agent.service.ts:40-44 process.exit(1) at import if AGENT_INTERNAL_SECRET unset — dynamic import in shutdown path (index.ts:208) could abort graceful shutdown. Whole agent subsystem is DEAD CODE: no agents/ dir (existsSync always false), no importers.
- FIXED (prev review): pipeline timeouts now via withTimeout everywhere (chat.pipeline.ts:123-275); tool registration via metadata (chat.pipeline.ts:47); moderation returns new array (moderation.service.ts:149-167); thread routes all check ownership (chat-thread.routes.ts).
- GOOD: model-router circuit breaker solid; thread branching/delete/pin/feedback ownership correct; summarization correct w/ clean Arabic.

### AGENT 1 (security layer) — returned
- HIGH: trust proxy default=1 + IP-keyed limiters → spoofable req.ip via XFF (app.config.ts:41-43; rate-limiters.ts:244,263,282; index.ts:83). Guest quota (unauth LLM cost control) effectively unenforceable when client reaches app directly.
- MEDIUM: auth session cache honors revoked tokens ≤5min; ban recheck only if cacheAge>60s (auth.middleware.ts:102-143,193-198).
- MEDIUM: newChatLimiter bypassed by fake threadId (chat.routes.ts:16-22) — client-controlled skip of stricter limiter.
- MEDIUM: guest quota degrades to per-instance memory when Redis down (guest.routes.ts:248-254,368-371) + per-request PING latency (172-183).
- MEDIUM: image proxy serves image/svg+xml from API origin (proxy.routes.ts:20-22, safe-fetch-url.ts:162-165); dicebear default = SVG. Mitigated only by helmet CSP.
- LOW: proxyLimiter per-user key never applies (req.user undefined at mount, rate-limiters.ts:244 + index.ts:117).
- LOW: IPv6 mapped/NAT64 + CGNAT ranges missing in SSRF checks (safe-fetch-url.ts:16-37,105-108) — gated behind allowlist.
- LOW: clearTraceContext disables ALS process-wide (logger.ts:52-54 + request-id.ts:20-22) → requestId correlation lost under concurrency.
- LOW: createErrorResponse returns AppError.context to clients (error-handler.ts:76-86).
- NOTE: banned_until auth-metadata check dead code (auth.middleware.ts:168,172).
- NOTE: DNS-rebinding IP pinning breaks HTTPS fetching (cert host mismatch, safe-fetch-url.ts:129-146) — proxy broken for HTTPS allowlist.
- NOTE: limiter docs table advertises nonexistent limiters (rate-limiters.ts:9-17 vs moderation.routes.ts).
- PREV STATUS: fallbackCounters leak FIXED (self-cleanup+ sweep); double ban query FIXED; proxy SSRF largely CLOSED.

### MY FINDINGS — tools/analytics/email (me)
- HIGH: Email confirm gate bypassable: sender.ts:917 `if (confirm === true)` sends IMMEDIATELY without confirmationId — the needs_confirmation flow is advisory only; prompt-injected LLM can send emails silently. Also unsanitized `html` param passed through (schema :678) + buildHtmlEmail interpolates subject/body unescaped (:597,:623) → phishing-style HTML from verified sender.
- HIGH: email_schedules has NO worker — grep across backend/src shows zero consumers outside scheduler.ts (insert-only). Scheduled emails are never sent; silent feature failure. Also email_jobs retry queue has no processor — "will be retried automatically" (sender.ts:848) is false.
- MEDIUM: getEmailHistory .or() PostgREST filter injection — escapes % and _ but not commas (sender.ts:1024-1025); crafted searchQuery can alter filter expression.
- MEDIUM: scheduler.ts has no max-horizon/cap on scheduledAt and no per-user schedule limit → unbounded rows; minor.
- LOW: updateJobStatus fetch-then-update race on attempts (sender.ts:413-434).
- GOOD: analytics user-dashboard properly user-scoped; /dashboard behind requireAdmin (analytics.routes.ts:91 — previous LOW finding FIXED). Web search now multi-provider with priorities + circuit breakers + configurable timeout (search-engine.ts:19-21,29+) — previous finding improved.
- LOW: /analytics/events limit & days params unvalidated (NaN/huge) (analytics.routes.ts:20-21,168-169).
- LOW: admin dashboard "recentEvents" uses admin's own events under platform scope (analytics.routes.ts:100).

### Docker/deploy (me)
- pdf-processor Dockerfile runs as root (no USER). Backend USER node ✅, frontend USER nginx ✅.
- Frontend Dockerfile COPYs pnpm-lock.yaml (frontend/Dockerfile:9) but repo has package-lock.json (npm) → docker build of frontend is BROKEN. Medium.


- No secrets in tracked files; .env properly ignored; commit 2ce70ad = placeholder only. ✅
- CI: typecheck+tests both sides, Redis service — good. No lint job, no coverage gate (Note).
- docker-compose: backend/pdf-processor bound to 127.0.0.1 ✅, frontend on 80; mem limits; healthchecks; backend non-root (USER node); pdf-processor likely root (check Dockerfile — FROM python:3.11-slim, no USER seen).
- Deps: backend modern (axios 1.13.6 — previous review's "outdated vs 1.7.x" claim was WRONG, 1.13.6 > 1.7.x). eslint 8 EOL'd (Low). Frontend modern (react 19.2.8 stable, dompurify present). `heat-graph` ^0.0.14 tiny package (supply-chain Note — verify usage; used in heat-graph.tsx).
- Doc drift: README providers (Azure/Groq/GitHub/OpenRouter/Fireworks/Novita) vs ARCHITECTURE.md (Groq/OpenAI/Gemini/DeepSeek/Qwen) vs code env checks (+BIGMODEL) — inconsistent docs (Low).
- bee/ = Three.js asset dir at repo root (Note).

### AGENT 3 (memory/RAG/textbook/pdf-processor) — returned
- CRITICAL (confirms mine): RAG results cache cross-user leak (rag-cache.service.ts:132-174 + rag-retrieval.ts:331-348,362).
- CRITICAL (confirms mine): response cache cross-user (response-cache.service.ts:113-171; bypass at 102-107 lacks user/textbook/memory awareness).
- HIGH: BM25 init DEADLOCK — initializeBM25FromDB nests bm25Mutex.runExclusive via setBM25Docs (bm25-search.ts:210+232,196; async-mutex.ts:17-29). Index never builds at startup when documents exist; mutex held forever; addBM25Doc hangs; admin reindex hangs. Triggered from index.ts:78.
- HIGH: No server-side PDF limits — 200MB check only if client sends file_size_bytes (textbook.routes.ts:33-37); PyMuPDF iterates all pages, no caps (main.py:243-267); 1 worker/1gb → single PDF bomb OOMs + blocks queue.
- HIGH: Crash recovery incomplete — sweepStuckJobs never updates textbooks.status (queue.ts:150-179); retryDeadLetters has NO callers (112-142); worker breaks after 10 errors, nothing restarts (worker.ts:157-171); enqueue fail after row insert → stuck 'pending'.
- MEDIUM: R2 figures public forever — predictable sequential keys {R2_PUBLIC_URL}/textbooks/{user}/{textbook}/fig_*.png unsigned (main.py:51-77,270-280); delete route only removes Supabase objects (routes 248-265); Supabase path was private+signed (006_security.sql) — half-finished migration.
- MEDIUM: Textbook RPCs (match_textbook_chunks, hybrid_search) scoped only by textbook_id, no user_id (002/008 migrations); searchTextbookChunks ignores userId (textbook-search.ts:184-200); upload trusts client file_content_hash → hash-match clones victim's structure/total_pages cross-user (routes 40-49,71-92).
- MEDIUM: pdf-processor /process has NO auth; user_id/textbook_id free-form verbatim in R2 keys (main.py:85-88,243-253); mitigated by loopback-only port.
- MEDIUM: cross-session embeddingSearch re-embeds 50 msgs × N sessions EVERY turn, no persistence (cross-session.service.ts:230-271) → cost/latency grows with history.
- MEDIUM: BM25 full-table select into process RAM, no cap (bm25-search.ts:55-59,216-234); response-cache index single JSON key, non-atomic RMW (216-229).
- LOW: raw internal errors persisted/returned (textbook-processor.ts:221-234 vs sanitize in worker only).
- LOW: idx (textbook_id,page,left(content,100)) unique drops whole 100-chunk batches on shared prefixes (007:48-49; processor 190-204) — silent content gaps.
- NOTE: cleanupOldMemories deletes from user_memory_facts/cross_session_memory which exist in NO migration — TTL cleanup silent no-op (unified-memory.ts:443-467).
- PREV: memory dedup FIXED (Jaccard 0.7, text-deduplicator.ts:152-187); bm25 race PARTIALLY fixed but introduced the deadlock.

## Previous-review verification
- rate-limiters fallbackCounters memory leak (was HIGH)
- auth.middleware double ban query (was MED)
- unified-memory string dedup (was MED)
- moderation mutation of coreMessages (was MED)
- bm25 global state race (was MED)
