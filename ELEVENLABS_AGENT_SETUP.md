# دليل إعداد ElevenLabs Agent — Sigma Voice Mode
## متوافق مع الواجهة الجديدة (ElevenAgents Workflow + Guardrails 2.0)

> **الـ Agent ID**: `agent_6901m0xf4d8qfef8ascq70zhvdgp`
> **الرابط**: https://elevenlabs.io/app/agents/agents/agent_6901m0xf4d8qfef8ascq70zhvdgp/workflow

---

## 📍 خريطة الواجهة الجديدة

في الـ screenshot اللي أرسلتها، شفت الـ sidebar على الشمال فيه:

```
┌─ Overview (Agent basics)
├─ Spotlight
├─ Dashboards
├─ Configure
│   ├─ Agent
│   ├─ Procedures
│   ├─ Workflow        ← أنت هنا
│   ├─ Branches
│   ├─ Knowledge Base
│   ├─ Analysis
│   ├─ Tools
│   ├─ Coaching
│   └─ Guardrails (Alpha)
├─ Settings
└─ Monitor
    └─ Conversations
```

الـ **System Prompt** لازم يوضع في **حقل "System Prompt"** الموجود في:
1. **Subagent node** داخل الـ Workflow (الطريقة الأساسية)
2. أو **Agent tab → System Prompt** (لو ما بدك workflow، linear conversation)

---

## 🎯 الطريقة 1: في Workflow (الأساسية — أنصح فيها)

### خطوة بخطوة:

1. **افتح الـ Workflow tab** (أنت فيه الحين)

2. **شوف الـ Start node** (اللي في النص)

3. **اسحب Subagent node** من شريط الأدوات وحطه يمين الـ Start

4. **اربط الـ Start بالـ Subagent** (اسحب من النقطة الزرقاء بالـ Start إلى النقطة بالـ Subagent)

5. **اضغط على الـ Subagent** ليفتح الـ properties panel على اليمين

6. **الصق الـ System Prompt** من ملف `elevenlabs-agent-system-prompt.txt` كامل

7. **إعدادات الـ Subagent**:
   - **Name**: `Sigma Main`
   - **LLM Model**: `gpt-4o` (أو `claude-3-5-sonnet`)
   - **Temperature**: `0.7`
   - **Max Tokens**: `180`

8. **اختياري — أضف node ثانية** (لو بدك هيكل):
   - **Tool node**: "Save note" — لما المستخدم يقول "احفظلي..."
   - **End node**: في الآخر

9. **اضغط Publish** (الزر الأسود أعلى اليمين)

### الشكل النهائي للـ Workflow البسيط:

```
[Start] → [Subagent: Sigma Main] → [End]
            (System Prompt: full prompt)
            (Tools: save_note, kb_search)
```

### الشكل المتقدم (لو بدك branching):

```
[Start]
   ↓
[Subagent: Greeting]
   ↓ (LLM condition: user wants to study?)
   ├─ YES → [Subagent: Study Helper] (knowledge base attached)
   └─ NO  → [Subagent: General Chat]
                ↓
            [End: "Goodbye + recap"]
```

---

## 🎯 الطريقة 2: في Agent tab (أبسط — بدون workflow)

1. اضغط على **Agent** في الـ sidebar
2. الـ right panel فيه حقل **System Prompt**
3. الصق نفس الـ prompt من الملف
4. اضغط **Save** أعلى اليمين

هاد الخيار بيجعل الـ agent linear: Start → Agent → End بدون branching. مناسب لو ما بدك features متقدمة.

---

## 🎯 الطريقة 3: في Procedures (هيكل صريح)

الـ Procedures هي **steps مكتوبة** بلغة طبيعية بيفهمها الـ agent. مفيدة لو بدك تأكيد صريح على كل خطوة.

1. اضغط **Procedures** في الـ sidebar
2. اضغط **+ New Procedure**
3. اسمها: `Help student with topic`
4. **الـ Steps**:

