# ChatHistoryContext Refactor Plan

## Current State
- **File**: `src/hooks/useChatHistory.tsx` (437 lines)
- **Responsibilities**: Thread management, message management, LRU cache, draft persistence, Supabase Realtime, URL search param sync

## Files That Import From useChatHistory
1. `src/features/ai-assistant/AssistantApp.tsx` - `useChatHistory`, `ChatHistoryProvider`
2. `src/features/ai-assistant/ui/useChatRuntime.ts` - `useChatHistory`
3. `src/features/ai-assistant/ui/thread-list.tsx` - `useChatHistory`, `ChatThread`
4. `src/features/ai-assistant/components/chat/assistant-message.tsx` - `useChatHistory`
5. `src/hooks/useAgentWebSocket.ts` - `useChatHistory`, `ChatMessage`

## New File Structure

### 1. `src/context/ChatDraftsContext.tsx` (~80 lines)
**Responsibility**: Draft message persistence with sessionStorage

```tsx
// State
- draftMap: Map<string, string> (in-memory cache)

// Functions
- saveDraft(threadId: string | null, text: string): void
- getDraft(threadId: string | null): string
- clearDraft(threadId: string | null): void

// Effects
- Hydrate from sessionStorage on mount
- Evict oldest drafts when exceeding DRAFT_STORAGE_MAX (50)
```

### 2. `src/context/ChatMessagesContext.tsx` (~120 lines)
**Responsibility**: Message management and LRU cache

```tsx
// State
- activeThreadMessages: ChatMessage[]
- isLoadingMessages: boolean

// Cache
- messagesCache: LRU cache (max 50 entries)

// Functions
- setActiveThreadMessages: React.Dispatch<SetStateAction<ChatMessage[]>>
- fetchMessages(threadId: string, isBackground?: boolean): Promise<void>
- clearMessagesCache(): void
```

### 3. `src/context/ChatThreadsContext.tsx` (~150 lines)
**Responsibility**: Thread CRUD operations and active thread state

```tsx
// State
- threads: ChatThread[]
- isLoadingThreads: boolean

// Functions
- fetchThreads(): Promise<void>
- deleteThread(threadId: string): Promise<void>
- loadThread(id: string | null): void
- setActiveThreadId(id: string | null): void
- getThreadsByCourse(courseId: string | null): ChatThread[]
- createNewThread(courseId?: string): Promise<void> (deprecated, no-op)

// Effects
- URL search param sync (useSearchParams)
- Supabase Realtime for thread title updates
- Auth state change listener
```

**Cross-cutting concern**: `deleteThread` needs to clear messages cache and drafts. Solution: Accept `onBeforeDelete` callback from parent.

### 4. `src/context/ChatHistoryContext.tsx` (~60 lines)
**Responsibility**: Compose all three providers, provide unified hook

```tsx
// Wraps children with:
- ChatDraftsProvider
- ChatMessagesProvider  
- ChatThreadsProvider (with callbacks)

// Provides unified useChatHistory hook that combines all three contexts
// Re-exports ChatThread and ChatMessage types
```

### 5. Update `src/hooks/useChatHistory.tsx` (~10 lines)
**Responsibility**: Re-export from ChatHistoryContext for backward compatibility

```tsx
export { ChatHistoryProvider, useChatHistory } from "@/context/ChatHistoryContext";
export type { ChatThread, ChatMessage } from "@/context/ChatHistoryContext";
```

## Implementation Order
1. Create `src/context/ChatDraftsContext.tsx`
2. Create `src/context/ChatMessagesContext.tsx`
3. Create `src/context/ChatThreadsContext.tsx`
4. Create `src/context/ChatHistoryContext.tsx` (wrapper)
5. Update `src/hooks/useChatHistory.tsx` (re-export)
6. Test that all existing imports still work

## Backward Compatibility
- All existing imports from `@/hooks/useChatHistory` continue to work
- `useChatHistory()` hook returns the same interface
- `ChatHistoryProvider` component works the same way
- `ChatThread` and `ChatMessage` types are re-exported

## Key Design Decisions
1. **LRU Cache**: Move to `ChatMessagesContext` as it's only used for messages
2. **URL Sync**: Keep in `ChatThreadsContext` as it manages active thread state
3. **Supabase Realtime**: Keep in `ChatThreadsContext` for thread title updates
4. **Auth listener**: Keep in `ChatThreadsContext` to refetch threads on auth change
5. **Cross-cutting**: Use callbacks from parent to handle deleteThread's side effects
