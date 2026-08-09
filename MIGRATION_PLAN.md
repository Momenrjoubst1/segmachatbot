# Migration Plan: Persistent Composer with `useRemoteThreadListRuntime`

> **ABANDONED APPROACH** — This migration plan was explored and abandoned due to
> architecture mismatch. The `useRemoteThreadListRuntime` adapter model requires
> eager thread list management (list, rename, archive, etc.) which conflicts with
> this backend's lazy thread creation pattern (threads created by chat pipeline on
> first message). The adapter's `fetch` property expects `(threadId: string) => Promise<RemoteThreadMetadata>`
> but the real work lives in the `runtimeHook`'s custom streaming fetch, creating
> duplication. Additionally, backend lacks endpoints for rename/archive/unarchive.
>
> A different approach is needed for persistent composer. See notes below for
> architectural insights that may inform future attempts.

## Current Architecture vs Target

### Current Flow (remount-based)
```
URL ?thread=X changes
  → AssistantChatInner key=chatKey changes
    → entire subtree unmounts
      → useRuntime(activeCourse) recreates customFetch
        → AssistantChatTransport sends to POST /api/chat
        → Backend receives { threadId, courseId, ragEnabled }
        → Response includes X-Thread-Id header
```

### Target Flow (persistent runtime)
```
URL ?thread=X changes
  → RemoteThreadListAdapter.onThreadChange called
    → runtime.switchToThread(newId)
      → customFetch closure updated (no remount)
        → same transport sends to POST /api/chat
```

---

## Part 1: Backend Endpoint Mapping

| Existing Endpoint | Backend Route | Purpose |
|---|---|---|
| `POST /api/chat` | `chat.routes.ts` | Main chat pipeline — receives body with `threadId`/`courseId`/`clientChatGuid` |
| `GET /api/chat/threads` | `chat-thread.routes.ts` | List all threads |
| `GET /api/chat/threads/:id` | `chat-thread.routes.ts` | Get single thread |
| `POST /api/chat/threads/:id/branch` | `chat-thread.routes.ts` | Create branch from existing thread |
| `DELETE /api/chat/threads/:id` | `chat-thread.routes.ts` | Delete thread |

**Key detail:** Backend already supports `clientChatGuid` for idempotency — the `RemoteThreadListAdapter` needs to generate this for new threads.

---

## Part 2: Custom Fetch Logic (from `useChatRuntime.ts:164-332`)

```typescript
// Current customFetch does:
1. Abort any in-flight request
2. Add auth headers via getAssistantAuthHeaders()
3. Parse JSON body and inject:
   - threadId (if existing thread)
   - courseId (if new thread and activeCourse exists)
   - clientChatGuid (idempotency key for new threads)
   - ragEnabled
4. Handle 401 → refresh token → retry
5. Parse response for X-Thread-Id header
6. Wrap response.body with UIActionStreamParser
7. On stream end: update URL via setActiveThreadId(serverThreadId)
```

**For RemoteThreadListAdapter:**
- Steps 1-4 remain identical
- Step 5: X-Thread-Id becomes `onCreateThread(serverThreadId)` callback
- Step 6: UIActionStreamParser moves to adapter or stays in customFetch
- Step 7: URL sync moves to adapter's `onThreadChange`

---

## Part 3: `activeThreadId` Read/Write Patterns

### Reads (in custom logic)
| Location | Usage |
|---|---|
| `useChatRuntime.ts:177` | `if (activeThreadId)` → set `parsed.threadId` |
| `useChatRuntime.ts:218` | Compare with `X-Thread-Id` header |
| `useChatRuntime.ts:220` | `isNewThread` detection |
| `useChatRuntime.ts:254` | Post-stream URL update guard |
| `useChatRuntime.ts:331` | Dependency for customFetch memoization |

### Writes
| Location | Operation |
|---|---|
| `useChatRuntime.ts:261` | `setActiveThreadId(serverThreadId)` (post-stream) |
| `ChatThreadsContext.tsx:67` | `setSearchParams({ thread: id })` via `goToThread` |
| `ChatThreadsContext.tsx:80` | `setSearchParams({ thread: id }, { replace: true })` |

### Migration Impact
- **Reads move to adapter** — `RemoteThreadListAdapter.onThreadChange(newId)` triggers closure update
- **Writes move to adapter** — `onCreateThread(id)` → update URL search params

---

## Part 4: `activeCourse` Pass-Through Strategy

### Current Path
```
useAssistantChat()
  → useRuntime(activeCourse)  // activeCourse from useCourses() hook
    → customFetch closure captures activeCourse
      → parsed.courseId = activeCourse.id (line 184)
```