```
Step 1: Greet the user warmly in their language (Arabic or English).
        Ask what they want to study, summarize, or quiz.

Step 2: Listen to their request. If unclear, ask ONE clarifying question.
        If clear, proceed.

Step 3: Provide the answer. Keep it 1-3 sentences (15-45 seconds of speech).
        NO markdown, NO bullet points, NO emoji. Speak naturally.

Step 4: End with a forward beat — a question or a small prompt
        ("Want to go deeper?", "أي سؤال ثاني؟") to keep the hands-free
        flow going.

Step 5: If the user says goodbye or clicks end, give ONE short warm
        goodbye and end the turn.
```

الـ Procedures مكملة للـ System Prompt — مش بديلة عنه. حط الاتنين.

---

## 🛡️ Guardrails 2.0 (Alpha — Security tab)

في الـ sidebar، اضغط **Guardrails** (أو **Security** حسب الـ build).

### فعّل هاد الـ Guardrails:

| الاسم | النوع | الـ Rule |
|---|---|---|
| **Focus** | Built-in | ✅ ON (يحافظ على الـ agent متمسك بالـ system prompt) |
| **Manipulation** | Built-in | ✅ ON (يحمي من prompt injection) |
| **Content** | Built-in | ✅ ON (يفلتر المحتوى غير اللائق) |
| **No medical diagnosis** | Custom | النص تحت |
| **No exam cheating** | Custom | النص تحت |

### Custom Guardrail: "No medical diagnosis"

اضغط **+ Add Custom Guardrail**، انسخ:

```
Rule: The agent must never provide medical diagnoses, prescribe medication,
or interpret symptoms. If the user asks about a health condition, the agent
should respond with a brief, empathetic redirect to a qualified medical
professional, in the user's spoken language. Allowed: general health
information, anatomy, biology education. Forbidden: "you have X condition",
"take Y medication", "your symptoms indicate Z".

Exit strategy: retry (with feedback: "I should redirect to a medical
professional instead of diagnosing.")
```

### Custom Guardrail: "No exam cheating"

```
Rule: The agent must not help with active graded exams, timed assessments,
or questions that suggest the user is being tested in real-time. The agent
CAN explain concepts, solve similar practice problems, or help with homework.
If the user mentions a live test, exam, or quiz with time pressure, decline
politely and offer to help them study the material instead.

Exit strategy: retry (with feedback: "I should offer to help them study
instead of answering the test question directly.")
```

### Custom Guardrail: "Voice-format compliance" (مهم جداً)

```
Rule: Every agent response must be SPOKEN language only. No markdown symbols
(*, #, **, >, -, bullet points, code fences), no URLs, no long literal
strings, no emoji. Numbers 1-10 must be spelled out in words. The response
must be 1-3 sentences (15-45 seconds of speech). It must end with a forward
beat (question or prompt) to keep the hands-free conversation flowing.

Exit strategy: retry (with feedback: "Format the response as spoken language
only, no markdown, 1-3 sentences, end with a forward beat.")
```

---

## 🧰 Tools (اختياري)

### Tool 1: Save Note (Client tool)

في **Tools** tab → **+ Add Tool** → **Client Tool**:

```json
{
  "name": "save_note",
  "description": "احفظ ملاحظة قصيرة في ملاحظات المستخدم لما يطلب منك. مثلاً: 'احفظلي هاد'، 'add a note about derivatives'، 'سجل هاد الكلام'. استخدمها لما المستخدم يطلب صراحة، أو لما يكون عندي معلومة مفيدة يستفيد منها لاحقاً.",
  "parameters": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "عنوان الملاحظة بالعربية أو الإنجليزية، 2-8 كلمات"
      },
      "body": {
        "type": "string",
        "description": "المحتوى الكامل للملاحظة. اكتبه بنفس اللغة اللي المستخدم استخدمها."
      }
    },
    "required": ["title", "body"]
  }
}
```

في الـ frontend، أضف handler يستدعي الباك إند:

```typescript
// في AgentVoiceButton.tsx أو hook جديد
useEffect(() => {
  if (!conversation) return;

  // ElevenLabs يرسل events لما الـ agent يستدعي tool
  const handleToolCall = (event: any) => {
    if (event.name === 'save_note') {
      // استدعي الباك إند
      authFetch(BACKEND_URL + '/api/notes', {
        method: 'POST',
        body: JSON.stringify(event.parameters),
      });
    }
  };
}, [conversation]);
```

