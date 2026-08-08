# Deep Code Review — Sigma AI Chatbot

**Date:** August 7, 2026
**Reviewer:** AI Code Review Agent
**Scope:** Full-stack (Frontend + Backend + Infrastructure)
**Codebase:** ~33,000 LOC across 270 source files

---

## Executive Summary

Sigma AI Chatbot is a full-stack AI chatbot with RAG, memory management, and multi-model support built with React 19, Express, TypeScript, Supabase, and Redis. The codebase demonstrates production-quality patterns in several areas (structured logger, sliding-window rate limiter, 10-step chat pipeline, auth middleware with JWT + Redis caching).

**Overall Code Health: 7/10 — Functional with significant security and reliability gaps**

### Top 5 Things to Fix

1. **[CRITICAL] XSS via `dangerouslySetInnerHTML` in SVG artifact viewer** — Stored XSS allows AI-generated SVG to execute arbitrary JavaScript in the user's browser.
2. **[CRITICAL] Hardcoded fallback agent secret** — `AGENT_INTERNAL_SECRET` falls back to `'skillswap-local-agent-secret'`, enabling full auth bypass if env var is missing.
3. **[HIGH] Infinite auth retry loop** — `authFetch` retries on 401 without verifying the new token is different, creating infinite loops on persistent auth expiry.
4. **[HIGH] No tests for critical paths** — Auth middleware, chat routes, SSRF protection, and the 10-step pipeline have zero test coverage.
5. **[HIGH] Global CSS transition on `*`** — `* { transition: ... }` applies transitions to every DOM element, causing measurable performance degradation.

### Coverage

- **Backend modules:** Fully reviewed (routes, services/chat, services/memory, services/rag, tools, middleware, config, security)
- **Frontend modules:** Fully reviewed (context, features/ai-assistant, features/artifacts, features/calendar, hooks, lib, components/ui, i18n, styles)
- **Infrastructure:** Docker, nginx, CI/CD, Redis config reviewed
- **Cross-cutting:** Security, testing, observability, documentation reviewed

---

## Architecture Assessment

**Score: 6/10 — Functional but structurally fragile**

### What's Working Well
- **10-step chat pipeline** — Clean orchestration with separated concerns (validation → moderation → memory → context → tools → LLM → parsing → execution → storage)
- **Structured logger** — Production-quality with per-module child loggers, trace context, JSON output
- **Sliding-window rate limiter** — Redis-backed with Lua scripts for atomicity, in-memory fallback
- **Auth middleware** — JWT verification + Redis caching + dual ban checking (Supabase metadata + banned_users table)
- **SSRF protection** — DNS resolution + IP pinning + allowlist + redirect validation

### Critical Structural Issues

| Severity | Finding | File | Impact |
|----------|---------|------|--------|
| Critical | `chat-shared.ts` God Module — 7+ responsibilities (rate limiters, model config, provider clients, system prompts, helpers) | `backend/src/routes/chat/chat-shared.ts` | Inverted dependencies; pipeline imports from route layer |
| Critical | 3 redundant Supabase client exports — `supabase.config.ts`, `rag-supabase-client.ts`, `moderation.service.ts` all export the same client | Multiple files | Confusion about which client to use; version drift risk |
| Critical | Zero database migrations — schema lives only in SQL comments | `backend/src/services/chat/pipeline/rag-retrieval.ts:389+` | Schema changes require manual SQL; no rollback capability |
| High | Routes bypass service layer — `analytics.routes.ts` instantiates `AnalyticsTracker` directly | `backend/src/routes/analytics.routes.ts:9` | Business logic in route handlers; no reuse |
| High | Auth check duplicated 12+ times — each route manually checks `req.user?.id` | All route files | Inconsistent auth enforcement; easy to miss |
| Medium | In-memory artifact store — `ArtifactStore` is a `Map<string, Artifact>` | `backend/src/tools/files/create-artifact/in-memory-artifact-store.ts` | Artifacts lost on restart; no persistence |
| Medium | 9 frontend contexts — excessive context splitting creates provider nesting | `frontend/src/context/` | Re-render cascade; complex provider tree |
| Medium | Provider detection in 3+ places — model routing logic duplicated | `backend/src/routes/chat/chat-shared.ts`, `backend/src/services/chat/pipeline/rag-retrieval.ts` | Inconsistent routing behavior |

