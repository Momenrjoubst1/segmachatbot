# Live Voice Chat — Sigma AI (Claude/Grok-style)

Status: v1 IMPLEMENTED & PUSHED (`feature/live-voice-chat`) · Author: ox-alpha autonomous session

## 0. Outcome (autonomous session)

- Backend: `/api/tts/voices` + `POST /api/tts` live; all 4 personas synthesize
  real Arabic MP3s (52–58 KB, warm-cache ~0.7 s). faris voice swapped to
  ar-SY-LaithNeural after Edge rejected ar-SA-ShakirNeural.
- Frontend: useLiveVoice orchestrator + LIVE toggle + persona dropdown shipped;
  detector/splitter/player/client libs with 19 dedicated vitest scenarios;
  full suite 524/524 green; tsc clean project-wide.
- Verified: backend boots on branch, routes auth-gated (401 not 404),
  STT relay e2e PIPE VERIFIED post-edits, branch pushed.

### Known v1 limitations
- Persona behavioral primers NOT yet injected into system prompt (voice-only
  personas) — requires threading `personaId` through chat pipeline
  (assembleSystemPrompt arg), left as milestone-2 to avoid shared-file surgery
  while other agents work.
- Each turn reopens mic/WS (~600 ms); a persistent live socket is the next
  latency win.
- Barge-in uses energy gate above speech threshold; no neural VAD yet.

## 1. What we are building

Not dictation (exists) — a **full live voice conversation mode**:

1. User taps "live" button → mic opens → words stream into composer (existing Deepgram relay).
2. When the user **stops speaking**, the message **auto-sends** — no send button.
3. The bot replies **in text and voice simultaneously**: text streams as usual while completed
   sentences are synthesized to speech and played in order.
4. Multiple **voice personas** (Grok-style): each persona = a TTS voice + a behavioral
   character primer mixed into the system prompt. User picks persona; choice persists.
5. Barge-in: speaking while the bot talks interrupts it (browser AEC makes the mic safe
   to leave open during playback).

## 2. Research conclusions (why these choices)

| Decision | Evidence |
|---|---|
| Endpointing = silence timer 850ms + hangover + semantic extension | Multigrid/AssemblyAI/talkflowai guides: 500–900ms sweet spot; never endpoint before speech started; extend when partial ends in conjunction/preposition; backstop max utterance |
| VAD via RMS energy on existing PCM16 worklet stream | We already stream PCM16 16k mono through our WS relay; energy VAD is enough for turn-taking (neural VAD unnecessary for this UX layer) |
| TTS provider = Microsoft Edge Read Aloud (`msedge-tts`, MIT, 41k wk, server-side OK) | Deepgram TTS has NO Arabic (official GH discussion); Aura-2 = en/es/de/fr/nl/it/ja only. Edge API exposes Azure neural voices incl. ar-JO/ar-SA/ar-EG for free |
| Persona architecture = Grok's two-layer model | Grok separates voice personas (Ara/Eve/Leo/Rex/Sal/Gork) from behavioral personality prompts; any mix allowed |
| Playback = WebAudio decode + sequential SourceNode queue | Gapless, precise stop() for barge-in, no `<audio>` element quirks |
| Auto-send via composer form requestSubmit() | Decoupled from assistant-ui internals; verified DOM slot exists |

## 3. Personas v1 (Arabic-first)

| id | Name | Voice | Character |
|---|---|---|---|
| sana | سيجما / Sana | ar-JO-SanaNeural | Default warm Jordanian study-buddy, encouraging |
| hakeem | حكيم / Hakeem | ar-SA-HamedNeural | Calm professor, thorough, Socratic |
| noor | نور / Noor | ar-EG-SalmaNeural | Bright energetic tutor, celebratory |
| faris | فارس / Faris | ar-SA-ShakirNeural | Confident formal lecturer, concise |

Each carries: AR/EN display name+description, gender, locale, `primer` (1-2 sentence
system-prompt flavor appended only during live mode).

## 4. Architecture

```
[PCM16 worklet] ──rms──► SilenceEndpointDetector ──endpoint──► auto-submit composer
      │                                                        (existing chat pipeline)
      ▼
[Deepgram WS relay] ──partials/finals──► composer text (existing)

assistant reply text streaming ──sentence-splitter──► per-sentence:
                                                      POST /api/tts {text, voiceId}
                                                      ──mp3──► AudioQueuePlayer ► speakers

user speech during playback ──► player.stopAll() + abort fetches ──► listening state
```

### Backend (new files)
- `src/config/voice-personas.ts` — catalog + validation helper
- `src/services/tts-service.ts` — MsEdgeTTS wrapper: xml-escape input, strip
  markdown/code-fences/emoji before synthesis, LRU cache keyed `voiceId+sha(text)`
- `src/routes/tts.ts` — `GET /api/tts/voices`; `POST /api/tts` (auth) → `audio/mpeg`
- Mount route in server entry.

### Frontend (new files)
- `lib/stt/silence-endpoint-detector.ts` — pure, unit-testable state machine
- `lib/tts/sentence-splitter.ts` — incremental sentence extraction + markdown strip
- `lib/tts/tts-client.ts` — fetch wrapper w/ AbortSignal
- `lib/tts/audio-player.ts` — AudioQueuePlayer (enqueue/stop/volume/events)
- `hooks/useLiveVoice.ts` — orchestrator (states: idle/listening/sending/thinking/speaking)
- UI: MicButton gains LIVE toggle + persona popover + status ring/caption
- i18n keys EN/AR under `voice.*`

## 5. Tunables (initial values)

| Param | Value | Note |
|---|---|---|
| ENDPOINT_SILENCE_MS | 850 | base silence to end turn |
| HANGOVER_MS | 250 | keep speech flag alive on micro-pauses |
| SEMANTIC_EXTEND_MS | +500 | trailing conjunction/preposition/dangling clause |
| SPEECH_START_RMS | 350 | Int16 RMS to open speech gate |
| SPEECH_HOLD_RMS | 220 | hysteresis close threshold |
| MIN_UTTERANCE_MS | 700 | ignore sub-word blips |
| MAX_UTTERANCE_MS | 60000 | backstop force-send |
| AUTO_SUBMIT_MIN_WORDS | 2 | Claude Code parity (≥3 words en, ≥2 ar tokens approx) |

## 6. Degradation contract

- TTS fetch fails → toast once, conversation continues TEXT-ONLY (never blocks chat).
- Edge API blocked/rate-limited → 503 with `{error}`; frontend treats as above.
- Dictation-only mode remains fully functional & untouched when LIVE is off.

## 7. Verification plan (autonomous, user asleep)

1. Backend curl POST Arabic text → mp3 saved; assert size>8KB + ID3/0xFF magic.
2. Node unit runs: detector scenarios (mid-pause no-fire, end fire ~850ms,
   pre-speech no-fire, conjunction extension, max-utterance backstop).
3. Sentence splitter: streaming chunk fixtures incl. markdown/code fences.
4. tsc clean for ALL new/edited files (calendar agent WIP errors excluded as foreign).
5. Existing STT relay e2e script still PIPE VERIFIED.
6. Milestone commits pushed to `feature/live-voice-chat`.

## 8. Explicit non-goals this iteration

- No full-duplex realtime websocket voice (OpenAI Realtime style) — cost/complexity.
- No neural on-device VAD (Silero) unless energy VAD proves insufficient.
- No voice cloning. No animated avatar.
