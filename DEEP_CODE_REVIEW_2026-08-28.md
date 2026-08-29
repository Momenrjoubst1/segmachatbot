# Deep Code Review — Sigma AI Chatbot (2026-08-28)

**Reviewer:** ZCode (deep-code-review workflow) · **Branch:** `refactor/comments-explanatory-only`
**Scope:** backend (281 files / 48K LOC) + frontend (284 files / 40K LOC) + pdf-processor (4K LOC Python) + 33 migrations + infra
**Method:** map-first, evidence-based; **live Supabase DB verified empirically** (advisors + catalog queries), not just repo reading.

---

## الملخص التنفيذي (Executive Summary)

المشروع **مبني بمستوى هندسي أعلى من المتوقع لمشروع فردي/صغير**: مصادقة مركزية بثلاث طبقات كاش مع circuit breaker، حماية SSRF، حدود استخدام لكل مستخدم، هجرات موثقة بعناية (025 نموذجية)، وقاعدة البيانات الحية **كل جداولها الـ44 مفعّل فيها RLS** (تأكدت تجريبياً). كل الإصلاحات الخمسة من مراجعة 21 آب ما زالت صامدة بالكود.

نقاط الضعف الحقيقية **ليست بالكود بل بالعملية حوله**: CI ميت (بيستمع على فروع غير موجودة)، سلسلة الهجرات بالـ repo لا تعيد إنتاج الوضع الأمني للقاعدة الحية (فجوة DR خطيرة)، والفرع الحالي اسمه "تعليقات فقط" لكنه يحمل ~2,239 سطر تغيير وظيفي.

**Verdict: Good code, weak process. الكود أفضل من العملية المحيطة به.**

### أهم 5 أولويات
1. **CI لا يعمل إطلاقاً** — `.github/workflows/ci.yml:5,7` يستمع على `main`/`develop`، والمستودع فيه `master` + `feat/*` فقط. كل الاختبارات والـ typecheck غير مفروضة.
2. **فجوة إعادة الإنتاج الأمنية** — RLS على `chat_sessions/chat_messages/user_memory/email_*` موجود فقط في `full_schema.sql` (مرجع لا يُطبق حسب README) وليس بسلسلة الهجرات. `npm run db:migrate` على بيئة جديدة = جداول محادثات مكشوفة مع anon key بالفرونت إند. القاعدة الحية آمنة (تأكيد تجريبي) لكن أي rebuild صامت وغير آمن.
3. **`/api/voice/agent/turn` بدون Zod ولا حد طول** (voice.routes.ts:100-128) — نصوص بلا سقف (حتى 10MB) تدخل chat_messages + لا idempotency (retry يكرر الأدوار).
4. **تضارب عزل المستخدم في RAG** — مسار BM25 مفلتر بـ user_id (retrieval.ts:53-57) ومسار الكتب مقيّد، لكن مسار البحث المتجهي `match_documents` (023:62-80) بلا معامل مستخدم وretrieval.ts:81-95 يدمجه بدون فلترة. الجدول `documents` فارغ حالياً (0 صف — تأكيد تجريبي) فلا تسريب فعلي، لكنه لغم كامن + استدعاء RPC ميت بكل رسالة.
5. **نظافة الفرع** — `refactor/comments-explanatory-only` يحمل ميزة مرفقات كاملة (EXT_MIME، streaming، presign) + تغييرات اختبارات + CSS صوتي — ليس تعليقات فقط. خطر مراجعة/دمج مع جلسات OneDrive المتوازية.

---

## Architecture Assessment

**البنية سليمة ومتسقة**: routes (رقيقة) → 10-step pipeline → services (providers/RAG/memory/tools) → Supabase/Redis. المصادقة مركزية على مستوى `app.use` (index.ts:130-144) — كل مسار محمي افتراضاً والاستثناءات (guest, public artifacts) صريحة. هذا نمط صحيح يمنع نسيان حماية مسار جديد.

