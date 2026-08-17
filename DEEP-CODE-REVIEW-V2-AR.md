# مراجعة كود عميقة — Sigma AI Chatbot (الإصدار الثاني)

**تاريخ المراجعة:** 16 أغسطس 2026
**الفرع:** `feature/custom-composer` (107 ملفات معدّلة غير ملتزَمة، +4233/−1817 سطر فوق آخر commit)
**حجم المشروع:** ~27,100 سطر TypeScript في الباكند (153 ملفًا) + ~21,150 سطرًا في الفرونتند (157 ملفًا) + ~1,190 سطر Python لخدمة معالجة PDF
**التغطية:** مراجعة عميقة لطبقة الأمان، خطّ دردشة الكامل (chat pipeline)، أنظمة الذاكرة/RAG/الكتب الدراسية، أدوات الذكاء (بريد/بحث/تحليلات)، وخدمة PDF، ونواة الفرونتند (runtime + composer + سياقات + SW). مراجعة أخفّ لمكونات الواجهة الثانوية (calendar/artifacts/i18n) وبعض الأدوات (calculator/code/files).

---

## 1. الملخّص التنفيذي

النظام متقدّم معماريًا ومنظم جيدًا (pipeline من خطوات منفصلة، عزل صلاحيات في المسارات، circuit breakers، اختبارات)، وتحسّن ملموس منذ المراجعة السابقة (13 أغسطس): **أُصلحت معظم ملاحظاتها الفعلية** (timeouts في كل خطوات الـ pipeline، تسجيل الأدوات عبر metadata، إصلاح تسرّب الذاكرة في rate-limiters، فحص ملكية الـ threads في كل المسارات، dedup الذاكرة صار بمعامل Jaccard).

لكن المراجعة الحالية كشفت عن **3 ثغرات حرجة جديدة كلها في مسار الكاش**، تسمح — بطرق مختلفة — بتسريب محتوى خاص بين المستخدمين وحقن رسائل في محادثات الغير:

1. **مسار cache-hit يكتب في أي `threadId` بدون فحص ملكية** (`rag-retrieval.ts:442-501`) — والباكند يستخدم service-role key فيتجاوز RLS.
2. **كاش نتائج RAG عام لكل المستخدمين** بينما يحتوي مقاطع كتب خاصة (`rag-cache.service.ts:137`).
3. **كاش الردود الدلالي عام لكل المستخدمين** — ردود مُ شخصَنة تُقدَّم لمستخدمين آخرين (`response-cache.service.ts`).

كما رُصدت **ثغرة قفل mutex غير راجع (non-reentrant) تُجمّد فهرس BM25 عند كل إقلاع**، و**فساد ترميز مؤكد بالبايتات** في عدة ملفات يعطّل ميزة عربية كاملة ويشوّه نصوصًا تصل للمستخدم، و**بوابة تأكيد البريد قابلة للتجاوز**، و**جدولا بريد مجدول/إعادة محاولة بلا أي عامل معالجة** (ميزات صامتة معطوبة)، وثلاث مشاكل High في الفرونتند أبرزها **فساد البث العربي المتدفّق** (TextDecoder لكل chunk).

**الحكم العام:** البنية جيدة والإصلاحات السابقة حقيقية، لكن **النظام غير جاهز للإنتاج متعدد المستخدمين قبل إصلاح الثغرات الحرجة الثلاث في الكاش + قفل BM25 + فحص ملكية مسار الكاش.**

**أهم 5 إصلاحات (بهذا الترتيب):**
1. عزل الكاشات الثلاثة بمعرّف المستخدم + فحص ملكية `threadId` في `persistCacheHit` قبل أي كتابة.
2. إصلاح deadlock تهيئة BM25 (build-then-swap بدل القفل المتداخل).
3. إصلاح فساد الترميز في الملفات المتأثرة (إعادة حفظها UTF-8 سليم).
4. إصلاح عطل React الشرطي في `MessageSyncer` + رفع `TextDecoder` خارج حلقة القراءة.
5. ضبط `trust proxy` وربط `proxyLimiter` بالمصادقة، وجعل بوابة تأكيد البريد إلزامية.

---

## 2. تقييم المعمارية

**نقاط القوة:**
- فصل واضح للمسؤوليات: `routes → services → (pipeline steps) → supabase/redis`، وكل خطوة من خطوات الدردشة العشر في ملف مستقل قابل للاختبار (`backend/src/services/chat/pipeline/`).
- `ensureThreadOwnership` (`chat-shared.ts:217-240`) مطبَّق بثبات في كل مسارات threads (GET/DELETE/branch/pin/feedback) — `chat-thread.routes.ts` نموذجي.
- Circuit breakers على مستوى النماذج (`model-router.ts`) وعلى مزودي البحث الخارجيين، مع سلاسل fallback معرَّفة.
- قائمة انتظار الكتب مبنية على نمط LPUSH/RPOBLPUSH موثوق مع DLQ وsweep دوري.
- الفرونتند: مسار العرض آمن من XSS (react-markdown بدون `rehype-raw`، وDOMPurify للـ artifacts) — تأكيد مباشر.

