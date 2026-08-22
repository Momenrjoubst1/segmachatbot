# Sigma AI Chatbot

Full-stack AI chatbot with RAG (Retrieval-Augmented Generation), memory management, and multi-model support.

## Features

- **Multi-Model Support**: Azure, Groq, GitHub, OpenRouter, Fireworks, Novita (via intelligent routing)
- **RAG Pipeline**: Vector search + BM25 + Reranking
- **Memory System**: Session, cross-session, enhanced memory extraction
- **Tools**: Email, calendar, web search, calculator, time/date
- **Multi-language**: Arabic (RTL) & English
- **Content Moderation**: Perspective API + local filters
- **Security**: Rate limiting, SSRF protection, JWT auth
- **Offline Support**: Service worker for basic offline functionality
- **Code Splitting**: Lazy loading for better performance

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Chat UI   │  │   Calendar  │  │   Settings  │            │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │
│         │                │                │                     │
│  ┌──────┴────────────────┴────────────────┴──────┐            │
│  │              @assistant-ui/react               │            │
│  └─────────────────────┬─────────────────────────┘            │
│                        │                                       │
│  ┌─────────────────────┴─────────────────────────┐            │
│  │           React Router + i18next              │            │
│  └───────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend (Express)                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │  Pipeline   │  │   Memory    │  │   Tools     │            │
│  │  (10-step)  │  │   System    │  │             │            │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │
│         │                │                │                     │
│  ┌──────┴────────────────┴────────────────┴──────┐            │
│  │              AI Provider Services              │            │
│  │  Azure │ Groq │ GitHub │ OpenRouter │ Fireworks │ Novita │            │
│  └─────────────────────┬─────────────────────────┘            │
│                        │                                       │
│  ┌─────────────────────┴─────────────────────────┐            │
│  │           Supabase + Redis + PostgreSQL        │            │
│  └───────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
├── frontend/                 # React + Vite + TypeScript
│   ├── public/               # Static assets, service worker
│   ├── src/
│   │   ├── components/       # Reusable UI components
│   │   │   └── ui/          # Button, Card, LoadingStates, etc.
│   │   ├── context/          # React contexts (Auth, Title)
│   │   ├── features/         # Feature modules
│   │   │   ├── ai-assistant/ # Main chat feature
│   │   │   ├── calendar/     # Calendar integration
│   │   │   └── artifacts/    # Artifact management
│   │   ├── hooks/            # Custom React hooks
│   │   ├── i18n/             # Internationalization (ar/en)
│   │   ├── lib/              # Utilities, API clients
│   │   └── utils/            # Helper functions
│   └── vite.config.ts        # Vite configuration
│
└── backend/                  # Express + TypeScript
    ├── src/
    │   ├── config/           # Configuration, Redis, env
    │   ├── middleware/       # Auth, rate limiting, SSRF
    │   ├── pipeline/         # 10-step message pipeline
    │   ├── services/         # AI providers, chat, analytics
    │   ├── tools/            # AI tools (email, calendar, etc.)
    │   ├── memory/           # Session & cross-session memory
    │   ├── rag/              # RAG pipeline
    │   └── routes/           # API routes
    └── src/__tests__/        # Unit & integration tests
```

## Quick Start

### Prerequisites

- Node.js 20+
- npm or yarn
- Supabase account (for database)
- At least one AI provider API key (Azure, Groq, GitHub, OpenRouter, Fireworks, or Novita)

### 1. Clone & Install

```bash
git clone <repo-url>
cd sigma-ai-chatbot

# Install frontend
cd frontend
npm install --legacy-peer-deps

# Install backend
cd ../backend
npm install
```

### 2. Environment Setup

**Backend `.env`:**
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# AI Providers (at least one required)
AZURE_API_KEY=your-azure-api-key
GROQ_API_KEY=gsk_your-groq-key
GITHUB_TOKEN=your-github-token
OPENROUTER_API_KEY=your-openrouter-key
FIREWORKS_API_KEY=your-fireworks-key
NOVITA_API_KEY=your-novita-key
ASSISTANT_DEFAULT_MODEL=gpt-4o-mini
REDIS_URL=redis://localhost:6379
PORT=3004
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

**Frontend `.env`:**
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_BACKEND_URL=http://localhost:3004
```

### 3. Run Development

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

Open http://localhost:5173

## Docker Deployment

Before running, ensure you have `.env` files configured in both `frontend/` and `backend/` directories (see [Environment Setup](#2-environment-setup) above).

```bash
# Build and run with Docker Compose
docker-compose up --build

# Or run in detached mode
docker-compose up -d
```

This will start:
- Frontend on http://localhost:80
- Backend on http://localhost:3004
- PDF Processor on http://localhost:8000

## Available Scripts

### Frontend

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (port 5173) |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |

### Backend

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (port 3004) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run production |
| `npm run typecheck` | TypeScript check |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | Send chat message |
| GET | `/api/chat/history` | Get chat history |
| POST | `/api/chat/session` | Create new session |
| GET | `/api/models` | List available models |
| GET | `/api/analytics` | Usage analytics |
| GET | `/health` | Health check |

## Message Pipeline

The backend processes messages through a 10-step pipeline:

1. **Input Validation** - Zod schema validation
2. **Content Moderation** - Perspective API + local filters
3. **Rate Limiting** - Per-user rate limits
4. **Memory Retrieval** - Fetch session history
5. **Context Building** - Assemble context for LLM
6. **Tool Detection** - Identify available tools
7. **LLM Processing** - Send to AI provider
8. **Response Parsing** - Extract response and tool calls
9. **Tool Execution** - Run requested tools
10. **Memory Storage** - Save to session/cross-session

## Testing

```bash
# Run all tests
cd frontend && npm test
cd backend && npm test

# With coverage
cd backend && npm run test:watch
```

## Tech Stack

**Frontend:**
- React 19, Vite 7, TypeScript
- Tailwind CSS 4
- @assistant-ui/react
- React Router 6
- i18next (Arabic/English)
- Framer Motion (animations)

**Backend:**
- Express, TypeScript
- Vercel AI SDK
- Supabase (PostgreSQL)
- Redis (caching)
- Vitest (testing)

## Performance Optimizations

- **Code Splitting**: Lazy load heavy components (Calendar, Artifacts, etc.)
- **Manual Chunks**: Vendor libraries split into separate chunks
- **Service Worker**: Cache static assets for offline support
- **Gzip Compression**: Enabled in nginx for production
- **Asset Caching**: Static assets cached for 1 year

## Security Features

- **JWT Authentication**: Secure token-based auth
- **Rate Limiting**: Per-user and global rate limits
- **SSRF Protection**: Safe URL fetching
- **Input Validation**: Zod schemas for all inputs
- **Content Moderation**: AI-powered content filtering
- **CORS Configuration**: Restrictive CORS policies

## License

MIT