نقاط معمارية:
- **انعكاس طبقات**: `services/chat/pipeline/validation.ts:4` يستورد من `routes/chat/chat-shared.ts` — والملف نفسه سلة مشتتة (نماذج + limiters + ملكية + loggers). يستحق نقلها إلى `services/chat/` أو `lib/`.
- **ازدواجية كتالوج الموديلات**: `ALLOWED_MODELS` (chat-shared.ts:80-124، 44 مدخلاً) مقابل `MODEL_CONTEXT_WINDOWS` — تعليق model-context.ts:45 يعترف بالازدواج. يحتوي ids ميتة معروفة (`mixtral-8x7b-32768` وغيرها من Groq).
- **ال_refactor الأخير نجح جزئياً**: pipeline انقسم جيداً (أكبر ملف 489 سطر)، لكن hotspots الواجهة بقيت عملاقة (MessageComponents.tsx 943، useChatRuntime.ts 873، ChatHistoryContext.tsx 728).

## Findings by Module

### Backend — infra/auth (قوي)
- ✅ **التحقق من إصلاحات 21 آب — كلها صامدة**: dev routes محمية مزدوجاً (index.ts:146-202: NODE_ENV + ENABLE_DEV_ROUTES + authMiddleware)، guest cap ‏50K (guest.routes.ts:707)، L1 LRU + إعادة فحص حظر بخلفية (auth.middleware.ts:202-211) + فحص كاش L2 متقادم (257-265)، rate-limiter LRU ‏10K (memory-store.ts:27)، حدود Zod (chat-validation-schemas.ts:7,67).
- ✅ CORS صحيح: allowlist صريح، `null` origin مرفوض بالإنتاج، credentials مع قائمة مغلقة (app.config.ts:38-53).
- ✅ WS relays **عليها مصادقة كاملة**: stt-ws.ts:34+ (`verifyToken`: JWT → getUser + banned_until + banned_users) مع حدود مدة/تزامن/دقائق يومية. *(ملاحظة: JWT بالـ query string — قابل للتسرب للـ logs؛ استخدم subprotocol/أول frame.)*
- ✅ معالجة أخطاء الستريمنغ: timeout-aware، chunk خطأ `3:` بدل تعليق الاتصال (chat.pipeline.ts:408-436).
- Low: `console.warn/error` في search-engine.ts:140,146 يتجاوز الـ logger المنظم.
- Note: `initializeBM25FromDB()` و`testRedisConnection()` fire-and-forget (index.ts:92-93) — أخطاؤها داخلياً مسجلة لكن لا تظهر كفشل startup.

### Backend — voice (جديد، نظيف)
- ✅ مفتاح ElevenLabs لا يصل للمتصفح أبداً (voice.routes.ts:45-53)، أخطاء upstream تُطابق رسائل نظيفة (502 مع تمييز permissions).
- ✅ `/agent/turn` يفحص ملكية الخيط (سطر 112) عبر `ensureThreadOwnership` (chat-shared.ts:126-149).
- Medium: لا Zod/حد طول على userText/agentText؛ لا idempotency.
- Low: `isThreadOwnedByUser` كاش Redis ‏5 دقائق (chat-shared.ts:151-181) — حذف/نقل ملكية خيط لا يسري فوراً (مقبول).

### Backend — RAG
- ✅ SQL آمن: كل الاستعلامات عبر Supabase query builder/RPC بمعاملات؛ `${}` فقط لمفاتيح كاش Redis.
- ✅ hybrid_search_textbook_chunks مقيّد بـ p_user_id (024:22) وnormalize_arabic للعربية.
- Medium: التضارب المتجهي/ BM25 المذكور أعلاه (المسار المتجهي بلا فلترة مستخدم). الجدول فارغ عملياً فالأثر الحالي صفر لكن RPC يُستدعى بلا جدوى بكل رسالة.

### Backend — tools
- ✅ web-search: ثلاثة مزودين (Brave/Google CSE/Tavily) مع circuit breakers + fallback + كاش — ولا جلب URLs عشوائية (SSRF سطح شبه معدوم).
- ✅ code executor عبر Wandbox (عزل خارجي)؛ calculator عبر mathjs (ليس eval).

### Frontend
- ✅ AgentVoiceButton.tsx: تصميم UX مدروس (composer حقيقي + mirror محلي قبل الpersist)، `startingRef` يمنع double-start، flag gate بعد كل hooks.
- Medium: ids محلية `va-u-${Date.now()}` (الأسطر 104-119) — تصادم محتمل بنفس المللي ثانية (React duplicate keys)؛ فشل الpersist فقط `console.warn` (سطر 129) — التحديث يفقد الأدوار.
- Low: `lastUserTextRef` يراكم النص لكن `input?.setText(text)` يستبدل لا يضيف (سطر 152) — عرض الـ composer قد يعرض آخر جزء فقط.
- Note: `persistSession: true` (supabaseClient.ts:47) = session بـ localStorage — سرقة XSS تأخذ جلسة كاملة. مقايضة معروفة لكن وثّقها أو قصرها.

