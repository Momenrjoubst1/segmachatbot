# نظام التحميل - التوثيق الشامل

> دليل كامل لفهم معمارية نظام التحميل في تطبيق Sigma AI Assistant، يشمل كل المكونات والحالات والسيناريوهات وطريقة العمل.

---

## الفهرس

1. [نظرة عامة على المعمارية](#1-نظرة-عامة-على-المعمارية)
2. [شجرة المكونات](#2-شجرة-المكونات)
3. [مكونات التحميل الأساسية](#3-مكونات-التحميل-الأساسية)
4. [حالة التحميل - Sources of Truth](#4-حالة-التحميل---sources-of-truth)
5. [السيناريوهات الكاملة](#5-السيناريوهات-الكاملة)
6. [تدفق العمل على الأرض](#6-تدفق-العمل-على-الأرض)
7. [处理 الأخطاء](#7-معالجة-الأخطاء)
8. [ملفات CSS والرسوم المتحركة](#8-ملفات-css-والرسوم-المتحركة)
9. [الملفات الكاملة](#9-الملفات-الكاملة)

---

## 1. نظرة عامة على المعمارية

### المبدأ الأساسي

نظام التحميل يعتمد على **3 طبقات**:

```
┌─────────────────────────────────────────────────┐
│  الطبقة 1: مصادر الحالة (State Sources)          │
│  useAuth, useCourses, useChatHistory, useCalendar │
│  → كل hook يملك isLoading خاص به                  │
├─────────────────────────────────────────────────┤
│  الطبقة 2: مكونات التحميل (Loading Components)   │
│  AppSkeleton, BarsSpinner, TopLoadingBar,         │
│  LoadingSpinner, Skeleton, MessageSkeleton        │
│  → مكونات بصرية نقية، لا تملك حالة              │
├─────────────────────────────────────────────────┤
│  الطبقة 3: نقاط العرض (Render Points)            │
│  App.tsx, AssistantApp.tsx, AssistantLayout.tsx,  │
│  SidebarView.tsx, MessageComponents.tsx            │
│  → تقرأ الحالة و تعرض المكون المناسب             │
└─────────────────────────────────────────────────┘
```

### القاعدة الذهبية

> **لا يوجد component واحد يقرأ أكثر من حالة تحميل واحدة.**
> كل component يقرأ فقط الحالة المتعلقة به.

---

## 2. شجرة المكونات

### شجرة التحميل الكاملة

```
App.tsx
├── if (isLoading auth) → AppSkeleton              ← الخطوة 1
├── if (!isAuthenticated) → LoginPage
└── <AssistantApp /> (lazy)
    └── ChatHistoryProvider
        ├── ChatDraftsProvider
        ├── ChatMessagesProvider
        └── ChatThreadsProvider
            └── AssistantAppContent
                ├── SidebarView                    ← دائماً يظهر
                ├── MobileSidebarView              ← دائماً يظهر
                ├── Header                         ← دائماً يظهر
                ├── {isLoadingMessages && TopLoadingBar}  ← خط رفيع علوي
                └── <motion.div key={chatKey}>
                    └── AssistantChatInner
                        └── Shadcn (AssistantLayout)
                            ├── <main>
                            │   ├── Thread          ← دائماً موجود
                            │   ├── {showLoading && BarsSpinner overlay}  ← تراكب
                            │   └── {coursesError && Error overlay}       ← تراكب
                            └── ArtifactPanel, EmailHistoryPanel
```

---

## 3. مكونات التحميل الأساسية

### 3.1 AppSkeleton (`components/ui/AppSkeleton.tsx`)

**متى يظهر:** فقط أثناء تحميل المصادقة (auth check) و Suspense fallback

**ماذا يعرض:**
- هيكل Sidebar (شريط جانبي) بعرض 260px
- هيكل Header
- 4 فقاعات رسائل (messsage bubbles) بعرض متدرج
- هيكل مربع الكتابة (composer)

**المظهر:**
```
┌──────────┬──────────────────────────────────┐
│ Sigma    │  ← Header skeleton               │
│ ───────  │──────────────────────────────────│
│ ● bar1   │                                   │
│ ● bar2   │  ████████████████  (right)        │
│ ● bar3   │       ████████████████████ (left) │
│ ● bar4   │  ██████████  (right)              │
│ ● bar5   │            ████████████████████    │
│          │  ┌────────────────────────────┐   │
│          │  │  Composer skeleton         │   │
│          │  └────────────────────────────┘   │
└──────────┴──────────────────────────────────┘
```

**كود التشغيل (App.tsx:26-28):**
```tsx
if (isLoading) {
  return <AppSkeleton />;
}
```

---

### 3.2 TopLoadingBar (`components/ui/TopLoadingBar.tsx`)

**متى يظهر:** أثناء جلب الرسائل (fetchMessages)

**ماذا يعرض:** شريط رفيع متحرك في أعلى منطقة الدردشة (YouTube/Notion style)

**المظهر:**
```
╔══════════════════════════════════════════╗
║ ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░ ║ ← شريط متحرك
╠══════════════════════════════════════════╣
║                                          ║
║  محتوى الدردشة...                       ║
```

**كود التشغيل (AssistantApp.tsx:306):**
```tsx
{isLoadingMessages && <TopLoadingBar />}
```

**الحالة:** `isLoadingMessages` من `useChatHistory()`

---

### 3.3 BarsSpinner (`components/ui/BarsSpinner.tsx`)

**متى يظهر:** أثناء تحميل الكورسات (coursesLoading) قبل الإكمال (onboarding)

**ماذا يعرض:** 12 شريطاً دواراً في نافذة تراكب شفافة

**المظهر:**
```
╔══════════════════════════════════════════╗
║                                          ║
║          ▐▐▐▐▐▐▐▐▐▐▐▐                    ║
║          (12 bars rotating)              ║
║                                          ║
║     [المحتوى خلف التراكب شفاف 80%]     ║
╚══════════════════════════════════════════╝
```

**كود التشغيل (AssistantLayout.tsx:263-267):**
```tsx
{showLoading && (
  <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
    <BarsSpinner size={60} className="text-primary" />
  </div>
)}
```

**الحالة:** `showLoading` = `coursesLoading && !localOnboarded`

---

### 3.4 LoadingSpinner (`components/ui/LoadingStates.tsx`)

**متى يظهر:** في various places (login, buttons, etc.)

**ثلاث أحجام:**
| الحجم | الأبعاد | الاستخدام |
|-------|---------|-----------|
| `sm` | 16×16 | داخل الأزرار |
| `md` | 32×32 | المكونات المتوسطة |
| `lg` | 48×48 | صفحات التحميل الكاملة |

---

### 3.5 Skeleton (`components/ui/skeleton.tsx`)

**المكون الأساسي:** `animate-pulse` بخلفية `bg-muted`

**يُستخدم في:**
- `AppSkeleton` - هيكل الصفحة الكاملة
- `ThreadListSkeleton` - هيكل قائمة المحادثات
- `MessageSkeleton` - هيكل الرسائل
- `ChatSkeleton` - هيكل المحادثة
- `ArtifactPanel` - هيكل اللوحة الجانبية

---

### 3.6 MessageSkeleton (`components/ui/LoadingStates.tsx`)

**ماذا يعرض:**
- فقاعة رسالة المستخدم (يمين)
- 3 نقاط "Thinking..." مع تأخير
- 3 خطوط نصية بعرض متدرج

**المظهر:**
```
                    ████████████████████  ← رسالة المستخدم
                                         
 ● ● ●  Thinking...                      ← نقاط التفكير
 ████████████████████████████████████████ ← خط 1
      █████████████████████████████████   ← خط 2
           █████████████████████████      ← خط 3
```

---

### 3.7 CompactSkeleton (`components/ui/LoadingStates.tsx`)

**ماذا يعرض:** هيكل محادثة كاملة (5 فقاعات + مربع كتابة)

**المظهر:**
```
           ████████████████████  (right)
  ████████████████████████████████ (left)
           ██████████  (right)
  ████████████████████████████████████████ (left)
       ████████████████████████  (left)
  
  ┌────────────────────────────────────┐
  │  Composer skeleton                 │
  │  📎                    📤 ▶       │
  └────────────────────────────────────┘
```

---

## 4. حالة التحميل - Sources of Truth

### خريطة الحالات

| الحالة | المصدر | الملف | ماذا تتحكم |
|--------|--------|-------|-----------|
| `isLoading` | `useAuth()` | `hooks/useAuth.ts` | هل لا يزال فحص المصادقة جارياً |
| `isLoading` | `useCourses()` | `hooks/useCourses.ts` | هل لا يزال جلب الكورسات جارياً |
| `coursesError` | `useCourses()` | `hooks/useCourses.ts` | رسالة خطأ جلب الكورسات |
| `isLoadingMessages` | `useChatHistory()` | `context/ChatMessagesContext.tsx` | هل لا يزال جلب الرسائل جارياً |
| `isLoadingThreads` | `useChatHistory()` | `context/ChatThreadsContext.tsx` | هل لا يزال جلب المحادثات جارياً |
| `threadsError` | `useChatHistory()` | `context/ChatThreadsContext.tsx` | رسالة خطأ جلب المحادثات |
| `showLoading` | مُشتق | `AssistantApp.tsx:157` | `coursesLoading && !localOnboarded` |
| `isRunning` | `useAuiState()` | assistant-ui | هل لا يزال الذكاء الاصطناعي يولّد |
| `calendar.isLoading` | `useCalendarSync()` | `features/calendar/` | هل لا يزال جلب أحداث التقويم جارياً |

### تدفق البيانات

```
useAuth.ts ──→ AuthContext.tsx ──→ App.tsx (isLoading)
                                         ↓
useCourses.ts ──→ AssistantApp.tsx (coursesLoading)
                         ↓
                   AssistantLayout.tsx (showLoading → BarsSpinner overlay)
                         
useChatHistory() ──→ AssistantApp.tsx (isLoadingMessages → TopLoadingBar)
                         ↓
                   SidebarView.tsx (threadsError → error UI)

useChatHistory() ──→ SidebarView.tsx (isLoadingThreads → ThreadListSkeleton)
```

---

## 5. السيناريوهات الكاملة

### السيناريو 1: التحميل البارد (Cold Load)

**المستخدم يفتح الرابط لأول مرة:**

```
الخطوة 1: المتصفح يحمّل index.html
  → يظهر هيكل HTML ثابت (CSS inline) خلال ~50ms
  → المستخدم يرى هيكل pulsing فوراً

الخطوة 2: main.tsx يتنفذ
  → React يأخذ السيطرة على #root
  → الهيكل الثابت يُستبدل بـ React tree

الخطوة 3: App.tsx يُظهر AppSkeleton
  → isLoading = true (المصادقة جارية)
  → المستخدم يرى AppSkeleton (نفس تصميم الهيكل الثابت)

الخطوة 4: useAuth يكمل فحص المصادقة
  → getSession() يقرأ من localStorage (~1-5ms)
  → isLoading = false

الخطوة 5: AssistantApp يبدأ التحميل الكسول (lazy)
  → المتصفح يحمّل AssistantApp chunk (319KB)
  → في نفس الوقت، useCourses يبدأ جلب الكورسات

الخطوة 6: AssistantApp mounts
  → ChatHistoryProvider → ChatThreadsProvider
  → fetchThreads() يبدأ
  → fetchMessages() يبدأ (إذا كان ?thread= موجوداً)

الخطوة 7: المستخدم يرى الواجهة الكاملة
  → Sidebar + Header + Thread + Composer
```

**الوقت الإجمالي:** ~3-4 ثانية (تعتمد على سرعة الاتصال)

---

### السيناريو 2: تبديل المحادثات (Thread Switch)

**المستخدم يضغط على محادثة في الـ Sidebar:**

```
الخطوة 1: المستخدم يضغط على محادثة
  → loadThread(id) يُستدعى
  → setSearchParams({ thread: id })

الخطوة 2: urlThreadId يتغير
  → ChatThreadsContext يقرأ ?thread= من URL
  → useEffect ينطلق

الخطوة 3: فحص الكاش
  → if (cache hit) → عرض فوري + تحديث في الخلفية
  → if (no cache) → setIsLoadingMessages(true) → fetchMessages()

الخطوة 4: TopLoadingBar يظهر
  → {isLoadingMessages && <TopLoadingBar />}
  → شريط متحرك في أعلى منطقة الدردشة

الخطوة 5: الرسائل تصل
  → setIsLoadingMessages(false)
  → TopLoadingBar يختفي
  → الرسائل الجديدة تظهر
```

**ملاحظة مهمة:** بعد Phase 1، `AssistantChatInner` لا يُعاد تشغيله بالكامل عند التبديل. فقط `motion.div` يتحول بـ fade animation. الـ Sidebar والـ Header يبقىان مستقرّين.

---

### السيناريو 3: تحميل الكورسات (_coursesLoading_)

**أول مرة يسجل المستخدم (onboarding):**

```
الخطوة 1: useCourses يبدأ fetchCourses()
  → isLoading = true
  → coursesError = null

الخطوة 2: AssistantAppContent يقرأ isLoading
  → coursesLoading = true

الخطوة 3: Shadcn يتلقى showLoading = true
  → showLoading = coursesLoading && !localOnboarded

الخطوة 4: BarsSpinner overlay يظهر
  → تراكب شفاف (bg-background/80)
  → 12 شريطاً دواراً في المنتصف
  → Thread والـ Composer لا يزالان موجودين (ولكن خلف التراكب)

الخطوة 5: الكورسات تصل
  → isLoading = false
  → showLoading = false
  → BarsSpinner overlay يختفي

الخطوة 6: إذا فشل الجلب
  → coursesError = "Failed to load courses..."
  → Error overlay يظهر بدل BarsSpinner
  → زر "Retry" متاح
```

---

### السيناريو 4: خطأ جلب المحادثات (Threads Error)

```
الخطوة 1: fetchThreads() يبدأ
  → isLoadingThreads = true
  → threadsError = null

الخطوة 2: الاتصال بالسيرفر يفشل
  → catch block ينطلق
  → threadsError = "Cannot reach the server..."

الخطوة 3: SidebarView يقرأ threadsError
  → بدلاً من ThreadList، يعرض:
    ┌─────────────────────────┐
    │  Cannot reach the       │
    │  server.                │
    │  [Retry]                │ ← زر إعادة المحاولة
    └─────────────────────────┘

الخطوة 4: المستخدم يضغط Retry
  → retryFetchThreads() يُستدعى
  → threadsError = null (يُمحى)
  → fetchThreads() يبدأ من جديد
```

---

### السيناريو 5: توليد الرسائل (AI Generation)

```
الخطوة 1: المستخدم يرسل رسالة
  → ComposerPrimitive.Cancel يظهر (زر الإيقاف)
  → ComposerPrimitive.Send يختفي
  → isRunning = true

الخطوة 2: الرد يبدأ بالتدفق
  → MessageComponents يعرض:
    - AssistantActivityIndicator (Thinking... / Writing... / Tool name)
    - dots متحركة
    - أو spinner للأدوات

الخطوة 3: الرد يكتمل
  → isRunning = false
  → Send button يعود
  → ActionBar يظهر (نسخ، إعادة المحاولة، إلخ)

الخطوة 4: إذا فشل الاتصال أثناء التدفق
  → FriendlyErrorMessage يظهر
  → يصنف الخطأ (network/auth/rate/server)
  → زر Retry + تفاصيل تقنية
```

---

### السيناريو 6: خطأ المصادقة (Auth Error)

```
الخطوة 1: تحميل الصفحة
  → isLoading = true (useAuth)
  → AppSkeleton يظهر

الخطوة 2: Supabase يقرأ الجلسة من localStorage
  → getSession() (~1-5ms)
  → إذا الجلسة صالحة: isAuthenticated = true
  → إذا الجلسة منتهية: 3 ثواني safety timer

الخطوة 3: إذا فشل الجلب
  → isLoading = false (إما من الاستجابة أو من timer)
  → isAuthenticated = false
  → LoginPage يظهر

الخطوة 4: إذا نجح الجلب
  → isLoading = false
  → isAuthenticated = true
  → AssistantApp يبدأ تحميله (lazy)
```

---

## 6. تدفق العمل على الأرض

### تسلسل الأحداث في كل ملف

#### `App.tsx` - بوابة المصادقة

```tsx
// الخطوة 1: فحص المصادقة
const { isAuthenticated, isLoading } = useAuthContext();

// الخطوة 2: إذا كان يُحمّل → عرض الهيكل
if (isLoading) return <AppSkeleton />;

// الخطوة 3: إذا لم يُصادق → عرض تسجيل الدخول
if (!isAuthenticated) return <LoginPage />;

// الخطوة 4: إذا نجح → عرض التطبيق
<Suspense fallback={<AppSkeleton />}>
  <AssistantApp />
</Suspense>
```

#### `AssistantApp.tsx` - هيكل التطبيق

```tsx
// الخطوة 1: قراءة الحالات
const { isLoadingMessages } = useChatHistory();
const { isLoading: coursesLoading, coursesError, retryCourses } = useCourses();

// الخطوة 2: حساب showLoading
const showLoading = coursesLoading && !localOnboarded;

// الخطوة 3: عرض TopLoadingBar
{isLoadingMessages && <TopLoadingBar />}

// الخطوة 4: تمرير الحالات إلى Shadcn
<Shadcn
  showLoading={showLoading}
  coursesError={coursesError}
  retryCourses={retryCourses}
  ...
/>
```

#### `AssistantLayout.tsx` - التنسيق الرئيسي

```tsx
// الخطوة 1: قراءة showLoading و coursesError
// (مُمررة من AssistantApp)

// الخطوة 2: عرض المحتوى (دائماً)
<Thread isOnboarded={isOnboarded} ... />

// الخطوة 3: تراكب التحميل (فقط إذا كان showLoading)
{showLoading && (
  <div className="absolute inset-0 z-10 ...">
    <BarsSpinner size={60} />
  </div>
)}

// الخطوة 4: تراكب الخطأ (فقط إذا كان coursesError)
{coursesError && !showLoading && (
  <div className="absolute inset-0 z-10 ...">
    <div>خطأ: {coursesError}</div>
    <button onClick={retryCourses}>Retry</button>
  </div>
)}
```

#### `SidebarView.tsx` - الشريط الجانبي

```tsx
// الخطوة 1: قراءة threadsError
const { loadThread, threadsError, retryFetchThreads } = useChatHistory();

// الخطوة 2: عرض القائمة أو الخطأ
{threadsError ? (
  <div>
    <p>{threadsError}</p>
    <button onClick={retryFetchThreads}>Retry</button>
  </div>
) : (
  <ThreadList ... />
)}
```

---

## 7. معالجة الأخطاء

### شجرة معالجة الأخطاء

```
App.tsx
└── ErrorBoundary (wraps entire app)
    └── BrowserRouter
        └── AuthProvider
            └── TitleProvider
                └── AppContent
                    └── ErrorBoundary (wraps AssistantApp)
                        └── Suspense (fallback = AppSkeleton)
                            └── AssistantApp
                                └── ChatHistoryProvider
                                    └── AssistantAppContent
                                        └── Shadcn
                                            └── ErrorBoundary (wraps each panel)
```

### أنواع الأخطاء ومعالجتها

| النوع | الملف | المعالجة |
|-------|-------|---------|
| خطأ جلب الكورسات | `useCourses.ts` | `coursesError` → Error overlay في AssistantLayout |
| خطأ جلب المحادثات | `ChatThreadsContext.tsx` | `threadsError` → Error UI في SidebarView |
| خطأ جلب الرسائل | `ChatMessagesContext.tsx` | `console.error` (لا UI حالياً) |
| خطأ تدفق الرسائل | `useChatRuntime.ts` | `interrupted: true` → `FriendlyErrorMessage` |
| خطأ المصادقة | `useAuth.ts` | `LoginPage` يظهر |
| خطأ Supabase getUser | `AssistantLayout.tsx` | `.catch(console.error)` |

### FriendlyErrorMessage (`MessageComponents.tsx:321`)

**يصنف الأخطاء عبر `classifyFetchError()` و يعرضها عبر i18n:**

| الفئة | المفتاح | i18n Key | الفحص |
|-------|---------|----------|-------|
| Network | `network` | `serverUnavailable` | "failed to fetch" / "networkerror" / "load failed" |
| Auth | `auth` | `sessionExpired` | "401" / "unauthorized" |
| Rate Limit | `rate` | `rateLimited` | "429" / "rate limit" |
| Server | `server` | `serverError` | "500" / "502" / "503" / "504" / "internal server" |
| Generic | `generic` | `processingError` | أي خطأ آخر |

**المكون يعرض:**
- عنوان الخطأ المترجم (`t(info.titleKey)`)
- زر Retry (`ActionBarPrimitive.Reload`)
- زر نسخ التفاصيل (`navigator.clipboard`)
- تفاصيل تقنية قابلة للتوسيع (`<details>`)

---

## 8. ملفات CSS والرسوم المتحركة

### `styles/animations.css` - الرسوم المتحركة الرئيسية

| الرسم المتحرك | المدة | الاستخدام |
|----------------|-------|-----------|
| `loading-bar` | 1.5s infinite | TopLoadingBar |
| `spin` | 1s linear infinite | LoadingSpinner, BarsSpinner |
| `pulse-dot` | varies | نقاط التفكير |
| `shimmer` | varies | تأثير اللمعان |
| `fadeInUp` | 0.3s | ظهور العناصر |
| `fadeInLeft` | 0.3s | فقاعات اليمين |
| `fadeInRight` | 0.3s | فقاعات اليسار |
| `loaderPulseRing` | varies | حلقة النبض |
| `loaderDotPulse` | varies | نقاط النبض |
| `simple-thinking-circle-bounce` | varies | نقاط التفكير البسيطة |

### `styles/components.css` - فئات CSS المخصصة

| الفئة | الوصف |
|-------|-------|
| `.status-loader-dot` | نقطة الحالة |
| `.animate-pulse-dot` | نقطة نبض |
| `.animate-spin-slow` | دوران بطيء |
| `.shimmer-bg` | خلفية لامعة |

### `BarsSpinner.module.css` - أنماط الدوران

- `styles.wrapper` - الحاوية الخارجية
- `styles.spinner` - الدوار
- `styles.bar` - كل شريط (12 شريطاً)

---

## 9. الملفات الكاملة

### مكونات التحميل (6 ملفات)

| الملف | المسار |
|-------|--------|
| LoadingStates.tsx | `components/ui/LoadingStates.tsx` |
| TopLoadingBar.tsx | `components/ui/TopLoadingBar.tsx` |
| skeleton.tsx | `components/ui/skeleton.tsx` |
| AppSkeleton.tsx | `components/ui/AppSkeleton.tsx` |
| BarsSpinner.tsx | `components/ui/BarsSpinner.tsx` |
| BarsSpinner.module.css | `components/ui/BarsSpinner.module.css` |

### Hooks (4 ملفات)

| الملف | المسار |
|-------|--------|
| useAuth.ts | `hooks/useAuth.ts` |
| useCourses.ts | `hooks/useCourses.ts` |
| useCourseResources.ts | `hooks/useCourseResources.ts` |
| useCalendarSync.ts | `features/calendar/hooks/useCalendarSync.ts` |

### السياقات (4 ملفات)

| الملف | المسار |
|-------|--------|
| AuthContext.tsx | `context/AuthContext.tsx` |
| ChatHistoryContext.tsx | `context/ChatHistoryContext.tsx` |
| ChatThreadsContext.tsx | `context/ChatThreadsContext.tsx` |
| ChatMessagesContext.tsx | `context/ChatMessagesContext.tsx` |

### نقاط العرض (12 ملف)

| الملف | المسار |
|-------|--------|
| App.tsx | `App.tsx` |
| LoginPage.tsx | `components/LoginPage.tsx` |
| AssistantApp.tsx | `features/ai-assistant/AssistantApp.tsx` |
| AssistantLayout.tsx | `features/ai-assistant/shadcn/AssistantLayout.tsx` |
| thread-list.tsx | `features/ai-assistant/ui/thread-list.tsx` |
| EmailHistoryPanel.tsx | `features/ai-assistant/components/EmailHistoryPanel.tsx` |
| MessageComponents.tsx | `features/ai-assistant/shadcn/components/Thread/MessageComponents.tsx` |
| assistant-message.tsx | `features/ai-assistant/components/chat/assistant-message.tsx` |
| attachment.tsx | `features/ai-assistant/ui/attachment.tsx` |
| ArtifactPanel.tsx | `features/artifacts/ArtifactPanel.tsx` |
| code-ide-artifact.tsx | `components/ui/code-ide-artifact.tsx` |
| Avatar.tsx | `components/ui/core/Avatar.tsx` |

### ملفات الاختبار (9 ملفات)

| الملف | المسار |
|-------|--------|
| LoadingStates.test.tsx | `__tests__/components/LoadingStates.test.tsx` |
| AssistantApp.test.tsx | `__tests__/components/AssistantApp.test.tsx` |
| AssistantLayout.test.tsx | `__tests__/components/AssistantLayout.test.tsx` |
| useAuth.test.ts | `__tests__/useAuth.test.ts` |
| AuthContext.test.tsx | `__tests__/AuthContext.test.tsx` |
| SidebarView.test.tsx | `__tests__/components/SidebarView.test.tsx` |
| ArtifactPanel.test.tsx | `__tests__/components/ArtifactPanel.test.tsx` |
| calendar-types.test.ts | `__tests__/calendar-types.test.ts` |

### ملفات CSS (2 ملفات)

| الملف | المسار |
|-------|--------|
| animations.css | `styles/animations.css` |
| components.css | `styles/components.css` |

---

## ملخص

نظام التحميل في Sigma AI Assistant مبني على مبدأ **فصل المخاوف** (Separation of Concerns):

1. **مصادر الحالة** (Hooks/Contexts) توفر `isLoading` و `error` فقط
2. **مكونات التحميل** (UI Components) عرضية نقية بدون حالة
3. **نقاط العرض** (Render Points) تقرأ الحالة و تعرض المكون المناسب

هذا التصميم يضمن:
- **لا تبادل/layout shift**: المكونات تبقى موجودة دائماً، التراكبات تظهر فوقها
- **لا أخطاء صامتة**: كل خطأ له رسالة وزر retry
- **قابلية للصيانة**: إضافة حالة تحميل جديدة = ملف واحد للحالة + ملف واحد للعرض
