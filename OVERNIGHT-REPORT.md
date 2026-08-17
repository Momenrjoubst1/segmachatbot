# Overnight Quality Pass — Report

**Branch:** `feature/overnight-quality-pass`
**Baseline commit:** `b9304ab` (snapshot of your uncommitted WIP — nothing lost)
**Work commits:** `27384e7` → `f0f5554` (6 commits)
**Review everything with:** `git diff b9304ab..HEAD`
**Nothing is applied to your project until YOU merge.** `main` and `feature/custom-composer` are untouched.

---

## Test Status

| Suite | Before | After |
|---|---|---|
| Frontend (vitest) | 186/186 ✅ | **192/192 ✅** (6 new tests added) |
| Backend (vitest) | 224/225 | **224/225** — the 1 failure (`memory-cleanup` timeout) is **pre-existing** (tries a real DB connection in a unit test), not caused by this work |
| Frontend tsc | pre-existing errors in unrelated files | no new errors in any touched file |
| Backend tsc | pre-existing smart-quote parse error in response-generator (fixed as a bonus) | clean for all touched files |

---

## What Was Done

### 1. Chat-area bug fixes (commit `27384e7`)
- **Escape-to-stop was broken in Arabic.** The shortcut searched for `aria-label="Stop generating"` but the button's label is translated ("إيقاف التوليد"). Now uses the stable `.aui-composer-cancel` class — works in every language.
- **New-chat shortcut didn't actually create a new chat.** `Ctrl+N` only reset the course, never cleared the thread. Now `Ctrl+Shift+O` (matching the label the UI always showed) + `Ctrl+N` both do `loadThread(null)` + course reset, identical to the sidebar button. Labels updated everywhere (was showing the incorrect "Ctrl+⌘+O").
- **Streaming didn't follow long answers.** Auto-scroll only fired when the message *count* changed, so a long streaming response ran past the viewport. `useSmartAutoScroll` now watches DOM growth (MutationObserver, rAF-throttled) and pins to the bottom while the user is near it — same behavior as ChatGPT/Claude. Stops following the moment the user scrolls up.
- **Guest-mode false image block.** Any text containing "image/" was treated as an image and blocked. Now only real embedded images (`<img>`, `data:image/`) are blocked.

### 2. Real code-execution system (commit `141a9d2`) — *was completely fake*
The frontend called `/api/tools/execute` — **an endpoint that never existed in the backend**. Both the chat code-block "Run" button and the IDE artifact silently 404'd (and the code-block button was a pure simulation toast).
- **New backend route** `POST /api/tools/execute` (auth, zod validation, 10/min per-user rate limit) wired to the existing sandboxed Wandbox executor.
- **Code-block Run button** now executes for real and renders a live output panel below the code (spinner → success/error, dismissible). Hidden for guests (auth required).
- **Code-block Regenerate** now actually re-triggers LLM generation for that message (event → hidden Reload button in AssistantMessage).
- **Code-block Share** was copying raw code while toasting "link copied" — now honestly copies the snippet as fenced Markdown.
- **IDE artifact** (`ArtifactViewer`): fixed relative URL (breaks in production) → absolute `VITE_BACKEND_URL`, fixed wrong payload shape, added auth headers. Removed the fake "executed successfully" fallback → clear "No executor connected" error.

### 3. Backend streaming robustness (commit `66a2dc9`)
- **Server now aborts the LLM when the client disconnects.** Previously, clicking "Stop generating" only closed the browser connection — the provider call kept running to completion, wasting tokens/CPU, then the whole persistence pipeline ran on a dead response. Both single-model and multi-agent paths now abort immediately via `res.on('close')`.
- `X-Model-Fallback` added to CORS `exposedHeaders` (was set by the server but unreadable by the browser — dead metadata).
- Fixed invalid UTF-8 smart quotes in `response-generator.service.ts` that caused TypeScript parse errors.