### pdf-processor (سليم)
- ✅ مصادقة Bearer اختيارية-بالـenv (main.py:207-209)، حدود MAX_PDF_PAGES=800، ALLOWED_DIRS للمسارات، R2 منفصل.
- Note: token اختياري — عند غياب PDF_PROCESSOR_TOKEN الخدمة مفتوحة (يخففها الربط 127.0.0.1 والشبكة الداخلية بالـ compose). اجعله required افتراضياً.

### Migrations / DB (تجريبي)
- ✅ **القاعدة الحية**: 44/44 جدول RLS مفعّل، سياسات على كل الجداول الحساسة (chat_messages:3، chat_sessions:4، user_memory:4، email_*:3-4) — استعلام مباشر على pg_class/pg_policies.
- High: السلسلة المرقمة لا تطبّق هذا — فجوة DR (تفصيل أعلاه). 023 أنشأ event trigger `rls_auto_enable` للجداول **الجديدة** فقط ولا يغطي جداول 001.
- Note: تسلسل ناقص (لا 003 ولا 026) — وثّق السياسة أو رقّم بلا فجوات.
- Supabase advisors: انقل `vector`/`pg_trgm` من public schema؛ فعّل Leaked Password Protection (إعداد Dashboard، دقيقة واحدة).

### Infra / CI / Deps
- ✅ docker-compose نموذجي: mem limits، log rotation، healthchecks، ربط loopback للـ backend/pdf، Redis داخلي فقط + AOF.
- High: CI ميت (الفروع) — تفصيل أعلاه.
- ✅ الاعتماديات حديثة: ai v7، Sentry v10، React 19.2، Vite 7.2، TS 5.9، AWS SDK 3.1115. ملاحظات صغيرة: @typescript-eslint v6 (الحالية v8)، zod 3 (الحالية 4)، Express 4 (مقبول).
- ✅ ثقافة اختبار واضحة: 30+ ملف اختبار backend، scripts تشخيصية لكل مزود (deepgram-probe, model-routing-check…)، e2e للـ STT relay.

---

## Prioritized Action Plan

| # | الإجراء | الجهد | الأثر |
|---|---------|-------|-------|
| 1 | أصلح محفزات CI: أضف `master` (أو انقل الفروع) | S | كل الاختبارات تصبح مفروضة فوراً |
| 2 | هجرة 033: RLS + policies لـ chat/memory/email tables (انسخ من full_schema) وشغّلها | M | أي rebuild مستقبلي آمن |
| 3 | `/voice/agent/turn`: Zod + `.max()` + مفتاح idempotency | S | يغلق باب bloat/التكرار |
| 4 | `match_documents`: أضف p_user_id (مثل 024) أو احذف المسار الفارغ | S-M | يزيل اللغم الكامن + RPC ميت |
| 5 | قسّم الفرع الحالي لcommits منطقية قبل الدمج | S | نظافة تاريخ + أمان مراجعة |
| 6 | وحّد كتالوج الموديلات بمصدر واحد واحذف ids الميتة | S | إزالة dead UI + drift |
| 7 | AgentVoiceButton: `crypto.randomUUID()` + retry للـ persist | S | استقرار UX صوتي |
| 8 | Supabase Dashboard: فعّل leaked-password protection؛ انقل extensions | S | إغلاق تحذيرات advisors |
| 9 | واصل تقسيم ChatHistoryContext/useChatRuntime/MessageComponents | M (تدريجي) | قابلية صيانة الواجهة |

## Coverage (بشفافية)
**عميق**: entry/auth/CORS/rate-limiting، voice routes + زر الوكيل، chat routes + pipeline (بنية + ستريمنغ + أخطاء)، retrieval hybrid، WS STT (مصادقة)، migrations + **القاعدة الحية تجريبياً**، docker/CI/deps، diff غير المُرحّل.
**خفيف/متروك لجولة قادمة**: services/memory الداخلية (7 ملفات كبيرة)، textbook/textbook-worker، أدوات email/calendar بالتفصيل، ChatHistoryContext الداخلي (728 سطر)، MicButton/الستاك القديم، tts-stream-ws، محتوى prompts.

