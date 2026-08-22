# Sigma AI Chatbot - Architecture Documentation

## System Overview

Sigma AI Chatbot is a full-stack AI assistant with RAG (Retrieval-Augmented Generation), multi-tier memory management, and real-time streaming capabilities. The system consists of a React 19 frontend and Express.js backend, connected to Supabase (PostgreSQL) for data persistence and Redis for caching.

**Technology Stack:**
- **Frontend:** React 19, Vite 7, TypeScript, Tailwind CSS 4, @assistant-ui/react
- **Backend:** Express.js, TypeScript, Vercel AI SDK, Supabase, Redis
- **AI Providers:** Multiple support (Groq, OpenAI, Gemini, DeepSeek, Qwen via OpenRouter)
- **Testing:** Vitest for both frontend and backend
- **Observability:** Sentry for error tracking and monitoring

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Frontend (React 19)                        │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Chat UI        │  │   Calendar        │  │   Settings      │  │
│  │  (@assistant-ui) │  │   Integration     │  │   Panel         │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │
│           │                      │                      │                 │
│  ┌────────┴──────────────────────┴──────────────────────┴──────────┐ │
│  │              React Router + Context Providers                 │ │
│  │  (Auth, ChatHistory, ChatMessages, ChatThreads, RAG, Title)    │ │
│  └─────────────────────────────┬───────────────────────────────┘ │
└──────────────────────────────────┼───────────────────────────────────┘
                                   │ HTTP/HTTPS
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Backend (Express.js)                         │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Middleware     │  │   Routes          │  │   Services       │  │
│  │  (Auth, Rate     │  │   (Chat,          │  │   (Chat, Memory,  │  │
│  │   Limiting,      │  │    Analytics,     │  │    RAG, Tools)   │  │
│  │   SSRF, CORS)    │  │    Artifacts,     │  │                   │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │
│           │                    │                    │                 │
│  ┌────────┴──────────────────────┴──────────────────────┴──────────┐ │
│  │              10-Step Chat Pipeline                          │ │
│  │  (Validation → Moderation → Courses → Intent → RAG → Memory   │ │
│  │   → System Prompt → Thread → Persist → Context → Stream) │ │
│  └─────────────────────────────┬───────────────────────────────┘ │
│                              │                                      │
│  ┌───────────────────────────┴───────────────────────────────┐ │
│  │              AI Provider Services                          │ │
│  │  (Groq, OpenAI, Gemini, DeepSeek, Qwen)                │ │
│  └─────────────────────────────┬───────────────────────────────┘ │
│                              │                                      │
│  ┌───────────────────────────┴───────────────────────────────┐ │
│  │              External Services                            │ │
│  │  (Supabase Edge Functions, Email, Calendar, Web Search)    │ │
│  └─────────────────────────────┬───────────────────────────────┘ │
│                              │                                      │
│         ┌──────────────────────┴─────────────────────┐        │
│         │   Data Layer (Supabase + Redis)           │        │
│         │   (PostgreSQL + Vector Search + Cache)       │        │
│         └───────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### Frontend Architecture

#### Component Structure
```
src/
├── components/           # Reusable UI components
│   ├── LoginPage.tsx      # Authentication interface
│   ├── SessionExpiredModal.tsx
│   └── ui/              # Base UI components
│       ├── button.tsx
│       ├── dialog.tsx
│       └── ...
├── context/              # React context providers
│   ├── AuthContext.tsx        # Authentication state
│   ├── ChatHistoryContext.tsx  # Chat history management
│   ├── ChatMessagesContext.tsx  # Message state
│   ├── ChatThreadsContext.tsx   # Thread management
│   ├── RAGContext.tsx          # RAG configuration
│   └── TitleContext.tsx         # Document title
├── features/             # Feature modules
│   ├── ai-assistant/      # Main chat interface
│   │   ├── AssistantApp.tsx
│   │   ├── shadcn/          # UI components from @assistant-ui
│   │   └── ui/              # Custom chat UI components
│   ├── calendar/          # Calendar integration
│   └── artifacts/         # Artifact management
├── hooks/                # Custom React hooks
│   ├── useAuth.ts          # Authentication logic
│   ├── useChatHistory.tsx  # Chat history management
│   └── useAgentWebSocket.ts # WebSocket connection for agents
└── lib/                  # Utilities and API clients
    ├── supabaseClient.ts  # Supabase client wrapper
    └── auth.ts           # Authentication helpers
```

#### Key Frontend Patterns

**Authentication Flow:**
1. User signs in via LoginPage.tsx
2. AuthContext manages authentication state using Supabase auth
3. JWT token stored and used for backend API calls
4. Session expiry handling with SessionExpiredModal

**Chat Architecture:**
- @assistant-ui/react provides the chat interface framework
- useChatRuntime handles streaming responses and UI action parsing
- MessageSyncer bridges between chat history context and AI SDK runtime
- Draft management with automatic save/restore on thread switches

**State Management:**
- Context-based state management (Auth, ChatHistory, etc.)
- Zustand for complex state if needed
- React 19 concurrent features for smooth UI updates

### Backend Architecture

#### Module Organization
```
src/
├── config/               # Configuration management
│   ├── app.config.ts         # Application configuration
│   ├── memory.config.ts      # Memory system configuration
│   ├── supabase.config.ts    # Supabase client setup
│   └── redis/               # Redis client setup
├── middleware/           # Express middleware
│   ├── auth.middleware.ts     # JWT authentication with circuit breaker
│   ├── rate-limiters.ts      # Rate limiting with Redis support
│   └── request-id.ts         # Request ID generation
├── routes/                # API route handlers
│   ├── chat.routes.ts        # Chat endpoints
│   ├── analytics.routes.ts   # Analytics endpoints
│   ├── memory.routes.ts      # Memory management endpoints
│   └── ...
├── services/              # Business logic
│   ├── chat/                # Chat processing
│   │   ├── chat.pipeline.ts   # 10-step chat pipeline orchestrator
│   │   ├── pipeline/          # Individual pipeline steps
│   │   ├── moderation.service.ts  # Content moderation
│   │   └── response-generator.service.ts  # AI response streaming
│   ├── memory/               # Memory management
│   │   ├── unified-memory.ts   # Memory system coordinator
│   │   ├── enhanced-memory.service.ts  # Enhanced memory bank
│   │   ├── cross-session.service.ts    # Cross-session memory
│   │   └── text-deduplicator.ts  # Memory deduplication utility
│   ├── rag/                  # RAG pipeline
│   │   ├── bm25-search.ts      # BM25 search implementation
│   │   ├── embedding-service.ts  # Text embedding
│   │   └── document-reranker.ts    # Document reranking
│   └── tools/                # AI tools
│   ├── email/               # Email tools
│   ├── calendar/            # Calendar tools
│   ├── code/                # Code execution
│   └── web/                 # Web search
└── utils/                 # Utilities
    ├── logger.ts            # Structured logging
    ├── timeout-wrapper.ts   # Timeout handling
    └── safe-fetch-url.ts     # SSRF protection
```

#### 10-Step Chat Pipeline

The chat pipeline processes messages through these sequential steps:

1. **Validation** - Request validation using Zod schemas
2. **Moderation** - Content moderation using Perspective API
3. **User Courses** - Fetch user's academic course context
4. **Intent Detection** - Classify user intent for tool selection
5. **RAG Retrieval** - Retrieve relevant documents via vector search + BM25 + reranking
6. **Memory Context** - Build memory context from session/cross-session memory
7. **System Prompt** - Assemble system prompt with RAG context
8. **Thread Management** - Create or reuse chat thread
9. **Context Window** - Manage conversation context (summarization if needed)
10. **UI Fast-Passes** - Check for UI actions and stream final response

#### Memory System Architecture

The memory system consists of three tiers:

**Session Memory:**
- Short-term memory within current conversation
- Messages stored in chat_messages table
- Kept in context window for immediate reference

**Cross-Session Memory:**
- Long-term memory across conversations
- Stores relevant context from previous chats
- Retrieved based on semantic similarity to current query

**Enhanced Memory Bank:**
- Structured fact storage with categories (personal, academic, preference, etc.)
- Extracted from conversations using LLM
- Deduplicated using similarity-based approach

**Deduplication Strategy:**
- Jaccard similarity for text overlap detection
- Configurable threshold (default 0.7)
- Prevents duplicate facts across memory tiers

#### RAG Pipeline

**Document Ingestion:**
- Documents stored in Supabase with vector embeddings
- pgvector extension for similarity search
- BM25 search for keyword matching
- Document reranking for relevance optimization

**Retrieval Process:**
1. Vector similarity search (embedding-based)
2. BM25 keyword search
3. Reranking results
4. Response caching in Redis

**Caching Strategy:**
- Response cache to avoid redundant LLM calls
- BM25 index cached in memory for performance
- Context cache for conversation summaries

## Data Model

### Database Schema (PostgreSQL)

**Core Tables:**
- `chat_sessions` - Chat conversation threads
- `chat_messages` - Individual messages in conversations
- `user_profiles` - User profile information
- `email_contacts` - Email contact management
- `calendar_events` - Calendar event data
- `documents` - RAG document storage with embeddings
- `analytics_events` - Usage analytics

**Vector Search:**
- `documents` table with `embedding` column (vector(768))
- `match_documents` SQL function for similarity search
- pgvector extension for vector operations

### Redis Data Structures

**Cache Keys:**
- `auth:session:{token_hash}` - Auth session cache
- `web_search:{hash}` - Web search results cache
- `rag:response:{hash}` - RAG response cache
- `rl:global:{ip}` - Global rate limiting
- `memory:context:{user_id}` - Memory context cache

**Sliding Window Rate Limiting:**
- Uses Redis Sorted Sets (ZSET) for accurate rate limiting
- Lua script for atomic operations
- Fallback to in-memory counters if Redis unavailable

## Security Architecture

### Authentication & Authorization

**JWT Authentication:**
- Supabase JWT tokens for authentication
- Token validation on each protected route
- Redis circuit breaker for auth validation failures
- Automatic token refresh on 401 errors

**User Management:**
- Ban checking via both Auth metadata and `banned_users` table
- Session expiry handling with modal prompts
- Verified user ID registration for UI components

### Security Measures

**Input Validation:**
- Zod schema validation for all API inputs
- Content moderation via Perspective API
- Local input validators for common attacks

**Rate Limiting:**
- Per-endpoint rate limiting with different tiers
- Redis-backed sliding window for accurate limiting
- In-memory fallback when Redis unavailable
- Circuit breaker pattern for repeated failures

**SSRF Protection:**
- Safe URL fetching with domain allowlist
- Protocol validation (http/https only)
- DNS rebinding protection

**Content Security:**
- Helmet.js for HTTP headers
- CORS configuration with origin validation
- Permissions policy for browser features

## Performance Optimizations

### Frontend Optimizations

**Code Splitting:**
- Lazy loading of heavy components (Calendar, Artifacts)
- Manual chunks for vendor libraries
- React.lazy() for route-based splitting

**Performance Techniques:**
- React transitions for heavy UI updates
- Draft management with composer API
- Tab visibility handling with flushSync
- Service worker for offline support

### Backend Optimizations

**Caching Strategy:**
- Redis caching for expensive operations
- Response caching for RAG queries
- Memory context caching
- In-memory BM25 index

**Pipeline Optimizations:**
- Parallel memory retrieval operations
- Timeout handling for all pipeline steps
- Intent-based tool filtering to save tokens
- Context window management with summarization

**Database Optimizations:**
- Connection pooling via Supabase
- Indexed queries for common operations
- Vector search for efficient RAG
- Batch operations where possible

## Deployment Architecture

### Development Environment
- Frontend: Vite dev server on port 5173
- Backend: tsx watch on port 3004
- Supabase local development or cloud instance
- Redis local or cloud instance

### Production Deployment
- Frontend: Static files served via nginx/Vercel
- Backend: Node.js server with process manager (PM2)
- Database: Supabase cloud PostgreSQL
- Cache: Redis (cloud or self-hosted)
- CDN: Cloudflare for static assets

### Docker Deployment
- Docker Compose for local development
- Separate containers for frontend, backend, pdf-processor, Redis
- Environment configuration via .env files
- Health check endpoints for monitoring

## Monitoring & Observability

### Error Tracking
- Sentry integration for both frontend and backend
- Structured logging with context information
- Error boundary components in React
- Global error handler in Express

### Logging Strategy
- Structured logging with log levels
- Request ID correlation across microservices
- Performance metrics in pipeline steps
- Memory system deduplication statistics

### Health Monitoring
- `/api/health` endpoint with service status
- Redis connection status
- BM25 index statistics
- AI provider availability check

## Configuration Management

### Environment Variables

**Critical Variables:**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` - Database connection
- `REDIS_URL` - Cache connection
- `ASSISTANT_DEFAULT_MODEL` - Default AI model
- AI provider keys (GROQ_API_KEY, OPENAI_API_KEY, etc.)

**Optional Variables:**
- Memory configuration (MEMORY_MAX_MESSAGES, etc.)
- Email configuration (SMTP settings)
- Web search API keys
- Translation service keys

### Configuration Validation
- Centralized validation at startup
- Fails fast in production on critical errors
- Warnings for non-critical misconfigurations
- Tool registry validation for proper registration

## Development Workflow

### Testing Strategy
- Unit tests for core services (Vitest)
- Integration tests for API endpoints
- Component tests for React components
- End-to-end tests for critical user flows

### Code Quality
- TypeScript for type safety
- ESLint for code quality
- Prettier for code formatting
- Pre-commit hooks for code quality checks

### Build Process
- Frontend: Vite build with optimizations
- Backend: TypeScript compilation
- Docker images for deployment
- CI/CD pipeline for automated testing and deployment

## Scalability Considerations

### Current Architecture Strengths
- Modular design allows independent scaling
- Caching reduces database load
- Circuit breakers prevent cascading failures
- Horizontal scaling via load balancer

### Bottlenecks & Mitigations
- **LLM API calls:** Caching, model routing, fallback providers
- **Database queries:** Connection pooling, indexing, query optimization
- **Memory operations:** Parallel retrieval, caching, deduplication
- **Real-time features:** WebSocket for real-time updates, optimistic UI

### Future Enhancements
- Message queue for async processing
- Microservices architecture for specific domains
- Edge deployment for frontend
- Distributed tracing for end-to-end observability

## Maintenance Guidelines

### Adding New Features
1. Follow existing module structure
2. Add appropriate tests
3. Update documentation
4. Register tools in tool metadata system
5. Add timeout handling for new pipeline steps

### Monitoring Guidelines
- Monitor error rates in Sentry
- Track performance metrics
- Watch cache hit rates
- Monitor memory system efficiency
- Track AI provider costs

### Deployment Guidelines
- Run configuration validation before deployment
- Test in staging environment first
- Monitor for errors after deployment
- Have rollback plan ready
- Document any breaking changes

This architecture document provides a comprehensive overview of the Sigma AI Chatbot system, its components, data flows, and operational considerations.