**نقاط الضعف المعمارية:**
- **مفاتيح الكاش صُمّمت حول "السؤال" لا حول "المستخدم×السؤال"** — وهذا جذر الثغرات الحرجة الثلاث. أي بيانات تمر عبر الكاش يجب أن تكون معزولة بالمستخدم افتراضيًا.
- **Backend كله يعمل بمفتاح service-role** (`supabase.config.ts:33-34`)؛ كل سياسات RLS في migrations تُتجاوَز، فالعزل يقوم بالكامل على فلاتر `user_id` في الكود — أي مسار يفوتها فلتنةً يصبح ثغرة (وقد حدث في `persistCacheHit` وRPCs الكتب).
- **هجرة R2 نصف مكتملة**: مسار Supabase خاص بتوقيع مؤقت، ومسار R2 عام بروابط دائمة لا تُحذف أبدًا (`main.py:72-74` مقابل `006_security.sql`).
- **أنظمة معطوبة صامتة بلا مراقب**: جدولا `email_schedules`/`email_jobs` بلا مستهلك، `retryDeadLetters` بلا مستدعٍ، و`cleanupOldMemories` يحذف من جدولين غير موجودين في أي migration — أخطاء لا يراها أحد لأنها لا تُخطئ أصلًا.
- نظام agents بالكامل (`agent.service.ts` +520 سطرًا) كود ميت: مجلد `agents/` غير موجود ولا يستورده أحد.
- تعدد مصادر الحقيقة للمزودين: README (Azure/Groq/GitHub/OpenRouter/Fireworks/Novita) vs ARCHITECTURE.md (Groq/OpenAI/Gemini/DeepSeek/Qwen) vs فحوص البيئة في الكود (+BIGMODEL) — توثيق متضارب.

---

## 3. النتائج حسب الوحدة

### 3.1 طبقة الأمان (auth / rate-limiting / proxy / guest)

| الخطورة | الملف:السطر | المشكلة | الإصلاح المقترح |
|---|---|---|---|
| 🔴 High | `app.config.ts:41-43`, `rate-limiters.ts:244,263,282`, `index.ts:83` | `trustProxyHops=1` افتراضيًا وكل محددات المعدل مبنية على `req.ip` — أي عميل يصل مباشرة (Docker/LB خاطئ) يزوّر `X-Forwarded-For` ويحصل على دلاء معدل جديدة بلا حدود؛ حصة الزوّار (التحكم الوحيد بتكلفة LLM لغير المصرّح لهم) غير قابلة للإلزام فعليًا | الافتراض `0` + قيمة إنتاج صريحة مطابقة لطوبولوجيا النشر + سقف عام لكل instance |
| 🟠 Med | `auth.middleware.ts:102-143,193-198` | كاش الجلسة (مُفتاح correctly بhash التوكن) لا يعيد التحقق من Supabase خلال 300 ثانية؛ توكن ملغى يستمر بالعمل ≤5 دقائق، والحظر يسري بعد ≤60 ثانية | قصّ TTL على `min(300, exp-now)` + إبطال عبر Redis pub/sub |
| 🟠 Med | `chat.routes.ts:16-22` | `newChatLimiter` الأشد يُتخطى بمجرد إرسال أي `threadId` وهمي من العميل قبل أي تحقق | طبّقه دائمًا أو تحقق من الملكية أولًا |
| 🟠 Med | `guest.routes.ts:248-254,368-371` | عند تعطل Redis تتحول حصة الزوار لذاكرة لكل عملية (× عدد الـ instances) + PING حي لكل طلب يضاعف الكمون أثناء العطل | قاطع دائرة + سقف متحفظ لكل instance + كاش نتيجة ping ~5 ثوان |
| 🟠 Med | `proxy.routes.ts:20-22`, `safe-fetch-url.ts:162-165` | البروكسي يخدم `image/svg+xml` من أصل الـ API (وdicebear الافتراضي SVG) — الحماية الوحيدة هي CSP الافتراضي من helmet | حصر الأنواع بـ png/jpeg/gif/webp/avif أو CSP+attachment |
| 🟡 Low | `rate-limiters.ts:244` + `index.ts:117` | مفتاح `proxyLimiter` لكل مستخدم لا يعمل أبدًا (`req.user` غير موجود لحظة احتسابه لأن auth داخل المسار) | ربط auth قبل limiter |
| 🟡 Low | `safe-fetch-url.ts:16-37,105-108` | نطاقات IPv6-mapped/NAT64 وCGNAT غير محجوبة (محمية اليوم بالسماحية allowlist) | مكتبة parse صارمة ترفض كل ما ليس global-unicast |
| 🟡 Low | `logger.ts:52-54` + `request-id.ts:20-22` | `traceStorage.disable()` يعطّل ALS لكل العمليات → فقدان requestId من اللوجات تحت التزامن | `traceStorage.run()` بدل disable |
| 🟡 Low | `error-handler.ts:76-86` | `context` يُعاد للعميل كما هو — تسريب تفاصيل داخلية على بعد استدعاء واحد | احجبه عن الاستجابة وأبقه للوج |
| 🔵 Note | `auth.middleware.ts:168,172` | فحص `banned_until` من بيانات auth ميت (الحقل غير موجود في `getUser()`) | استخدم `user_metadata` أو احذف الفرع |
| 🔵 Note | `safe-fetch-url.ts:129-146` | تثبيت IP لمنع DNS-rebinding يكسر HTTPS (فشل شهادة الـ SNI) — تحكم معطوب يدعو لأحد "إصلاحه" بحذفه | undici Agent مع `servername` مخصص |
| 🔵 Note | `rate-limiters.ts:9-17` | جدول التوثيق يعد بـ limiters غير موجودة (livekit/agent/moderation) | طابق التوثيق مع الواقع |

