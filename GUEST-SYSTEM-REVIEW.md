# Deep Code Review: Guest System (Unauthenticated Chat)

**Date:** 2026-08-14  
**Reviewer:** opencode  
**Scope:** Guest/unauthenticated chat system across backend and frontend

---

## Executive Summary

The guest system allows unauthenticated users to chat with the AI assistant with limited messages (4 per 24h). The implementation is functional but has several security and reliability issues that need attention.

### Overall Health: ⚠️ Needs Improvement

### Top 3 Critical Issues:
1. **Conversation history injection vulnerability** - Malicious users can inject system prompts via fake conversation history
2. **In-memory rate limiting not shared across instances** - Rate limits can be bypassed in multi-instance deployments
3. **Client-side guest count not synced with server** - UI shows wrong message count after page refresh

---

## Architecture Assessment

### System Components
- **Backend:** Single Express route (`/api/guest/chat`) with IP-based + cookie-based rate limiting
- **Frontend:** React context (`GuestModeContext`) + custom fetch wrapper in `useChatRuntime.ts`

### Layering Issues
- Guest logic is self-contained in `guest.routes.ts` - good isolation
- Frontend guest handling is scattered across multiple files - poor cohesion
- Rate limiting uses two independent systems (IP + cookie) that don't coordinate

---

## Findings by Module

### Backend: `guest.routes.ts`

| Severity | Issue | Line | Description |
|----------|-------|------|-------------|
| **CRITICAL** | History injection | 281-284 | `conversationHistory` from client is passed directly to LLM without sanitization. Malicious users can inject fake assistant messages or system prompts. |
| **HIGH** | In-memory state | 97 | `guestWindows` Map is not shared across instances. Rate limits bypassed in multi-instance deployments. |
| **MEDIUM** | No content moderation on history | 246-255 | Only the latest user message is moderated, not the conversation history. |
| **MEDIUM** | Hardcoded system prompt | 210-224 | Cannot update guest behavior without full deployment. |
| **LOW** | Cleanup interval always runs | 101-111 | `setInterval` runs even with zero active guests. |

### Backend: `rate-limiters.ts`

| Severity | Issue | Line | Description |
|----------|-------|------|-------------|
| **HIGH** | Trust proxy dependency | 263 | `ipKeyGenerator(req.ip)` fails if trust proxy is misconfigured - all users share same IP. |
| **MEDIUM** | No fallback logging | 162-186 | Redis failure falls back silently - no alerting on degradation. |

### Frontend: `GuestModeContext.tsx`

| Severity | Issue | Line | Description |
|----------|-------|------|-------------|
| **HIGH** | Client-side only count | 30 | `guestMessageCount` resets on page refresh. Doesn't reflect actual server-side count. |
| **MEDIUM** | No server sync on mount | 28-49 | Should fetch current count from server headers on initial load. |

### Frontend: `useChatRuntime.ts`

| Severity | Issue | Line | Description |
|----------|-------|------|-------------|
| **HIGH** | Duplicated code | 332-404 | Body transformation logic duplicated for string vs object bodies. Maintenance nightmare. |
| **MEDIUM** | Debug console.log | 348, 435-437 | Production code contains debug logging that could leak sensitive data. |
| **MEDIUM** | No error recovery | 461-468 | 429 response handling dispatches event but doesn't update local state. |

---

## Cross-Cutting Findings

### Security

| Severity | Issue | Description |
|----------|-------|-------------|
| **CRITICAL** | Prompt injection via history | User can craft conversationHistory with fake system/assistant messages to bypass guest restrictions. |
| **HIGH** | No CSRF protection | Guest endpoint has no CSRF token validation. |
| **MEDIUM** | Cookie security | `Secure` flag only set in production. Development uses HTTP cookies. |

### Performance

| Severity | Issue | Description |
|----------|-------|-------------|
| **MEDIUM** | Unbounded memory growth | `guestWindows` Map grows without bound between cleanups (30min intervals). |
| **LOW** | No connection pooling | Each guest request creates new provider client. |

### Testing

| Severity | Issue | Description |
|----------|-------|-------------|
| **HIGH** | No test coverage | Zero tests for guest routes, rate limiting, or frontend guest mode. |

---

## Prioritized Action Plan

| Priority | Effort | Action |
|----------|--------|--------|
| 1 | **S** | Sanitize `conversationHistory` - strip or reject messages with `system` role, validate content format |
| 2 | **M** | Add Redis-backed storage for `guestWindows` (similar to `SlidingWindowRedisStore`) |
| 3 | **S** | Extract guest body transformation into shared utility function |
| 4 | **S** | Remove debug `console.log` statements from production code |
| 5 | **M** | Add server endpoint to return current guest message count for UI sync |
| 6 | **S** | Add CSRF token to guest cookie |
| 7 | **M** | Write integration tests for guest chat flow |
| 8 | **S** | Add monitoring/alerting for guest abuse patterns |

---

## Appendix: Code Locations

| File | Purpose |
|------|---------|
| `backend/src/routes/guest.routes.ts` | Main guest chat endpoint (335 lines) |
| `backend/src/middleware/rate-limiters.ts` | IP-based rate limiting (264 lines) |
| `frontend/src/context/GuestModeContext.tsx` | Guest mode React context (50 lines) |
| `frontend/src/features/ai-assistant/ui/useChatRuntime.ts` | Chat runtime with guest handling (578 lines) |
| `frontend/src/features/ai-assistant/shadcn/components/Sidebar/SidebarView.tsx` | Sidebar guest UI (164 lines) |