---
*المراجعة القديمة (DEEP_CODE_REVIEW.md، 21 آب) لا تزال مرجعاً صالحاً لتاريخها؛ هذا التقرير يحل محلها كصورة حالية.*

---

## Resolution Log (applied 2026-08-28, overnight hardening pass)

| Commit | Fix |
|--------|-----|
| b0351e1 | CI triggers → master/main/develop (CI never ran before) |
| a7c12d3 | Migration 033: RLS backfill (chat/memory/ban tables) + re-scope 3 "Service role" policies that were TO public — **live anon-CRUD vuln empirically proven then closed** (INSERT now 42501) |
| 27664d6 + a5eaf27 | /voice/agent/turn: Zod + 20k caps + turnId idempotency (Redis SET NX) + client retry |
| 6a601fa | Migration 034: match_documents user-scoped (p_user_id); stale 3-arg overload dropped |
| 0a0e47c..9ddd497 | WIP split into 13 logical commits (87 comments-only files verified mechanically) |
| 0d3b3cd | 12 retired model ids pruned (verified vs Groq/OpenRouter live catalogs); qwen3.8-27b added; ALLOWED_MODELS/DEFAULT_MODEL moved into the model catalog (layer fix) |
| 995d627 | ArtifactPanel regression from layout refactor restored (panel was dead) |
| 9af69c1 + 5bf24f8 | Migration 035: RLS for 13 orphan tables (40 policies, re-scoped TO authenticated); applied live |
| 521656a | pdf-processor CI job + PDF_PROCESSOR_TOKEN plumbing + unauthenticated-run warning; migrations README drift notes; structured logging in web-search |
| 077bb13 | ws 8.21.3 (memory-disclosure + fragment-DoS advisories patched) |

**Verification state:** backend 754/754, frontend 556/556, both typechecks clean, `vite build` succeeds. Live DB: 44/44 tables RLS-on, policies match migrations.

**Accepted risks / deferred (documented, deliberate):**
- adm-zip + sharp HIGHs are transitive inside @huggingface/transformers — no upstream fix; no untrusted ZIP/image input reaches them. Revisit when transformers ships updated onnxruntime.
- react-router 2 moderates: fix requires the 7.x major — schedule a dedicated upgrade.
- Extensions `vector`/`pg_trgm` in the public schema (advisor WARN): moving them requires rewriting every RPC's `SET search_path` — coordinated change, do in a maintenance window.
- Leaked-password protection: Supabase **Dashboard → Auth settings** — manual one-liner, not API-reachable.
- WS JWT via query string: works; move to first-frame auth when the voice stack is next touched.
- Vite chunks >1MB (index 1.5MB): vendor already split; further app-code splitting is a perf project, not a blocker.
- Local pdf-processor venv on Windows can't load PyMuPDF (machine missing the standard VC++ 2015–2022 runtime — only _clr0400 variants present). Install `vc_redist.x64` from Microsoft to restore local pytest; CI now covers the tests on clean Ubuntu regardless.

### Follow-up pass (same day, evening)

| Item | Outcome |
|------|---------|
| Leaked-password protection | **Plan-gated**: Management API returns 402 "available on Pro Plans and up" — project is on Free. Enable after upgrading, or ignore. Compensating control applied instead: `password_min_length` raised **6 → 8** via Management API (verified). |
| react-router | **Upgraded 6.30.3 → 7.18.3**. App uses library-mode APIs only and had the v7 future-flags already enabled, so migration was one line (drop the now-invalid `future` prop). Audit: frontend production deps now **0 vulnerabilities**. Typecheck + 556/556 tests green. |
| Extension schema move (vector/pg_trgm out of public) | **Closed with evidence, not moved.** The advisor's shadowing vector requires CREATE on schema public — verified `has_schema_privilege(...,'CREATE') = false` for anon/authenticated/service_role. Additionally, no database role's search_path includes `extensions`, so the move would have required touching role settings + every RPC's search_path on a live DB serving chat traffic. Risk/benefit says: keep, revisit only if CREATE privilege is ever granted on public. |

### Second follow-up pass (deep dive into uncovered modules)