**ملاحظات المراجعة السابقة:** تسرّب `fallbackCounters` **أُصلح** (تنظيف ذاتي + sweep كل 5 دقائق)، استعلام الحظر المزدوج **أُصلح**، وSSRF في البروكسي **أُغلق عمومًا** (allowlist افتراضية + فحص كل أجوبة DNS + تثبيت IP + إعادة فحص التحويلات).

### 3.2 خط الدردشة (chat pipeline + streaming + caches)

| الخطورة | الملف:السطر | المشكلة | الإصلاح المقترح |
|---|---|---|---|
| 🔴 Critical | `rag-retrieval.ts:442-501` (يُنفَّذ في الخطوة 5 قبل فحص ملكية الخطوة 7) | **`persistCacheHit` يكتب رسالتي user/assistant في أي `threadId` يرسله العميل بدون `ensureThreadOwnership`** — والباكند بservice-role key (RLS متجاوَز). الاستغلال: مستخدم مصرّح يزرع سؤالًا في الكاش ثم يعيد إرساله مع threadId الضحية → يحقن رسائل في محادثته (المصادقة تمر عبر `authMiddleware` لكن الملكية لا تُفحص إطلاقًا في هذا المسار) | استدعِ `ensureThreadOwnership(req, threadId)` أول شيء في `persistCacheHit` أو مرّر الحل عبر `resolveThread` قبل أي كتابة |
| 🔴 Critical | `rag-cache.service.ts:132-174` + `rag-retrieval.ts:331-348,362` | **كاش نتائج RAG مفتاحه `rag:results:{hash(query)}:{count}` بلا userId**، والنتائج المُخزَّنة تتضمن مقاطع كتب خاصة (`content`, `file_name`, `page_number`) — المستخدم "ب" بنفس الاستعلام خلال TTL 1800 ثانية يستلم مقاطع كتب المستخدم "أ" داخل سياق الـ LLM | أدرج `userId` في المفتاح أو استبعد مقاطع الكتب من النتائج القابلة للتخزين |
| 🔴 Critical | `response-cache.service.ts:79,113-171` + `rag-retrieval.ts:136-159` | **كاش الردود بفهرس عام واحد**؛ شروط التجاوز (`shouldBypassCache:102-107`) تغطي المواد/الأدوات/المتابعات لكن **ليس الذاكرة ولا هوية المستخدم** — رد مُ شخصَن بذاكرة المستخدم "أ" يُقدَّم حرفيًا للمستخدم "ب" عند تشابه ≥0.92، ويُحفَظ كرسالة حقيقية في محادثته (`persistCacheHit`) | عزّل الفهرس والمدخلات بـ `userId`، وتجاوز الكاش متى ساهمت الذاكرة أو الكتب في الرد |
| 🟠 Med | `rag-retrieval.ts:447-457` | بدون `threadId` يُلحق تبادل cache-hit بأحدث جلسة للمستخدم (حسب `created_at`) — الرسالة تهبط في محادثة قديمة/خاطئة | استخدم نفس منطق `resolveThread` (idempotency GUID + الجلسات الفارغة) |
| 🟠 Med | `moderation.service.ts:131-137,182-193` | الإشراف **fail-open** في الإدخال والإخراج عند تعذر Edge Function؛ واختبار `moderation-failclosed.test.ts` لا يختبر ذلك إطلاقًا (فحص exports + طول فقط) — اسمه مضلل ويمنع ثقة زائفة | قرار صريح: fail-closed للإخراج على الأقل + اختبار حقيقي يحاكي تعطل الخدمة |
| 🟠 Med (أداء) | `response-cache.service.ts:121-136` | كل طلب دردشة يعمل `JSON.parse` لفهرس كامل (حتى 500 embedding × 768 بُعدًا ≈ ميغابايتات) — عبء CPU متكرر؛ و`invalidateByPattern:257-290` خارج قفل الكتابة فيمكنه إحياء مدخلات محذوفة | Redis sorted-set/hash بدل مفتاح JSON واحد |
| 🟡 Low | `response-generator.service.ts:351-354` + `model-router.ts:295-300` | رسالة "التدهور السلس" تُحسب وتُسجَّل في اللوج فقط ولا تصل للمستخدم أبدًا | اكتبها في أول chunk من الستريم |
| 🟡 Low | `thread-lookup.service.ts:217` | محارف `%`/`_` غير مهرَّبة في `ilike` البحث عن محادثة | escaping قبل الاستعلام |
| 🟡 Low | `agent.service.ts:40-44` + `index.ts:208` | `process.exit(1)` عند الاستيراد دون `AGENT_INTERNAL_SECRET` قد يجهض الإطفاء الرشيق منتصفه؛ والنظام كله كود ميت (لا مجلد `agents/`، لا مستورِد) | احذف النظام أو انقله لمستودع الخدمة الصوتية |

**إصلاحات مؤكدة لملاحظات سابقة:** كل خطوات الـ pipeline الآن بـ `withTimeout`؛ تسجيل الأدوات عبر `tool-metadata.ts` (لا قوائم يدوية)؛ `moderation` يعيد مصفوفة جديدة بدل التعديل الموضعي؛ مسارات threads كلها تفحص الملكية؛ `model-router` وcircuit breaker وsummarization سليمة.

