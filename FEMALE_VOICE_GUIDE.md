# Female Voice Recommendations — Sigma Voice Agent
## حنون + هادئ + مناسب للطلاب

---

## 🎯 التوصية الأساسية: **Hope** (اللي عندك أصلاً)

| البند | القيمة |
|---|---|
| **Voice ID** | `tnSpp70v02xJRZlo8bqr` |
| **الوصف الرسمي** | "Smooth, Engaging and Kind" |
| **النوع** | Female, young adult |
| **الأفضل لـ** | Study buddy, teacher, healthcare, customer support |
| **يدعم العربي** | ✅ نعم (V3 multilingual) |
| **يدعم Audio Tags** | ✅ نعم |
| **العمر الصوتي** | 20s–30s |
| **اللهجة** | Neutral American English (يدعم code-switching مع العربي) |

**لماذا Hope مثالي للـ Sigma؟**
- "Smooth" → كلام ناعم بدون حدة
- "Engaging" → ما يطلع ممل، يجذب الانتباه
- "Kind" → دافئة وحنونة (مش robot)

---

## 🎙️ البدائل (لو بدك تجرّب)

### 1. **Aria** — واثقة ودافئة (للمستخدمين اللي يفضلون صوت أقوى شوي)

| البند | القيمة |
|---|---|
| **Voice ID** | `9BWtsMINqrJLrRacOk9x` |
| **الوصف** | "Confident, Warm, Energetic" |
| **متى تختارها** | لو بدك صوت أكثر "professional" بس دافئ |

### 2. **Matilda** — دافئة وصبورة (للطلاب الصغار)

| البند | القيمة |
|---|---|
| **Voice ID** | `XrExE9yKIg1WjnnlVkGX` |
| **الوصف** | "Warm, Friendly, Knowledgeable" |
| **متى تختارها** | لو جمهورك طلاب ثانوي أو أصغر، تشرح ببطء وصبر |

### 3. **River** — هادئة جداً (للـ focus mode)

| البند | القيمة |
|---|---|
| **Voice ID** | `SAz9YHcvj6GT2YYXdXww` |
| **الوصف** | "Calm, Conversational, Neutral" |
| **متى تختارها** | لو بدك صوت minimal، بدون مشاعر مبالغة |

### 4. **Custom Voice Clone** (لو بدك صوت أردني حقيقي)

ارفع ملف صوتي (3+ دقائق) لـ شخص أردني يتكلم طبيعياً، واعمل Clone.
- روح **Voices** → **Add Voice** → **Instant Voice Cloning**
- سمّها "Jordanian Female"
- ارفع ملف MP3/WAV نظيف
- استخدمها في الـ agent

---

## ⚙️ إعدادات V3 Model الموصى بها

لأنك على **V3 Conversational** model، الـ sliders القديمة (Stability/Similarity) **ما بتشتغل**. بدالها استخدم:

| الإعداد | القيمة | السبب |
|---|---|---|
| **Expressive mode** | ✅ ON | يفعّل الـ audio tags تلقائياً |
| **TTS Model** | `V3 Conversational` | أحدث model، multilingual + expressive |
| **Speaker Boost** | ✅ ON (auto) | تحسين الوضوح |

### Audio Tags اللي تناسب Hope + "حنون وهادئ":

```
[warmly]      — الترحيب والتشجيع
[gently]      — التصحيح بلطف
[thoughtfully] — التفسير العميق
[patiently]   — لما الطالب ما فهم
[whispers]    — للتأكيد على نقطة مهمة
[sighs]       — للتعاطف مع الإحباط
[laughs]      — للحظات طبيعية من المرح (نادراً)
```

### First Message المثالي لـ Hope:

```
[warmly] Hey there! I'm Sigma, your study buddy. What are we
diving into today — a concept, a quiz, or a summary?
```

---

## 🧪 كيف تختبر الصوت

بعد ما تختار الصوت، اعمل هاد الاختبارات في الـ preview:

| # | قل له | المتوقع |
|---|---|---|
| 1 | "Explain photosynthesis to me" | صوت هادئ، يشرح ببساطة |
| 2 | "I failed my exam" | صوت متعاطف، "oh no, that's rough..." |
| 3 | "Tell me a fun fact" | صوت ودود، مع ابتسامة في النبرة |
| 4 | "Quiz me on world capitals" | صوت واضح ومنظّم، يقرأ السؤال وينتظر |

إذا الصوت:
- **حساسيته زادت** (يبكي مع المستخدم) → قلل استخدام `[sighs]` و `[gently]`
- **مسطّح** (بلا تعبير) → زوّد `[warmly]` و `[thoughtfully]`
- **سريع زيادة** → استخدم [pauses] أو commas أكثر

---

## 📋 ملخص سريع

| القرار | الخيار |
|---|---|
| **صوت افتراضي (اللي عندك)** | `tnSpp70v02xJRZlo8bqr` (Hope) — **خلّيك عليه** ✅ |
| **صوت بديل أول** | `9BWtsMINqrJLrRacOk9x` (Aria) |
| **صوت بديل ثاني** | `XrExE9yKIg1WjnnlVkGX` (Matilda) |
| **لو بدك أردنية حقيقية** | Custom Voice Clone |

**النصيحة**: ابدأ بـ Hope اللي عندك (هي بالفعل تناسب "حنون وهادئ")، جرّبها مع الطلاب، إذا حسّيت إنها مش مناسبة جرّب Aria أو Matilda.
