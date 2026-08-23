# Sigma AI Chatbot — Project Memory

## Voice stack (as of 2026-08-23)

- **STT (dictation + live)**: Deepgram Nova-3 via our own WS relay `/ws/stt`
  (`backend/src/ws/stt-ws.ts`, `services/stt/deepgram-relay.ts`). PCM16/16k mono
  from `public/worklets/pcm-capture-worklet.js`. Pre-roll buffer fixed the
  leading-speech-loss bug; e2e: `backend/scripts/stt-relay-e2e.mts` → "PIPE VERIFIED".
  Env gates: `DEEPGRAM_API_KEY`, `STT_ALLOW_ANON_DEV=true` for headless tests.
- **TTS (live voice replies)**: Microsoft Edge Read Aloud via `msedge-tts` npm.
  Deepgram TTS has NO Arabic. Endpoint rejects `ar-SA-ShakirNeural`; working set:
  ar-JO-SanaNeural, ar-SA-HamedNeural, ar-EG-SalmaNeural, **ar-SY-LaithNeural**.
  Routes: `GET /api/tts/voices`, `POST /api/tts {text,voiceId}` → mp3 (LRU cached).
  Verify with `npx tsx backend/scripts/test-tts.ts`.
- **Live mode frontend**: `frontend/src/hooks/useLiveVoice.ts` orchestrator;
  endpointing in `lib/stt/silence-endpoint-detector.ts` (850ms + semantic
  extension; pre-speech gate); sentences via `lib/tts/sentence-splitter.ts`;
  playback `lib/tts/audio-player.ts`. LIVE button = AudioLines icon beside mic;
  personas persist in localStorage `sigma_voice_persona`.
- Debug overlay: open app with `?voiceDebug=1` → black panel near composer
  (`VoiceDebugOverlay` + `lib/stt/voice-debug-bus.ts`).

## Multi-agent worktree hazard (IMPORTANT)

All agents share ONE working directory. Anyone can switch branches mid-session:
a later agent's `git commit` can land on ANOTHER agent's active branch, and
branch refs get recreated from foreign HEADs. Before committing/pushing:
1. `git branch --show-current` — verify you are on YOUR branch.
2. After push, verify remote SHA: `git rev-parse <branch> origin/<branch>`.
3. To repair a ref without touching the shared checkout:
   `git update-ref refs/heads/<b> <sha>; git push origin "+<sha>:refs/heads/<b>"`.

## Model routing

Primary chat model: `stealth/ox-alpha` via OpenRouter; NVIDIA NIM backup.
Embeddings: NVIDIA NIM 1024-dim primary. Loose UIMessage validator restored
(400 messages.0.content bug) — do not re-tighten without a compat shim.

## Conventions

- i18n flat dotted keys per locale file (`ar/chat.json`, `en/chat.json`).
- Backend routes: `src/routes/*.routes.ts` mounted in `src/index.ts` under
  `/api/*` with `authMiddleware`. Frontend fetch via `@/lib/auth` authFetch +
  `BACKEND_URL` from `@/lib/config`.
- Frontend tests: vitest (`npm test`). Typecheck: `npx tsc --noEmit` in each app.