### 3.3 الذاكرة / RAG / الكتب الدراسية / خدمة PDF

| الخطورة | الملف:السطر | المشكلة | الإصلاح المقترح |
|---|---|---|---|
| 🔴 High | `bm25-search.ts:210,232` + `async-mutex.ts:17-29` (يُستدعى من `index.ts:78`) | **Deadlock عند الإقلاع**: `initializeBM25FromDB` داخل `runExclusive` يستدعي `setBM25Docs` الذي يطلب نفس الـ mutex غير الراجع → القفل لا يُحرَّر أبدًا؛ فهرس BM25 لا يُبنى، وأي `addBM25Doc` لاحق يعلّق، وreindex الإداري يعلّق الطلب. يحدث كل مرة يوجد فيها صفوف في `documents` | build-then-swap: ابنِ الفهرس محليًا ثم انشره تحت القفل مرة واحدة، أو اجعل الـ mutex reentrant |
| 🔴 High | `textbook.routes.ts:33-37`, `textbook-processor.ts:62-81`, `main.py:243-267` | **لا حدود حجم/صفحات على مستوى الخادم**: فحص 200MB يعتمد على `file_size_bytes` الاختياري من العميل؛ PyMuPDF يكرر كل الصفحات بلا سقف؛ عامل واحد بذاكرة 1GB → PDF قنبلة واحد يقتل الحاوية **ويجمّد قائمة انتظار الكتب للجميع**، والباكند يحمّل الملف كاملًا في الذاكرة (سقفه 512MB) | فرض Content-Length/تدفق محدود + سقف صفحات (مثلًا 2000) + مهلة صلبة داخل Python نفسها |
| 🔴 High | `textbook-queue.ts:150-179,112-142`, `textbook-worker.ts:157-171` | **التعافي من الانهيار ناقص**: `sweepStuckJobs` لا يحدّث `textbooks.status` (يبقى "processing" للأبد)؛ `retryDeadLetters` **بلا أي مستدعٍ** (DLQ بئر سوداء)؛ العامل `break` بعد 10 أخطاء متتالية ولا شيء يعيد تشغيله؛ وفشل enqueue بعد إدراج الصف يترك الكتاب "pending" للأبد | حدّث الحالة إلى failed عند الsweep + استدعِ retry في الsweep الدوري + supervisor بإعادة تشغيل بعد تهدئة |
| 🟠 Med | `main.py:51-77,270-280` + `textbook.routes.ts:248-265` مقابل `006_security.sql:8-21` | **صور R2 عامة للأبد**: روابط عامنة بمعرّفات تسلسلية قابلة للتخمين `{R2_PUBLIC_URL}/textbooks/{user}/{book}/fig_*.png` بدون توقيع، والحذف يمسح Supabase فقط — صور الكتاب المحذوف تبقى متاحة علنًا؛ يتناقض مع مسار Supabase الخاص/Mوقّع | presigned GET قصير الأجل + تخزين المفتاح المجرد + حذف R2 في مسار الحذف |
| 🟠 Med | `002/008 migrations` + `textbook-search.ts:184-200,346-367` + `textbook.routes.ts:40-49,71-92` | **RPCs الكتب بلا معامل user_id** (النطاق بـ textbook_id فقط) و`searchTextbookChunks` يستقبل userId ولا يستخدمه؛ ورفع الكتاب **يثق بـ `file_content_hash` من العميل** — من يعرف hash ملف الضحية ينسخ فهرسه/عدد صفحاته عبر المستخدمين | أضف `p_user_id` للـ RPCs + تحقق من الhash خادميًا + `.eq("user_id", …)` في كل lookups |
| 🟠 Med | `main.py:85-88,243-253` + `Dockerfile` (uvicorn 0.0.0.0) | خدمة PDF **بلا أي مصادقة** و`user_id`/`textbook_id` سلاسل حرة تُستخدم حرفيًا في مفاتيح R2 (كتابة في بادئة مستخدم آخر)؛ مخفّف اليوم بحصر المنفذ على loopback | توكن مشترك `PDF_PROCESSOR_TOKEN` + تحقق UUID للمعرّفات |
| 🟠 Med | `cross-session.service.ts:230-271` | كل دورة دردشة تُعيد تضمين (embed) حتى 50 رسالة × N جلسات بلا تخزين مؤقت — تكلفة وكمون ينموان مع تاريخ المستخدم | خزّن embedding لكل رسالة مرة واحدة أو كاشها بمعرّف الرسالة |
| 🟠 Med | `bm25-search.ts:55-59,216-234` | تهيئة BM25 تسحب **كل** جدول documents إلى ذاكرة العملية بلا سقف (يتضاعف مع كل replica) | سقف/تقسيم أو انتقل لـ Postgres FTS (المهيّأ أصلًا في migrations 010-011) |
| 🟡 Low | `textbook-processor.ts:221-234` مقابل `worker.ts:9-16` | أخطاء داخلية خام (رسائل Python، مسارات، URLs) تُخزَّن في `textbooks.error` وتُعاد للمستخدم كما هي | مرّرها عبر `sanitizeErrorMessage` |
| 🟡 Low | `007_security_fixes.sql:48-49` + `textbook-processor.ts:190-204` | فهرس unique على `(textbook_id, page, left(content,100))` يسقط **دفعات 100 chunk كاملة** عند تشابه البدايات (صفحات قوالبية) — فجوات محتوى صامتة | `onConflict: "do nothing"` (الحذف المسبق يضمن idempotency أصلًا) |
| 🔵 Note | `unified-memory.ts:443-467` | `cleanupOldMemories` يحذف من `user_memory_facts`/`cross_session_memory` — **غير موجودين في أي migration**؛ التنظيف اليومي no-op صامت | طابق الجداول أو احذف الكود |