---

## Findings by Module

### Backend

#### services/chat/ — Core Chat Pipeline

| Severity | Finding | File:Line | Impact | Fix |
|----------|---------|-----------|--------|-----|
| High | Error messages leak internal details to clients | `response-generator.service.ts:370,253` | Information disclosure | Return generic error messages |
| Medium | Race condition in cache-hit session creation | `rag-retrieval.ts:389` | Duplicate sessions created | Use database unique constraint or distributed lock |
| Medium | Empty session reuse could collide with concurrent writes | `pipeline/thread.ts:77` | Message misattribution | Use session status check before reuse |
| Medium | Deduplication uses first 120 chars as hash | `rag-retrieval.ts:270` | Fragile dedup; different content with same prefix not caught | Use full content hash or semantic similarity |

#### services/memory/ — Memory System

| Severity | Finding | File:Line | Impact | Fix |
|----------|---------|-----------|--------|-----|
| High | Hardcoded Azure endpoint in source code | `enhanced-memory.service.ts:428` | Secrets in source; inflexible config | Move to env var |
| Medium | Config validation only runs in debug mode | `memory.config.ts:181` | Invalid config silently accepted in production | Always validate in production |
| Medium | SCAN limit of 10 too small for similarity search | `context-cache.service.ts:195` | May miss cache entries; slow cleanup | Increase to 100+ or use cursor-based iteration |

#### services/rag/ — RAG Pipeline

| Severity | Finding | File:Line | Impact | Fix |
|----------|---------|-----------|--------|-----|
| Medium | Embedding search is non-functional | `cross-session.service.ts:228` | Cross-session recall relies on text search only | Implement actual vector similarity search |
| Medium | Global singleton not thread-safe during re-indexing | `bm25-search.ts:158` | Stale index served during rebuild | Use read-write lock or versioned index |

#### tools/ — AI Tool System

| Severity | Finding | File:Line | Impact | Fix |
|----------|---------|-----------|--------|-----|
| Medium | `ilike` pattern injection via search query | `email/sender.ts:1120` | SQL injection via LIKE wildcards | Escape `%` and `_` in user input |
| Medium | pdf-parse may have known vulnerabilities | `file-text-extractor.ts:6` | Potential RCE via crafted PDF | Update to latest version; sandbox parsing |

#### middleware/ — Security & Auth

| Severity | Finding | File:Line | Impact | Fix |
|----------|---------|-----------|--------|-----|
| High | 5-min ban enforcement delay due to cache TTL | `auth.middleware.ts:64` | Banned user has 5-min window | Use separate ban cache with shorter TTL |
| High | Redis errors silently swallowed, causing thundering herd | `auth.middleware.ts:57` | All requests hit Supabase on Redis failure | Log error; implement circuit breaker |
| Medium | Trusted IP bypass is spoofable behind proxies | `rate-limiters.ts:163` | Rate limiting bypassed via X-Forwarded-For spoofing | Use API key-based trust instead of IP |
| Medium | Regex detection patterns leaked to clients | `input-validator.ts:276` | Attackers learn bypass patterns | Return generic "blocked" message |

#### config/ — Configuration

| Severity | Finding | File:Line | Impact | Fix |
|----------|---------|-----------|--------|-----|
| Medium | Dummy dev key could confuse developers | `supabase.config.ts:49` | Accidental use against real Supabase | Throw error in production if key is dummy |
| Medium | Environment variable mutation at import time | `embedding-service.ts:14` | Side effects during import; testing difficulty | Defer to runtime |

### Frontend

#### features/artifacts/ — Artifact Viewer