| Commit | Outcome |
|--------|---------|
| c95c605 | **Email scheduler worker**: the pending→processing "lock" checked error only (Supabase reports no error on zero-row updates) → racing workers could double-send; locks now verified via returned rows. Rows stuck in `processing` after a crash are reclaimed after 10 min instead of orphaned. Subjects CRLF-stripped at the provider choke point. |
| 51b8bf9 | **pdf-processor: 4 production bugs** surfaced once the suite could finally run (CI job + local runtime fixed): two constants were raw strings while code calls `.search()/.match()` on them (TOC + page-number detection crashed every page); `ARABIC_RE` counted Arabic punctuation as letters; `classify_page` ordering blanked short-titled covers and figure pages and let the `فهرس` TOC substring swallow Arabic index pages; `_int_color_to_hex` dropped the wrong byte of RRGGBBAA. `test_structure.py` rewritten from a stray vitest-syntax file into real pytest. |
| — | **Local pdf-processor venv restored**: VC++ 2015–2022 runtime installed (was missing → every PyMuPDF .pyd failed); local pytest now runs. **Suite: 106/106.** |
| — | **password_min_length 6 → 8** applied via Management API (compensating control; HIBP itself is Pro-plan-gated, 402). |
| — | Textbook worker audited — already has stuck-job sweeps, dead-letter retries and reconciliation; no change needed. |

### Third pass (audio streaming + memory services)

| Commit | Outcome |
|--------|---------|
| 65c6484 | **Deepgram relay**: a client disconnect during the upstream handshake left the just-opened Deepgram stream connected (billing) until Deepgram's own timeout — the session is now checked at `open`. |
| — | **Memory extraction service audited, healthy**: stuck-job cleanup every 5 min, retry sweep every 2 min, in-process dedup, dead-letter table. One latent note: the `pending→processing` claim is unverified (same class as the email-worker bug) but safe under the current single-replica deployment — revisit if the backend ever scales past one replica. |
| — | **Textbook worker audited, healthy** (stuck sweeps + dead letters + reconciliation). |
| — | **Flaky test fixed**: guest-redis-integration left ioredis's default endless retry strategy running after its availability guard gave up — the unhandled 'error' events intermittently killed 2 unrelated tests. Pinned `retryStrategy: () => null` + silent error listener; 3 consecutive full-suite runs now 754/754. |

### Fourth pass — the 9→10 items (code & security)

| Commit | Outcome |
|--------|---------|
| 2477fe7 | **Memory job claiming verified** (pending→processing must match a row) — closes the last known instance of the unverified-optimistic-lock class. |
| ef678f7 | **CI gates on new high-severity dependencies** (accepted adm-zip/sharp set allowlisted; any other high fails the build). |
| — | **Secrets scan**: full git history pickaxe-scanned for key patterns (groq/openrouter/google/anthropic/openai/private-keys) — only test placeholders (`gsk_test_key`, `sk-or-v1-test-key`); no real secrets ever committed; all .env files untracked. |
| cd9c0af | **WS JWTs moved out of upgrade URLs** into the first config frame (both relays + frontend clients + e2e probe). Verified live: anon-dev session authenticates and streams 128KB to Deepgram; garbage token → 4401 before ready. **Also fixed a P0 the startup smoke exposed**: sender.ts re-exported the `EmailTemplate` type as a value — the backend could not boot under node/tsx at all (tsc elides the name silently). |
| — | **First load test in project history** (autocannon, single replica, local): `/api/health` 1,891 rps · 0 errors · p99 35ms; `/api/guest` validation 1,421 rps · p99 32ms; `/api/chat` auth-reject 1,462 rps · p99 25ms (20–25 concurrent, 10–12s each). The app layer is not the bottleneck — provider quotas are, as expected. |

### Fifth pass — E2E testing (tests 9→10)

| Commit | Outcome |
|--------|---------|
| cacecaf | **True E2E suites** (backend `src/__tests__/e2e/`, run by the normal CI job): `server.e2e` boots the REAL index.ts — full middleware chain (helmet/CORS/global-limiter/auth/error-handler) — asserting health shape, 401s on missing+garbage JWTs across protected routes, dev-route gating, helmet headers, CORS origin rejection, 404 JSON. `ws-auth.e2e` drives REAL sockets: config-frame JWT auth (anon-dev → ready), missing/garbage token → 4401 before ready, binary-before-config → 4401. Auth edges mocked at Supabase getUser only; everything between is the production path. Backend suite: **766/766**. |
| — | Remaining axis for a future pass: browser-level E2E (Playwright: login → composer → guest chat render) + a provider-backed guest-chat SSE flow with a mocked LLM. |
