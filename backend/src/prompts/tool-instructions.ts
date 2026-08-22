/**
 * Tool Instructions Layer - تعليمات الأدوات
 * Dynamic tool usage instructions based on which tools are enabled.
 *
 * Key improvement: Only includes instructions for tools that are actually
 * available, reducing token usage when tools are disabled.
 */

/** All known tool group identifiers */
export type ToolGroup = 'email' | 'calendar' | 'tasks' | 'web_search' | 'code_executor' | 'fonts' | 'general';

/** Map of tool names (from TOOL_DEFINITIONS keys) to their group */
const TOOL_GROUP_MAP: Record<string, ToolGroup> = {
  send_email: 'email',
  get_email_history: 'email',
  get_email_details: 'email',
  delete_email: 'email',
  resend_email: 'email',
  get_email_stats: 'email',
  save_email_contact: 'email',
  get_email_contacts: 'email',
  delete_email_contact: 'email',
  schedule_email: 'email',
  get_scheduled_emails: 'email',
  cancel_scheduled_email: 'email',
  update_scheduled_email: 'email',
  get_scheduled_email_stats: 'email',
  create_email_signature: 'email',
  get_email_signatures: 'email',
  update_email_signature: 'email',
  delete_email_signature: 'email',
  set_default_signature: 'email',
  create_calendar_event: 'calendar',
  get_upcoming_events: 'calendar',
  find_free_slots: 'calendar',
  get_calendar_insights: 'calendar',
  delete_calendar_event: 'calendar',
  update_calendar_event: 'calendar',
  find_optimal_time: 'calendar',
  email_to_meeting: 'calendar',
  create_task: 'tasks',
  update_task: 'tasks',
  complete_task: 'tasks',
  delete_task: 'tasks',
  get_tasks: 'tasks',
  web_search: 'web_search',
  code_executor: 'code_executor',
  ide_execute_code: 'code_executor',
  ide_manage_files: 'code_executor',
  ide_install_packages: 'code_executor',
  apply_fonts: 'fonts',
  calculator: 'general',
  get_time: 'general',
  get_weather: 'general',
  get_course_info: 'general',
  generate_flashcards: 'general',
  record_quiz_result: 'general',
  generate_image: 'general',
  create_artifact: 'general',
};

/** Resolve a list of enabled tool names into unique groups */
export function resolveToolGroups(enabledTools: string[]): ToolGroup[] {
  const groups = new Set<ToolGroup>();
  for (const name of enabledTools) {
    const group = TOOL_GROUP_MAP[name];
    if (group) groups.add(group);
  }
  return [...groups];
}

/** General tool rules that always apply when any tool is present */
function buildGeneralToolRules(): string {
  return `# Tool Use Rules — قواعد استخدام الأدوات

- Treat every tool call as intermediate work, not a final answer.
- After any tool result, always continue and produce a direct user-facing response.
- Never stop the turn after a search, email draft, calendar draft, code execution, or other tool step.
- If a tool result is incomplete, unavailable, or needs confirmation, say that briefly and then explain the next step.

**CRITICAL ERROR HANDLING:** If ANY tool call fails (including rate_limited, error, or any failure), you MUST:
  1. Acknowledge what happened
  2. Explain the error clearly to the user
  3. Continue with a response — NEVER stop silently
  4. For rate_limited: "تم إرسال 5 إيميلات (الحد المسموح في الدقيقة). الإيميل السادس لم يتم إرساله بسبب الحد المسموح. يمكنك المحاولة مرة أخرى بعد X ثواني."
  5. For other errors: Explain what failed and what the user should do next`;
}

/** Email-specific tool instructions */
function buildEmailToolInstructions(): string {
  return `
## Email Tool Instructions — تعليمات البريد الإلكتروني

- Always send emails as plain text by default. Only use the 'html' parameter if the user explicitly requests HTML formatting or a specific design.
- One send_email call can include multiple recipients in recipients[] or one string containing multiple email addresses.
- First create one draft for all recipients. If the user later confirms with words like yes, send it, ابعث, ارسل, or موافق, call send_email again with confirm=true only.
- Do not create another draft or ask for confirmation again. You may omit confirmationId; the backend will use the user's latest pending email draft.
- Users can view their email history using get_email_history, get details with get_email_details, delete emails with delete_email, and resend with resend_email.
- Email statistics are available via get_email_stats.
- **RATE LIMIT CRITICAL RULE:** The system allows maximum 5 emails per minute. If the user requests more than 5 emails in a single request, you MUST IMMEDIATELY warn them BEFORE doing anything else. Say: "⚠️ يمكنني إرسال 5 إيميلات كحد أقصى في الدقيقة. سأرسل 5 إيميلات الآن، ويمكنك طلب الباقي بعد دقيقة." Do NOT proceed with preparing emails until you warn them. This is mandatory — never skip this warning.`;
}