**ملاحظات المراجعة السابقة:** dedup الذاكرة **أُصلح** فعلًا (Jaccard بحد 0.7 في `text-deduplicator.ts:152-187`)؛ سباق حالة BM25 أُصلح جزئيًا بقفل mutex — لكن الإصلاح نفسه أدخل الـ deadlock أعلاه.

### 3.4 أدوات الذكاء (بريد/بحث/تعليم) + التحليلات

| الخطورة | الملف:السطر | المشكلة | الإصلاح المقترح |
|---|---|---|---|
| 🔴 High | `tools/email/send/sender.ts:917` (مع schema:674-694) | **بوابة تأكيد البريد قابلة للتجاوز**: `confirm:true` بدون `confirmationId` يرسل فورًا ("No confirmation needed - send directly") — التأكيد استشاري يعتمد على أمانة النموذج؛ prompt-injection عبر محتوى RAG/الكتب قد يرسل بريدًا بصمت. يضاف إليه تمرير `html` غير معقّم (`:678`) وإقحام `subject`/`body` بلا escaping في القالب (`:597,:623`) → بريد تصيّدي من مرسل المنصة الموثوق | لا إرسال إلا بمسار confirmationId صالح؛ escape لكل interpolation؛ عقّم html أو ارفضه |
| 🔴 High | `email_schedules`/`email_jobs` (grep شامل: لا مستهلك خارج scheduler/sender) | **البريد المجدول لا يُرسل أبدًا** (إدراج فقط، بلا عامل معالجة)، و**إعادة المحاولة التلقائية وهمية** ("will be retried automatically" في `sender.ts:848` لا تنفذها شيء) | عامل دوري يعالج الجدولين أو حذف الميزة صراحةً |
| 🟠 Med | `sender.ts:1024-1025` | `.or()` filter injection في تاريخ البريد: يهرّب `%`/`_` لكن ليس `,` — استعلام مُفبرك يعدّل تعبير الفلترة | هرّب الفواصل والأقواس أو استخدم `.ilike()` مستقلة |
| 🟡 Low | `sender.ts:413-434` | `updateJobStatus` قراءة-ثم-كتابة (سباق على `attempts`) | تحديث ذرّي بـ RPC |
| 🟡 Low | `analytics.routes.ts:20-21,168-169` | `days`/`limit` غير محقّقين (NaN/قيم ضخمة) | clamp + تحقق |
| 🟡 Low | `analytics.routes.ts:100` | لوحة admin تعرض recentEvents الخاصة بالمدير نفسه تحت scope=platform | استخدم حدثًا عامًا |
| ✅ إيجابي | `analytics.routes.ts:91` | `requireAdmin` مطبّق على /dashboard وuser-dashboard معزول بالمستخدم — **ملاحظة المراجعة السابقة أُصلحت** | — |
| ✅ إيجابي | `tools/web/search/search-engine.ts` | تعدد مزودات بأولويات + circuit breakers + timeout قابل للضبط — **ملاحظة السابقة تحسّنت** | — |

### 3.5 الفرونتند (React 19 + composer الجديد)