### Migration Strategy
- **Pass `activeCourse` as parameter to adapter** — adapter is responsible for injecting `courseId` into request body
- **Alternative:** Keep `activeCourse` in context, read from adapter via `useRuntime()` hook

---

## Part 5: Runtime-Dependent Components

| Component | Runtime Usage | Persistence Impact |
|---|---|---|
| `ThreadWelcome.tsx` | `useRuntime()` for welcome state | ✅ Can persist |
| `ThreadComposer.tsx` | `useComposerRuntime()` for text input | ✅ Can persist |
| `ThreadMessages.tsx` | `useThreadRuntime()` for messages | ⚠️ Need to handle message switching |
| `useChatRuntime.ts` | `useChatRuntime({ transport, messages })` | ❌ Replaced by adapter |
| `SyncPlugin.tsx` | `useRuntime()` for text sync | ✅ Can persist |
| `ChatHistoryContext.tsx` | `useChatMessages()` for cache | ⚠️ Message loading logic stays |

---

## Part 6: Minimal First Step Proposal

### Phase 1: Adapter with Flag (Safe Verification)
1. Create `AssistantThreadListAdapter` implementing `RemoteThreadListAdapter`
2. Add feature flag: `REMOTE_THREAD_RUNTIME = false`
3. When `true`:
   - Use `useRemoteThreadListRuntime` instead of `useRuntime`
   - CustomFetch injects `threadId` from `threadId` param (not `activeThreadId`)
   - `onCreateThread` calls `setActiveThreadId` and `refreshThreads`
4. When `false`:
   - Keep existing `useRuntime` + `key={chatKey}` pattern
5. **Verification:** Toggle flag, verify chat works identically

### Phase 2: Remove Key-Based Remount
1. Remove `key={chatKey}` from `AssistantChatInner`
2. Remove `isActiveChat` prop from `AssistantApp.tsx`
3. Verify composer persists across thread switches
4. Verify message loading works correctly

---

## Implementation Checklist

- [x] **Step 1:** Create `AssistantThreadListAdapter.ts` with all adapter logic
- [x] **Step 2:** Add feature flag to `AssistantApp.tsx`
- [x] **Step 3:** Update `AssistantChatInner` to conditionally use new runtime
- [x] **Step 4:** Verify 153 tests still pass ✅
- [ ] **Step 5:** Manual test: new chat, switch threads, delete thread
- [ ] **Step 6:** Remove old runtime path
- [ ] **Step 7:** Remove `key={chatKey}` pattern
- [ ] **Step 8:** Final test pass

---

## Risk Mitigation

1. **Feature flag** — Easy rollback if issues arise
2. **Gradual migration** — Adapter can coexist with existing logic
3. **Test coverage** — 153 tests provide safety net
4. **Backend unchanged** — No backend changes required for this migration

---

## Files to Modify

| File | Change |
|---|---|
| `frontend/src/features/ai-assistant/AssistantApp.tsx` | Remove key, add adapter setup |
| `frontend/src/features/ai-assistant/ui/useChatRuntime.ts` | Export customFetch for adapter |
| `frontend/src/features/ai-assistant/shadcn/AssistantLayout.tsx` | Update to use new runtime hook |
| `frontend/src/context/ChatThreadsContext.tsx` | No changes needed |
| `frontend/src/context/ChatMessagesContext.tsx` | No changes needed |

---

## Next Immediate Action

Create `AssistantThreadListAdapter.ts` with the adapter implementation that:
1. Wraps existing `customFetch` logic
2. Implements `onThreadChange` and `onCreateThread` callbacks
3. Handles `activeCourse` injection
4. Manages URL sync via `setSearchParams`

---

## How to Enable the Feature Flag

To test the persistent composer:

1. Add to your `.env` file:
   ```
   VITE_REMOTE_THREAD_RUNTIME=true
   ```

2. Restart the dev server

3. Test the following scenarios:
   - New chat: Send a message, verify it creates a thread and updates URL
   - Switch threads: Click a different thread in sidebar, verify composer persists
   - Back to new chat: Click "New Chat", verify composer clears
   - Delete thread: Delete active thread, verify it navigates to another thread

---

## Files Created

- `MIGRATION_PLAN.md` - This migration plan document
- `frontend/src/features/ai-assistant/AssistantThreadListAdapter.ts` - The adapter implementation

## Files Modified

- `frontend/src/features/ai-assistant/AssistantApp.tsx` - Added feature flag and new persistent component