/** Calendar-specific tool instructions */
function buildCalendarToolInstructions(): string {
  return `
## Calendar Tool Instructions — تعليمات التقويم

- You have FULL control of the user's calendar. Create, update, and delete events immediately when asked — do NOT ask for confirmation before calling the tools.
- When the user gives a date and time (or it is clearly implied), just create the event with create_calendar_event.
- Use find_free_slots to check availability before proposing a time.
- Use get_upcoming_events to show the user their schedule.
- Use update_calendar_event to reschedule or edit (needs the event ID from get_upcoming_events).
- Use delete_calendar_event to remove an event when the user asks.
- Use email_to_meeting to convert an email thread into a calendar event when the user requests it.
- If the user's request is ambiguous about WHICH event or WHAT time, ask a brief clarifying question — otherwise act.`;
}

/** Task-management tool instructions */
function buildTaskToolInstructions(): string {
  return `
## Task Tool Instructions — تعليمات المهام

- You have FULL control of the user's task list. Create, update, complete, and delete tasks immediately when asked — no confirmation step.
- Use get_tasks before creating a task if the user refers to an existing one ("that task", "the math homework") so you can reuse its ID.
- create_task: add a task (title required; due_date and priority optional).
- complete_task: mark a task done when the user says they finished it.
- update_task: change title/details/due date/priority; pass linked_event_id: null to unlink.
- delete_task: remove permanently when the user asks to delete.
- Report the result briefly and naturally ("تمت إضافة المهمة!", "Done — marked complete!").`;
}

/** Fonts-library specific tool instructions */
function buildFontsToolInstructions(): string {
  return `
## Fonts Library — تعليمات مكتبة الخطوط

عند إنشاء HTML/React artifacts يستخدم فيها المستخدم خطاً معيناً (عربي، لاتيني، مونو، ديكور، خط يدوي)،
استخدم أداة \`apply_fonts\` أو مرر \`fonts\` مباشرة إلى \`create_artifact\`.

### الفئات المتاحة في المكتبة:

- **arabic** — خطوط عربية تدعم العربية + اللاتينية:
  Cairo, Tajawal, Almarai, IBM Plex Sans Arabic, Noto Sans Arabic, Amiri, Scheherazade New, Lateef, Reem Kufi, Markazi Text.
- **sans** — خطوط لاتينية Sans-serif حديثة: Inter, Roboto, Poppins, Montserrat, Open Sans, Lato, Nunito, Work Sans.
- **serif** — خطوط Serif لاتينية: Merriweather, Playfair Display, Lora, PT Serif.
- **mono** — خطوط Monospace للأكواد: Roboto Mono, JetBrains Mono, Fira Code, Source Code Pro, IBM Plex Mono.
- **display** — خطوط عناوين لافتة: Bebas Neue, Oswald, Anton, Abril Fatface, Lobster.
- **handwriting** — خطوط يدوية: Caveat, Pacifico, Dancing Script, Shadows Into Light.

### طريقة الاستخدام:

1. **مع create_artifact**: مرر \`fonts: ["Cairo", "JetBrains Mono"]\` عند إنشاء HTML/React.
   الـ backend يحقن <link href="fonts.googleapis.com"> تلقائياً ويغلّف body بـ font-family مناسب.

2. **مع apply_fonts**: لطلب قائمة الخطوط استخدم \`action: "list"\`، ولاستخراج CSS جاهز من أسماء استخدم
   \`action: "resolve"\`، ولتغليف HTML/SVG/Markdown موجود داخل مستند مع الخطوط استخدم \`action: "apply"\`.

### القواعد:

- اختر خطاً عربياً عندما يكون المحتوى عربياً أو مختلطاً (عربي + لاتيني).
- اختر خطاً mono للأكواد، serif للنصوص الطويلة، display للعناوين الكبيرة، handwriting للملاحظات.
- تُقبل الأسماء المستعارة: "JetBrains" → "JetBrains Mono"، "Playfair" → "Playfair Display"، إلخ.
- لا تُحقن الخطوط في artifacts من نوع code/markdown/mermaid/chart/quiz (تأثيرها معدوم أو يفسد الكود).`;
}

/** IDE-specific tool instructions */
function buildIDEToolInstructions(): string {
  return `
## IDE Tool Instructions — تعليمات بيئة التطوير

When the user requests a full IDE, use \`create_artifact\` with \`type: "ide"\` and a \`projectFiles\` array defining the file/folder tree. The IDE provides: code editor, file tree, integrated terminal, code execution (\`ide_execute_code\`), file management (\`ide_manage_files\`), and package installation (\`ide_install_packages\`).

Rules:
- Use \`type: "ide"\` only for full IDE requests
- Create logical, organized project structure with runnable code
- Include README.md and clear file names
- Add explanatory comments in code`;
}

/**
 * Builds the complete tool instructions layer.
 * Only includes instructions for tool groups that are actually enabled.
 */
export function buildToolInstructions(enabledTools: string[]): string {
  if (!enabledTools || enabledTools.length === 0) return '';

  const groups = resolveToolGroups(enabledTools);

  const parts: string[] = [buildGeneralToolRules()];

  if (groups.includes('email')) {
    parts.push(buildEmailToolInstructions());
  }

  if (groups.includes('calendar')) {
    parts.push(buildCalendarToolInstructions());
  }

  if (groups.includes('tasks')) {
    parts.push(buildTaskToolInstructions());
  }

  if (groups.includes('fonts')) {
    parts.push(buildFontsToolInstructions());
  }

  if (groups.includes('code_executor')) {
    parts.push(buildIDEToolInstructions());
  }

  return parts.join('\n');
}