| الخطورة | الملف:السطر | المشكلة | الإصلاح المقترح |
|---|---|---|---|
| 🔴 High | `useChatRuntime.ts:369-375` | **عطل React عند انقلاب حالة المصادقة**: `MessageSyncer` يستدعي `AuthenticatedMessageSyncer()` كدالة عادية بعد `return null` للزوار — عدد hooks يختلف بين المسارين (1 مقابل ~9)، وأي SIGNED_IN/OUT/SESSION_EXPIRED أثناء الدردشة يكسر invariant → ErrorBoundary يستبدل الواجهة كلها | `<AuthenticatedMessageSyncer />` كمكوّن حقيقي يملك hooksه |
| 🔴 High | `useChatRuntime.ts:640` (و623,643) | **فساد البث العربي**: `new TextDecoder()` جديد داخل حلقة القراءة مع `{stream:true}` — الكائن الجديد يرمي الجزئيات متعددة البايتات عند حدود الـ chunks فيخرج U+FFFD؛ **مسار الزوار يفعلها صحيحًا** (decoder مرفوع: 38,90) | ارفع decoder/encoder خارج الحلقة (بجوار parser:606) |
| 🔴 High | `supabaseClient.ts:44-52` + `useChatRuntime.ts:536-545` | **قفل المصادقة معطّل** (`lock: async (_,__,fn)=>fn()`) مع `autoRefreshToken` وrefresh مباشر في customFetch يتجاوز single-flight في `auth.ts:3-26` → تحديثات متزامنة لدوران التوكن = **تسجيلات خروج عشوائية/حلقات SESSION_EXPIRED** خصوصًا متعدد التبويبات | أعد القفل الافتراضي أو مرّر كل refresh عبر `getFreshToken()` |
| 🟠 Med | `useChatRuntime.ts:633-635,670-672` | setTimeout غير مُلغىً يعيد التنقل إلى thread قديم بعد 200ms من تبديل المستخدم | خزّن المعرف في ref وألغه في cleanup |
| 🟠 Med | `useChatRuntime.ts:451-488` | بوابة صور الزوار تقرأ حقولًا لا توجد إلا **بعد** التحويل → ميتة عمليًا (الصور تُسقط بصمت)، ولو عملت لرفضت أي نص يحوي "image/" | افحص `parts` قبل التحويل |
| 🟠 Med | `useChatRuntime.ts:301-324` + `ChatMessagesContext.tsx:182-184` | closure قديم في المزامنة العكسية + `appendMessage` غير idempotent → رسائل مكررة بعد التحديث الخلفي | أضف التبعية أو اجعل append يتخطى الموجود |
| 🟠 Med | `MessageComponents.tsx:666-670` | Retry الرسالة المقاطعة يقرأ `document.querySelector` لأول رسالة في الصفحة وليس الرسالة نفسها | `event.currentTarget.closest(...)` |
| 🟠 Med | `public/sw.js:1-3,26-37,69-91` + `App.tsx:19-26` | كاش SW بإصدار `v1` ثابت لا يُنقّى مع النشر + cache-first بلا فحص same-origin لوسائط Supabase + تسجيل غير مشروط حتى في dev يهزم إلغاء التسجيل في main.tsx | hash وقت البناء في الاسم + same-origin فقط + `import.meta.env.PROD` |
| 🟠 Med | `ThreadComposer.tsx:80,97,146-155,175,195-197` | الـ composer الجديد يتجاهل i18n (نصوص إنجليزية ثابتة رغم أن بقية المكونات تستخدم `useTranslation`) وبدون `dir="auto"` على المحرر — إدخال عربي بمؤشر ترقيم خاطئ في RTL | t() + dir="auto" |
| 🟠 Med | `ThreadComposer.tsx:161,171-192` | جذر `Unstable_TriggerPopoverRoot` متداخل مزدوج يفصل popover الـ "@" عن نطاق المحرر — سلوك هش يعتمد على internals | جذر واحد يلف المحرر + كلا الـ popovers |
| 🟠 Med | `supabaseClient.ts:50-51` | JWT في localStorage — مسار العرض آمن اليوم (react-markdown بلا rehype-raw + DOMPurify للـ artifacts) لكن أي انحدار مستقبلي في التعقيم = سرقة الجلسة كاملة | memory storage + silent re-auth أو اختبارات تحمي حدود DOMPurify |
| 🟡 Low | `ThreadComposer.tsx:34-59` | أوامر "/" الأربعة `console.log` stubs من مثال القالب — لا-op صامت للمستخدم | اربطها بسلوك حقيقي أو احذفها |
| 🟡 Low | `ArtifactPanel.tsx:33-35,50-54` | `/api/artifacts` نسبي يتجاوز `VITE_BACKEND_URL` وrefresh الـ 401 + قناة realtime تُعاد بناؤها مع كل نقرة | authFetch بالرابط الكامل + ref للمعرّف |
| 🟡 Low | `markdown-text.tsx:385-395` | عدّاد module-level يلوّن العريض بألوان متغيرة حسب ترتيب الرندر العام — يتقلب أثناء البث | index لكل رسالة أو CSS nth-child |

### 3.6 ملاحظات عرضية (Cross-cutting)

| الخطورة | الموضوع | التفصيل |
|---|---|---|
| 🟠 Med | **فساد ترميز مؤكد بالبايتات** | `thread-lookup.service.ts:41-110`: كل التعابير العربية مخزنة double-encoded (`c3 98 c2 b4...` بدل `d8 b4...` — تحقق hexdump مباشر) → **ميزة استدعاء المحادثات بالعربية معطولة كليًا** (لا تطابق أي إدخال حقيقي). كذلك `response-generator.service.ts:370` (رسالة خطأ عربية تصل المستخدم مشوّهة) و`user-courses.ts:35-38` (نص system prompt مشوّه يقدم للنموذج). ملفات سليمة مجاورة (moderation, summarization) تثبت أن المشكلة لكل ملف — أعد حفظ المتأثرة UTF-8 وافحص بـ CI |
| 🟠 Med | **بناء Docker للفرونتند مكسور** | `frontend/Dockerfile:9` ينسخ `pnpm-lock.yaml` غير الموجود (المستودع على npm/package-lock.json) → فشل البناء |
| ✅ إيجابي | **لا أسرار في المستودع** | فحص أنماط AIza/gsk_/sk-/eyJ... على الملفات المتابَعة: نظيف؛ `.env` محجوب صحيحًا؛ commit `2ce70ad` placeholder فقط |
| ✅ إيجابي | CI | typecheck + اختبارات للطرفين + Redis service حقيقي |
| 🔵 Note | حاويات | pdf-processor يعمل root (بلا USER)؛ backend بـ node ✅ وfrontend بـ nginx ✅ |
| 🔵 Note | اعتماديات | حديثة عمومًا (axios 1.13.6 حديث — **ملاحظة المراجعة السابقة عنه كانت خاطئة**؛ react 19.2.8 stable)؛ eslint 8 منتهي EOL؛ `heat-graph@0.0.14` حزمة صغيرة مجهولة تستحق تدقيقًا قبل الإبقاء |
| 🔵 Note | توثيق | تعارض قوائم المزودين بين README/ARCHITECTURE/الكود؛ CI بلا lint أو بوابة coverage |

