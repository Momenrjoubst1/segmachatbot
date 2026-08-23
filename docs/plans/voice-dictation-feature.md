# خطة ميزة الإدخال الصوتي — Voice Dictation System

**الحالة:** مقترح معتمد للتنفيذ | **الأولوية:** عالية | **المالك:** Momen
**آخر تحديث:** 2026-08-22 | **المرجع:** بحث موسّع 2026 (مصادر أدناه)

---

## 1. الهدف التجريبي (User Story)

كطالب أردني، أضغط زر المايكروفون في مربع النص، أتكلم بالعربية أو الإنجليزية،
**أرى كلماتي تظهر حيًّا في مربع النص وأنا أتكلم**، ثم أرسل الرسالة كأنني كتبتها —
نفس تجربة Claude/ChatGPT، وبجودة عربية تفوقهم في لهجتنا.

## 2. خلاصة البحث (2026)

| الخيار | العربية | البث الحي | التكلفة | التغطية |
|---|---|---|---|---|
| **Web Speech API** (متصفح) | جيدة عبر محرك Google (متغيرة) | ✅ interim مدمجة | $0 | Chrome/Edge/Opera/Safari14.1+ ≈ 87% مستخدمين؛ **Firefox معطّل** |
| **Deepgram Nova-3** | **الأفضل إنتاجيًا** (اختبار خليجي ممتاز، EOU≈424ms) | ✅ WebSocket <300ms | $0.0043/dقيقة + رصيد ترحيبي $200 | كل المتصفحات (الصوت يمر عبر سيرفرنا) |
| Groq whisper-turbo | ❌ ضعيف بالعربية ("horrible") | ❌ batch فقط | $0 مجاني | — مستبعد |
| OpenAI Whisper API | جيدة | ❌ batch فقط | $0.36/sاعة | — مستبعد |

**قرارات مفصلية من البحث:**
1. استبعاد Groq للصوت رغم وجود المفتاح — جودة العربية غير مقبولة إنتاجيًا.
2. Web Speech API يحقق تجربة Claude الكاملة (interim live) مجانًا وفورًا على
   غالبية المتصفحات — لكنه يعتمد على محرك Google ولا يغطي Firefox.
3. Deepgram Nova-3 هو الجودة المرجعية للعربية + يغطي كل المتصفحات — لكنه يتطلب
   أنبوب WebSocket عبر الباكند.

## 3. القرار المعماري: محركان خلف واجهة واحدة (Strategy: Dual-Engine)

```
┌────────────────────────── ThreadComposer ──────────────────────────┐
│  [+] [🎤 MicButton]                    Ask Sigma        [↑ Send]    │
└────────────┬────────────────────────────────────────────────────────┘
             │ useDictation() hook — State machine واحد
     ┌───────┴────────────────────────────────────────┐
     │            DictationEngine (interface)          │
     │  start() stop() abort()  onPartial  onFinal     │
     ├──────────────────────────┬──────────────────────┤
     │ ① WebSpeechEngine        │ ② DeepgramStreamEngine│
     │ (متصفح، فوري، $0)        │ (WS → باكند → Nova-3) │
     │ Chrome/Edge/Safari       │ شامل incl. Firefox    │
     └──────────────────────────┴──────────────────────┘
اختيار المحرك تلقائيًا: WebSpeech إن توفر وإلا Deepgram (إن فعّل المفتاح)،
مع override يدوي من الإعدادات لاحقًا.
```

- **① المرحلة الأولى (تُطلق أولًا):** WebSpeech فقط — تكلفة صفر، تجربة كاملة
  (interim live)، تغطي Chrome/Edge/Safari = الأغلبية الساحقة. Firefox: الزر
  لا يظهر + fallback كتابة (قاعدة بحثية صريحة).
- **② المرحلة الثانية:** Deepgram relay عبر الباكند لتغطية الجميع وثبات الجودة.

## 4. تفاصيل التنفيذ — المرحلة الأولى (Web Speech)

### ملفات جديدة
| الملف | المسؤولية |
|---|---|
| `frontend/src/hooks/useDictation.ts` | آلة حالات: `idle→requesting→recording→processing\|error`، feature-detect (`window.SpeechRecognition \|\| webkitSpeechRecognition`)، `lang` يتبع لغة الواجهة (`ar-JO` عند العربية وإلا `en-US`)، `continuous=true`, `interimResults=true`، إعادة تشغيل تلقائية عند `onend` المبكر (سلوك Safari ~60s)، تجميع `finalSegments[]` + `interimText` |
| `frontend/src/features/ai-assistant/ui/MicButton.tsx` | زر المايك داخل الشريط بجانب الإرفاق: حالات بصرية (MicIcon / مربع نابض أثناء الاستماع / Loader أثناء المعالجة)، tooltip ديناميكي، aria-labels، قائمة سياق "إيقاف" |

### ملفات معدّلة
| الملف | التغيير |
|---|---|
| `ThreadComposer.tsx` | تركيب `MicButton` بجانب `ComposerAddAttachment`؛ ربط `onPartial/onFinal`: النص المؤقت يظهر ملحقًا في مربع الإدخال ثم يستبدل عند final (نمط `unstable_useComposerInput` المجرَّب في DailyPlanPanel) |
| `i18n/locales/{ar,en}/chat.json` | مفاتيح `voice.*` (بدء/إيقاف/إذن مرفوض/غير مدعوم/فشل) |
| `.env.example` (frontend) | لا شيء — المرحلة الأولى بلا متغيرات |