### Tool 2: Search Knowledge Base (RAG)

ارفع PDFs في **Knowledge Base** tab (مثل: مناهجك، مذكراتك، glossary).

الـ agent بيقدر يبحث فيها تلقائياً. في الـ System Prompt، أضف:
```
If the user asks about specific content from a document they've uploaded,
search the knowledge base first using the search_knowledge_base tool.
```

---

## 📚 Knowledge Base (اختياري — لكن مفيد)

ارفع في **Knowledge Base** tab:
- **مناهجك الدراسية** (PDFs)
- **ملخصات المواد** 
- **Glossary عربي/إنجليزي** للمصطلحات STEM
- **أمثلة شائعة** لأسئلة الامتحانات

كل ما ارفعت أكثر، الـ agent يقدر يجاوب أدق.

---

## 🧪 اختبارات قبل الإطلاق

بعد ما تضبط الإعدادات كلها، اعمل هاد الاختبارات في الـ preview (الزر "Preview" أعلى اليمين):

| # | الاختبار | المتوقع |
|---|---|---|
| 1 | ابعت "اعطيني 5 نصائح للمذاكرة" | يرد بجمل قصيرة مش قائمة |
| 2 | خلّيه يتكلم وقاطعه بنص الجملة | يوقف فوراً (barge-in) |
| 3 | ابعت "what is المشتقة of x squared" | يرد مخلوط عربي/إنجليزي |
| 4 | اطلب شرح طويل لـ "Pythagoras theorem" | يقسمه على 3-4 turns ويسأل إذا بدك تكمل |
| 5 | قل "أعمللي تشخيص، عندي صداع" | يرفض ويوجهك لطبيب (Custom Guardrail) |
| 6 | قل "اكتبللي الجواب على سؤال 5 في الامتحان" | يرفض ويعرض يساعدك تدرس (Custom Guardrail) |
| 7 | اقفل وافتح الـ session | يستقبل بنفس الـ First Message |
| 8 | قل "احفظلي هاد" + معلومة | يستدعي save_note tool |

---

## 🔗 ربط بالـ Backend

### في `backend/.env`:
```
ELEVENLABS_AGENT_ID=agent_6901m0xf4d8qfef8ascq70zhvdgp
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxx
```

### الـ Frontend جاهز!

ملف `frontend/src/features/ai-assistant/ui/AgentVoiceButton.tsx` عنده:
- استدعاء `POST /api/voice/agent/session` على الباك إند
- الباك إند يطلب signed URL من ElevenLabs (`get-signed-url?agent_id=...`)
- الـ signed URL يُمرر لـ `startSession({ signedUrl })` في `@elevenlabs/react`

**ما تحتاج تعدّل كود** — بس ضيف الـ env vars وق الـ agent حيشتغل.

---

## 📁 الملفات

- `elevenlabs-agent-system-prompt.txt` — الـ prompt الكامل (17 KB)
- `ELEVENLABS_AGENT_SETUP.md` — هاد الدليل

---

## 🚀 خطوات سريعة (TL;DR)

1. افتح https://elevenlabs.io/app/agents/agents/agent_6901m0xf4d8qfef8ascq70zhvdgp/workflow
2. اسحب **Subagent node** واربطه بالـ **Start**
3. الصق الـ prompt من `elevenlabs-agent-system-prompt.txt`
4. اضبط LLM: `gpt-4o`، temp `0.7`، max_tokens `180`
5. اضغط **Agent tab** → Voice ID: `WAhoMTNdLdMoq1j3wf3I`، Stability `0.40`
6. **First Message**: `أهلاً وسهلاً! أنا سيجما...`
7. **Security tab** → فعّل Custom guardrails (3 اللي فوق)
8. اضغط **Publish**
9. في `backend/.env`: `ELEVENLABS_AGENT_ID=agent_6901m0xf4d8qfef8ascq70zhvdgp`
10. شغّل الـ backend والـ frontend، اضغط زر الفويس مود — بـ يشتغل! 🎉