---

## 4. خطة العمل ذات الأولوية

**سبرنتت 1 — أمان متعدد المستخدمين (إلزامي قبل أي إنتاج):**
1. **عزل الكاشات الثلاث بالمستخدم + فحص ملكية `persistCacheHit`** — جهد S، أثر حرج. (يغلق الثغرات الحرجة الثلاث دفعة واحدة)
2. **إصلاح deadlock تهيئة BM25** — جهد S (build-then-swap).
3. **إصلاح فساد الترميز** في thread-lookup/response-generator/user-courses + فحص ترميز في CI — جهد S.
4. **`trust proxy` = 0 افتراضيًا + قيمة إنتاج صريحة + ربط auth قبل proxyLimiter** — جهد S.
5. **إلزامية بوابة تأكيد البريد** (منع الإرسال الفوري بلا confirmationId) — جهد S.

**سبرنتت 2 — موثوقية التشغيل:**
6. إصلاحات الفرونتند الثلاث High (MessageSyncer hooks، TextDecoder، auth lock) — جهد M.
7. حدود PDF خادمية + مهلة داخل PyMuPDF — جهد M.
8. استكمال التعافي: تحديث status عند sweep + استدعاء retryDeadLetters + supervisor للعامل + عامل بريد للجدولين أو حذف الميزة — جهد M.
9. توقيع روابط R2 + حذفها مع الكتاب + UUID check وtoken لخدمة Python — جهد M.
10. `p_user_id` في RPCs الكتب + تحقق hash خادميًا — جهد M.

**سبرنتت 3 — جودة وكلفة:**
11. إصلاح Dockerfile الفرونتند (pnpm/npm) — جهد S.
12. تخزين embeddings الرسائل (إيقاف إعادة التضمين لكل دورة) — جهد M.
13. بقية الـ Mediums (كاش revocation، SVG proxy، guest quota، SW versioning، composer i18n/RTL…) — جهد L تراكمي.
14. حذف/توثيق الأنظمة الميتة (agent.service، banned_until، cleanupOldMemories، slash stubs) — جهد S.

---

## 5. ملحق — ملاحظات دنيا لم تدخل الأقسام الرئيسية

- `getEmailHistory` يستدعى بأمر Unbounded من options داخليًا فقط — آمن حاليًا.
- `chat-title-generator.service.ts`: Promise.race بلا abort للنموذج (يكمل في الخلفية حتى timeout) — أثر ضئيل؛ القفل الموزّع Redis للـ titling ممتاز.
- `getFallbackChain` فهرسة المحاولات `fallbackChain[streamAttempts]` (response-generator:333) صحيحة للسلاسل الحالية لكن هشة لو قصُرت سلسلة.
- مجلد `bee/` (أصول Three.js) في جذر المستودع — الأنسب نقله لأصول الفرونتند.
- توصية CI: مهمة lint + فحص `file-encoding` + `knip/depcheck` لكشف الكود الميت والحزم غير المستخدمة.

---

## منهجية التغطية (بشفافية)

- **مراجعة عميقة (قراءة كاملة):** كل خطوات chat pipeline والكاشات وmodel-router وthread routes (بنفسي)؛ طبقة الأمان 14 ملفًا (وكيل متخصص)؛ الذاكرة/RAG/الكتب/PDF + migrations ذات الصلة (وكيل متخصص، 52 قراءة)؛ الفرونتند النواة 17 ملفًا (وكيل متخصص)؛ البريد/التحليلات/البحث (بنفسي).
- **مراجعة أخفّ:** مكونات واجهة ثانوية (calendar/artifacts/i18n تفاصيل)، أدوات calculator/code/files، وbee/.
- **تحقق متقاطع:** الثغرتان الحرجتان في الكاش اكتُشفتا مرتين بشكل مستقل (مراجعتي + وكيل الذاكرة) — أعلى درجات الثقة.
- كل ملاحظة موثّقة بملف:سطر من قراءة فعلية للكود؛ ملف المتابعة التفصيلي: `review-scratch-v2.md`.

**إحصائية:** 3 Critical، 13 High، ~20 Medium، ~15 Low، ~8 ملاحظات — مقابل 5 إصلاحات مؤكدة لملاحظات المراجعة السابقة.

---

## 6. تحقّق ما بعد الإصلاح (16 أغسطس 2026 — نفس اليوم)

أُعيد فحص الكود بعد جولة الإصلاحات، مع تشغيل typecheck والاختبارات.

### ✅ إصلاحات مؤكدة (تم التحقق منها بالكود والبايتات)