| Severity | Finding | File:Line | Impact | Fix |
|----------|---------|-----------|--------|-----|
| Critical | XSS via `dangerouslySetInnerHTML` in SvgViewer | `ArtifactViewer.tsx:110` | Stored XSS — AI-generated SVG executes arbitrary JS | Sanitize with DOMPurify |
| High | HTML artifacts allow-scripts + allow-popups | `ArtifactViewer.tsx:101` | Artifact JS can open phishing windows and exfiltrate data | Remove allow-popups; inject CSP meta tag |
| Medium | Artifact polling every 5 seconds | `ArtifactPanel.tsx:57-59` | Unnecessary network traffic | Use Supabase Realtime or WebSocket |

#### features/ai-assistant/ — Main Chat Feature

| Severity | Finding | File:Line | Impact | Fix |
|----------|---------|-----------|--------|-----|
| High | DOM scraping for draft save | `AssistantApp.tsx:164-170` | Breaks on library upgrades; loses formatting | Use AUI composer API |
| High | Email composer injects text via `.value` (broken for Lexical) | `AssistantLayout.tsx:314-319` | "Ask bot about email" feature completely broken | Use `aui.composer().setText()` |
| Medium | UIActionStreamParser holds unbounded buffer | `useChatRuntime.ts:27-91` | Memory exhaustion on pathological streams | Add max buffer size (64KB) |
| Medium | No stream cancellation on unmount | `useChatRuntime.ts:196-231` | Memory leak; state updates on unmounted components | Pass AbortController signal |
| Medium | getFreshToken concurrent refresh race | `lib/auth.ts:3-26` | Duplicate token refreshes under concurrency | Reset promise after all consumers resolve |

#### features/calendar/ — Calendar Integration

| Severity | Finding | File:Line | Impact | Fix |
|----------|---------|-----------|--------|-----|
| High | Timezone not considered in date calculations | `useCalendarSync.ts:44-78` | Users in different timezones see wrong times | Use Intl.DateTimeFormat with user timezone |
| Medium | DST-prone day arithmetic | `useCalendarSync.ts:371-372` | Free slot times wrong on DST transition days | Use date-fns/addDays |
| Medium | `new Date(\`${date}T${startTime}\`)` without timezone | `SchedulingPanel.tsx:84` | Events stored at wrong UTC time | Append timezone offset |

#### context/ — React Contexts

| Severity | Finding | File:Line | Impact | Fix |
|----------|---------|-----------|--------|-----|
| Medium | ChatMessagesContext exposes mutable refs | `ChatMessagesContext.tsx:55-56` | Race conditions on concurrent mutations | Expose setter functions instead |
| Medium | ChatHistoryContext creates new value every render | `ChatHistoryContext.tsx:40-56` | Unnecessary re-renders for all consumers | Memoize with useMemo |
| Medium | RAGContext toggle uses stale closure | `RAGContext.tsx:36-38` | Toggle gets stuck under rapid clicks | Use functional updater |

#### lib/ — Core Utilities

| Severity | Finding | File:Line | Impact | Fix |
|----------|---------|-----------|--------|-----|
| High | authFetch infinite retry loop on persistent 401 | `lib/auth.ts:28-47` | Infinite fetch loops and UI freezes | Add max retry count; verify new token differs |
| Medium | Supabase client created with undefined env vars | `lib/supabaseClient.ts:17-26` | Cryptic runtime errors on every operation | Throw error or render config-error boundary |
| Medium | signInWithGoogle/Facebook swallow errors | `lib/supabaseClient.ts:173-203` | Runtime crash when OAuth fails | Return proper error object |

#### styles/ — CSS Architecture

| Severity | Finding | File:Line | Impact | Fix |
|----------|---------|-----------|--------|-----|
| High | Global `* { transition }` on all elements | `styles/base.css:212-214` | Janky scrolling and typing; FPS drops | Remove; apply transitions only where needed |
| Medium | RTL font-family override on `*` | `styles/rtl.css:6-8` | Code blocks and icons render in Tajawal font | Target only text elements |
| Medium | RTL uses 11 `!important` overrides | `styles/rtl.css` (multiple) | Specificity war; fragile maintenance | Consolidate; use CSS layers |