### سلوكيات دقيقة (من نتائج البحث)
- `getUserMedia` يتطلب **HTTPS** أو localhost — توثيق ذلك.
- إذن المايكروفون مرفوض → toast + tooltip وليس انهيارًا.
- انقطاع شبكة أثناء الاستماع → محرك Google يُنهي الجلسة: نلتقط ما وصل نهائيًا وننبّه.
- حد أقصى جلسة 120 ثانية (حماية من جلسات معلقة) مع عداد بصري خفيف.
- لا نُخزّن أي صوت — النص فقط يدخل مسار الرسائل العادي (moderation يشملها).

## 5. تفاصيل التنفيذ — المرحلة الثانية (Deepgram Relay)

### Backend
| العنصر | التصميم |
|---|---|
| Endpoint | `WS /api/stt/stream?token=<jwt>` — تحقق JWT عند الupgrade (نفس سر authMiddleware) |
| الأنبوب | إطارات binary من العميل → Deepgram WS (`nova-3`, `language=multi`) → رسائل `Results` partials/finals تعود نصيًا للعميل |
| حدود | جلسة ≤ 120s، اتصال واحد متزامن/مستخدم، عداد دقائق يومي Redis (`stt:{uid}:{date}` بحد `STT_DAILY_MINUTES_LIMIT=30`)، إغلاق بكود واضح عند التجاوز |
| خصوصية | تمرير مباشر فقط — صفر تخزين صوت على سيرفرنا؛ النص يدخل نفس مسار الرسالة |
| ملفات | `backend/src/routes/stt.routes.ts` (upgrade handler) + `backend/src/services/stt/deepgram-relay.ts` + تسجيل في index.ts |

### Frontend
- `DeepgramStreamEngine` ينفذ نفس الواجهة (MediaRecorder/AudioWorklet → ws.send)
- منطق الاختيار: `WebSpeech ? webspeech : (deepgramConfigured ? deepgram : hide-button)`

### env
```
DEEPGRAM_API_KEY=
STT_DAILY_MINUTES_LIMIT=30
STT_MAX_SESSION_SECONDS=120
```

## 6. خطة الاختبار (معايير القبول)

| البعد | المعيار |
|---|---|
| وظيفي | إملاء عربي (لهجة أردنية) وإنجليزي يظهر live ويكتمل بدقة مقبولة؛ الإرسال يعمل بعدها مباشرة |
| متصفحات | Chrome/Edge/Safari desktop + iOS Safari ✓ يعمل؛ Firefox: زر مخفي + رسالة توجيه |
| متانة | رفض إذن، انقطاع شبكة، صمت 60s (Safari restart)، جلسة >120s، تبديل تبويب |
| أداء | ظهور أول كلمة مؤقتة < 1s (WebSpeech محلي الشعور) |
| أمان | 401 بلا توكن (مرحلة2)، حدود الدقائق تُغلِق الجلسة برسالة، لا صوت يُخزَّن |
| i18n | كل النصوص ar/en |

## 7. التكلفة المتوقعة
- المرحلة 1: **$0**.
- المرحلة 2 (بعد التفعيل): طالب = ~5 دقائق صوت/يوم ⇒ 100 طالب ≈ **$2.15/يوم** بسقف
  يومي 30 دقيقة/طالب؛ رصيد Deepgram الترحيبي ($200) يغطي البيتا كاملًا تقريبًا.

## 8. المخاطر والتحوطات
| الخطر | التحوط |
|---|---|
| Google يغيّر محرك WebSpeech | الواجهة مجردة — تبديل المحرك لا يمس UI |
| Safari يوقف الاستماع بعد ~60s | إعادة تشغيل تلقائية مع دمج المقاطع النهائية |
| Firefox | مرحلة 2 تغطيه؛ حتى ذلك الحين fallback الكتابة واضح |
| جودة عربية WebSpeech متفاوتة | مقياس نجاح مرحلة 1؛ الترقية لNova-3 هي العلاج الجذري |

## 9. خارطة التنفيذ
1. **المرحلة 1** (نصف يوم): useDictation + MicButton + دمج Composer + i18n + اختبار يدوي مصفوفة المتصفحات.
2. **المرحلة 2** (1–2 يوم): relay الباكند + المحرك الثاني + الحدود والعداد.
3. **المرحلة 3** (تحسينات): إيقاف تلقائي بالصمت (VAD RMS)، اختصار Ctrl+Shift+M، مفردات جامعية مخصصة (custom vocabulary بمصطلحات الكتب المرفوعة).

---
### مصادر البحث
- voicearabic.com — Nova-3 vs Groq-turbo بالعربية (اختبار إنتاجي خليجي)
- AssemblyAI/CobaltCapture/caniuse — مصفوفة دعم Web Speech API 2026
- dev.to/toolfreebie — أسعار Groq/Deepgram/AssemblyAI والحدود المجانية
- futureagi/curionic — WER وظروف الضجيج وميزانيات الكمون