| البند | الدليل |
|---|---|
| **Critical 1** — فحص ملكية cache-hit | `rag-retrieval.ts:513-530`: استعلام `chat_sessions` بـ `id + user_id` قبل أي كتابة، مع إنشاء جلسة جديدة كخيار احتياطي (يُصلح أيضًا ملاحظة الإلحاق بمحادثة خاطئة) + حراسة `headersSent` |
| **Critical 2** — عزل كاش RAG بالمستخدم | `rag-cache.service.ts:137,171`: بادئة `user:${userId}:` في المفتاح، و`userId` يُمرَّر من `rag-retrieval.ts:223,415` |
| **Critical 3** — عزل كاش الردود بالمستخدم | `response-cache.service.ts:83-88`: `getIndexKey`/`getItemKey` لكل مستخدم + تجاوز جديد `hasMemories` |
| **High** — deadlock الـ BM25 | `bm25-search.ts:234-240`: بناء محلي ثم swap تحت القفل مرة واحدة (لا تداخل) + سقف `.limit(5000)` |
| **High** — فساد الترميز | hexdump جديد لـ `thread-lookup.service.ts:44` = `d8 a7 d9 81...` (عربية سليمة)؛ رسالة الخطأ في `response-generator.service.ts:371` سليمة |
| **High** — trust proxy | `app.config.ts:39-41`: الافتراضي `0` والتحكم عبر `TRUST_PROXY_HOPS` |
| **High** — بوابة البريد | `sender.ts:770-774`: `confirm` بدون `confirmationId` يُرفض؛ مسار الإرسال المباشر حُذف (تعليق :937) |
| **High** — حدود PDF | `main.py:82` (`PDF_MAX_PAGES=2000` إلزامي :281-285) + توكن `PDF_PROCESSOR_TOKEN` (:97-98) + تحقق UUID للمعرّفات (:266-268) |
| **High** — تعافي القائمة (جزئيًا) | `retryDeadLetters` يُستدعى فعليًا (`textbook-worker.ts:39,48`) والsweep يضبط `status:'failed'` (`textbook-queue.ts:172`) |
| **High** — فرونتند الثلاثة | `MessageSyncer` عبر `React.createElement` (:374)؛ decoder/encoder مرفوعان خارج الحلقة (:611-612)؛ قفل المصادقة الافتراضي مستعاد (حُذف override) |
| **Med** — Dockerfile الفرونتند | `npm ci` + `package-lock.json` (Dockerfile:6-7) |
| **Med** — ترتيب proxyLimiter | `index.ts:117`: `authMiddleware` قبل الـ limiter (المفتاح لكل مستخدم صار فعّالًا) |
| **Med** — كلفة cross-session | كاش embedding ذاكري بـ TTL لكل رسالة (`cross-session.service.ts:39-67,273`) |

**التحقق التشغيلي:** backend typecheck ✅ + اختبارات 218/218 ✅ | frontend اختبارات 186/186 ✅

### ⚠️ ملاحظات على الإصلاحات
- `hasMemories` في `shouldBypassCache` لا يمرّره أي مستدعٍ بعد (الذاكرة تُبنى بعد خطوة RAG) — بامتناع عزل الكاش بالمستخدم صار الأمر مقبولًا، لكن المعامل حاليًا dead parameter.
- سقف BM25 (5000) يعالج اللا-حدودية جزئيًا فقط (يظل كامل الفهرس في ذاكرة كل replica).

### ❌ لم يُصلح بعد (منقول من الأقسام أعلاه)
1. **عامل البريد لجدولي `email_schedules`/`email_jobs`** (High) — ما زال بلا مستهلك؛ البريد المجدول لا يُرسل وإعادة المحاولة وهمية.
2. **عامل الكتب يتوقف نهائيًا** بعد `MAX_CONSECUTIVE_ERRORS` (textbook-worker.ts:175 — أُضيف backoff لكن الـ break باقٍ).
3. **R2 بلا روابط موقّعة والحذف لا يمسّ R2** (Med).
4. **RPCs الكتب بلا `p_user_id`** + الرفع ما زال يثق بـ `file_content_hash` من العميل (Med — textbook.routes.ts:40).
5. **تجاوز `newChatLimiter` بـ threadId وهمي** (Med — chat.routes.ts بدون تغيير).
6. **SVG في بروكسي الصور** — الفحص ما زال `startsWith('image/')` (Med).
7. **كاش المصادقة/الإبطال ≤5 دقائق** و**حصة الزوار عند تعطل Redis** (Med).
8. **SW بإصدار v1 ثابت** + **composer بلا i18n/RTL** + slash stubs (Med/Low).
9. **رسالة التدهور ما زالت log-only** و**`clearTraceContext` disable()** (Low).
10. **moderation ما زال fail-open** (قد يكون قرارًا مقصودًا — يُستحسن توثيقه أو تغطيته باختبار حقيقي).

### 🆕 مشكلة جديدة رصدتها جولة التحقق
- **CI سيَفشل على الفرونتند:** `ci.yml:65` (المعدَّل) يستدعي `npm run typecheck` لكن `frontend/package.json` لا يحتوي السكربت، و`tsc` الخام سيفشل أيضًا بسبب `skipLibCheck: false` وأخطاء d.ts في node_modules. الحل: أضف `"typecheck": "tsc --noEmit"` + اجعل `skipLibCheck: true` (مثل الباكند)، أو احذف الخطوة.

**الحكم بعد الإصلاح:** الثغرات الحرجة الثلاث **أُغلقت فعليًا** والمسار الحرج للإنتاج متعدد المستخدمين صار آمنًا حدًا كبيرًا، مع بقاء بنود High/Medium مفتوحة أهمها عامل البريد المفقود وتوقف عامل الكتب الدائم ومشكلة CI الجديدة.