---

## Cross-cutting Findings

| Severity | Finding | File:Line | Impact | Fix |
|----------|---------|-----------|--------|-----|
| Critical | Hardcoded fallback `AGENT_INTERNAL_SECRET` | `agent.service.ts:40` | Full auth bypass if env var missing | Fail startup if not set |
| High | No tests for auth middleware, chat routes, SSRF | `backend/src/__tests__/` | Regressions ship silently | Add integration tests |
| High | Frontend tests cover only ~8% of files | `frontend/src/__tests__/` | Critical bugs (XSS, broken features) not caught | Prioritize security-critical tests |
| Medium | Inconsistent error response format | Multiple route files | Frontend must guess response shape | Standardize to `{ error: string }` |
| Medium | 26 silent catch blocks in backend | Multiple files | Debugging impossible; bugs masked | Add logging to catches |
| Medium | No `helmet` middleware | `backend/src/index.ts:96-107` | Missing security headers; broken CSP | Install helmet; configure proper CSP |
| Medium | Logger has no external sink | `utils/logger.ts:146-167` | No centralized logging | Add Sentry integration |
| Medium | Trace context is module-global, not request-scoped | `utils/logger.ts:45-53` | Mixed trace IDs under concurrent load | Use AsyncLocalStorage |
| Medium | No frontend test coverage config | `frontend/vitest.config.ts` | No way to measure coverage | Add @vitest/coverage-v8 |
| Low | Auth cache ban race (5-min window) | `auth.middleware.ts:63-81` | Banned user retains access | Use separate ban cache |
| Low | No root `.gitignore` | Project root | IDE files can be committed | Add root .gitignore |
| Note | README inaccuracies | `README.md` | Misleading for contributors | Update README |

---

## Prioritized Action Plan

| Priority | Action | Severity | Effort |
|----------|--------|----------|--------|
| 1 | Sanitize SVG artifact content with DOMPurify | Critical | S |
| 2 | Remove hardcoded `AGENT_INTERNAL_SECRET` fallback | Critical | S |
| 3 | Add max retry count to authFetch | High | S |
| 4 | Add integration tests for auth middleware and SSRF | High | M |
| 5 | Remove global `* { transition }` CSS rule | High | S |
| 6 | Fix email composer text injection (use AUI API) | High | S |
| 7 | Add exponential backoff to WebSocket reconnect | High | S |
| 8 | Standardize error response format across routes | Medium | M |
| 9 | Install helmet and configure proper CSP | Medium | M |
| 10 | Fix timezone handling in calendar | Medium | M |
| 11 | Memoize context values to reduce re-renders | Medium | S |
| 12 | Add logging to silent catch blocks | Medium | M |
| 13 | Fix trace context to be request-scoped | Medium | M |
| 14 | Stop leaking `error.message` in API responses | Medium | S |
| 15 | Add frontend test coverage configuration | Medium | S |

---

## Appendix: Lower-Priority Nits

- `useKeyboardShortcuts` comment contradicts behavior (`hooks/useKeyboardShortcuts.ts:30`)
- `useScrollPreservation` has eslint-disable for missing dependency (`hooks/useScrollPreservation.ts:99`)
- `LoadingStates` uses framer-motion for simple animations (~40KB) (`components/ui/LoadingStates.tsx:1`)
- `ErrorBoundary` is a class component (React 19 compatibility note) (`components/ui/core/ErrorBoundary.tsx:124`)
- Toast animation keyframes defined in two places (`styles/animations.css` + `styles/components.css`)
- `prefers-reduced-motion` query is incomplete — doesn't cover Tailwind animation classes (`styles/base.css:225-243`)
- Custom cursor SVGs embedded in CSS (~3KB) (`styles/base.css:150-183`)
- Mixed quote styles in route error responses (single vs double quotes)
- `react-router-dom` v6 listed but README says v7
- README references `backend/tests/` but tests are in `backend/src/__tests__/`
- README lists `npm run lint` and `npm run typecheck` scripts that don't exist