### 4. Message feedback system (commit `244ecf6`) — *thumbs were looks-only*
The thumbs up/down buttons only filled the icon locally; nothing was ever sent or stored.
- **New endpoint** `POST /api/feedback/message` — writes ±1 into the existing `chat_messages.feedback` column (no migration needed), with ownership enforcement (users can only rate messages in their own threads).
- **Frontend feedback adapter** registered in `useChatRuntime`, so both buttons now persist server-side. Failures show a toast without blocking the UI.

### 5. Tests (commits `b3b488d`, `f0f5554`)
- 6 frontend component tests for `NewChatButtonFull`/`NewChatButtonIcon` (structure, icon-wrapper, onClick, a11y).
- 7 backend route tests for `/api/tools/execute` (401/400×3/200/500/429).
- Fixed the AssistantLayout test file to mock the newly consumed `useChatHistory`.

---

## Verified-Working Features (from the audit, for your awareness)
The sidebar search (`SidebarSearchBar`) was already real in your WIP (the old fake Gooey bar is gone). Also already real: thread rename/delete/prefetch, attachments, guest sign-in CTAs, 3D toggle persistence, welcome suggestion chips.

---

## Known Remaining Items (found but NOT fixed — your call)

### Dead/half-working UI (from the 27-finding audit — none touched yet except the code-block row):
1. **Header Share button** (`Header.tsx:88`) — no onClick at all. Needs a share-link system (new table + public endpoint + UI) — the biggest remaining "build me" feature.
2. **Calendar cluster**: view toggle (Month/Week/Day) does nothing; search button opens the wrong modal; Create-Event modal discards its data; Edit ignores the event being edited; recurrence built but never persisted; Delete button has no onClick.
3. **Quiz artifact** — answers pre-highlighted, inputs disabled (it's an answer sheet, not a quiz).
4. **EmailHistoryPanel** resend/delete type text into the composer instead of acting.
5. **Onboarding flow fully built but unreachable** (`AssistantApp.tsx:241` hardcodes `isOnboarded = true`).
6. **RAG toggle** — backend support exists and is sent (`ragEnabled`), but no UI lets users toggle it.
7. **Model selector** — a complete, polished model picker exists (`model-selector.tsx` + catalog + 15 vendor icons) but is imported by zero components. Wiring it in would be high value for low effort.
8. **Dead code never rendered**: alternate agent/WebSocket subsystem, AuthCard/AuthModal, BotStatusWidget, HeatGraph, VerifiedBadge, SidebarLogoToggle, settings i18n files with no settings page.

### Technical debt / observations:
- Client attachment limit is 500MB but the backend JSON body cap is 10MB — should be aligned (~5–10MB realistic).
- Multi-agent mode awaits the full main-agent draft before streaming the critic — user stares at nothing during generation (only when `MULTI_AGENT_ENABLED=true`).
- `X-Model-Fallback` is now CORS-readable but the frontend still doesn't render it anywhere.
- `isThreadOwnedByUser` Redis cache has no invalidation on thread delete/transfer (5-min TTL bounds the damage).
- The displayed guest quota shortcut labels vs. actual bindings are now consistent, but a shortcuts-help overlay doesn't exist.

### Needs your input / secrets I can't create:
- Share-link system needs a product decision (public unlisted vs. auth-only).
- Model selector wiring needs a decision on which models to expose in the UI.
- CI (`.github/workflows/ci.yml`) was modified in your WIP — review what it runs before merging.

---

## How to Review & Apply

```bash
git log b9304ab..HEAD --oneline          # the 6 work commits
git diff b9304ab..HEAD                   # full diff of ONLY the overnight work
git checkout feature/overnight-quality-pass   # try it live
# Approve:
git merge feature/overnight-quality-pass
# Reject everything:
git branch -D feature/overnight-quality-pass
```

Each commit is independently revertable if you like some fixes but not others.
