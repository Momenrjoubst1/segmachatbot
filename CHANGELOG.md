# Changelog

All notable changes to Sigma AI Chatbot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Dev Routes Security**: Added `ENABLE_DEV_ROUTES` env var to gate `/api/dev/*` endpoints. Both `NODE_ENV=development` AND `ENABLE_DEV_ROUTES=true` are now required.
- **Chunk Load Recovery**: Frontend lazy-loaded components now automatically retry on chunk load failures (network issues, stale chunks after deployment).
- **LRU Cache**: Auth middleware L1 in-memory cache now uses LRU (Least Recently Used) eviction instead of FIFO for better cache hit rates.
- **OpenAPI Documentation**: Added `docs/openapi.yaml` with comprehensive API documentation. Endpoint available at `GET /api/docs/openapi.json`.
- **Test Coverage**: Added coverage thresholds and metrics to both frontend and backend Vitest configs. Run `npm run test:coverage` to generate reports.
- **Profanity Detection**: Extended profanity check message limit from 5K to 20K characters. Added Arabic-specific abuse patterns (emoji spam, special character flooding).

### Changed
- None

### Fixed
- None

### Security
- Dev routes now require explicit opt-in via environment variable
- Auth cache eviction improved to prevent cache pollution attacks

---

## [1.0.0] - 2026-01-XX

### Added
- Initial release of Sigma AI Chatbot
- Multi-model AI support (Groq, OpenAI, Gemini, DeepSeek, Qwen via OpenRouter)
- RAG pipeline with vector search + BM25 + reranking
- Three-tier memory system (session, cross-session, enhanced memory bank)
- Content moderation via Perspective API + local filters
- Rate limiting with Redis sliding window + in-memory fallback
- SSRF protection with DNS pinning
- Guest mode with cookie-based sessions
- Textbook processing pipeline
- Voice mode with Deepgram STT + ElevenLabs TTS
- Multi-language support (Arabic RTL + English)
- Comprehensive test suite (87+ test files)
- Docker Compose deployment
- Sentry error tracking
