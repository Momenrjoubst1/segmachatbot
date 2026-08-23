/**
 * Deepgram Voice Agent configuration — pure builders.
 *
 * Two consumers:
 *  - /ws/voice-agent relay: sends the `Settings` message on upstream open.
 *  - POST /api/voice/chat/completions adapter: owns the system prompt so the
 *    LLM persona has a SINGLE source of truth (we intentionally do NOT set
 *    agent.think.prompt in Settings — Deepgram would inject it as an extra
 *    system message alongside ours).
 *
 * Speak provider is env-driven because Deepgram's own TTS (Aura-2 / Flux)
 * has NO Arabic voices as of 2026 — Arabic-first deployments must use
 * eleven_labs (turbo v2.5) or cartesia. Defaults to eleven_labs when a key
 * exists, else falls back to deepgram with a loud warning.
 *
 * Verified against developers.deepgram.com/docs/configure-voice-agent,
 * /docs/voice-agent-llm-models and /docs/voice-agent-tts-models (2026-08).
 */

import { buildBasePersona } from "../../prompts/base-persona.js";

// ---------------------------------------------------------------------------
// Voice system prompt (adapter-owned)
// ---------------------------------------------------------------------------

/**
 * Sigma persona + spoken-conversation rules. The reply is synthesized to
 * speech, never rendered — so anything visual (markdown, code, lists, URLs)
 * is forbidden and brevity is mandatory.
 */
export function buildVoiceAgentSystemPrompt(): string {
  return `${buildBasePersona()}

# Voice Conversation Mode — وضع المحادثة الصوتية

Your reply is READ ALOUD by a text-to-speech engine. It is never displayed.
Follow these rules strictly:

1. **Speak, don't write**: no markdown, no bullet lists, no code blocks, no
   URLs, no emoji, no tables. Plain flowing sentences only.
2. **Be brief by default**: 1–4 short sentences. Expand only when the student
   explicitly asks for a detailed explanation.
3. **Match the user's language** — Jordanian/Levantine Arabic first, English
   when they switch. Keep the warm, encouraging study-buddy tone.
4. **One question at a time.** If you need clarification, ask exactly one
   short question and stop.
5. **Numbers and formulas**: say them naturally ("جذر اتنين" not "sqrt(2)").
   Never read out symbols like asterisks or backticks.
6. **No self-references to text UI**: never say "as written above", "check the
   link", or "the code below".
7. If you cannot help with something, say so kindly in ONE sentence.`;
}

/** First thing the agent says when a live session opens (greeting). */
export const DEFAULT_VOICE_GREETING =
  "أهلين! أنا سيجما، رفيقتك للدراسة. شو في مني ساعدك فيه اليوم؟";

// ---------------------------------------------------------------------------
// Settings message builder
// ---------------------------------------------------------------------------

export type VoiceAgentEnv = Record<string, string | undefined>;

export interface BuiltAgentSettings {
  settings: Record<string, unknown>;
  /** Non-fatal observations surfaced at attach time. */
  warnings: string[];
  summary: {
    listenModel: string;
    listenLanguage: string;
    speakProvider: string;
    speakModel: string;
    thinkEndpoint: string;
    greetingEnabled: boolean;
  };
}

function requireEnv(env: VoiceAgentEnv, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`Missing required env ${key}`);
  return v;
}

/**
 * True when the CONFIGURED speak provider has its credentials present.
 * Kept separate from buildSpeakBlock (which throws) so readiness probes can
 * answer accurately without building payloads: a deployment missing the
 * ElevenLabs key must report enabled=false, not kill every session at
 * Settings-send time with an opaque 1011.
 */
export function isSpeakProviderConfigured(env: VoiceAgentEnv): boolean {
  const provider = env.VOICE_AGENT_SPEAK_PROVIDER?.trim().toLowerCase();
  if (provider === "deepgram") return true; // uses DEEPGRAM_API_KEY, checked elsewhere
  if (provider === "cartesia") {
    return Boolean(env.CARTESIA_API_KEY?.trim() && env.CARTESIA_VOICE_ID?.trim());
  }
  // Default (and any unknown value) resolves to eleven_labs.
  return Boolean(env.ELEVENLABS_API_KEY?.trim() && env.ELEVENLABS_VOICE_ID?.trim());
}

/** Human-readable list of what is missing, for /agent-status diagnostics. */
export function describeVoiceConfigGaps(env: VoiceAgentEnv): string[] {
  const gaps: string[] = [];
  if (!env.DEEPGRAM_API_KEY?.trim()) gaps.push("DEEPGRAM_API_KEY");
  if (!env.VOICE_AGENT_SHARED_SECRET?.trim()) gaps.push("VOICE_AGENT_SHARED_SECRET");
  if (!env.VOICE_AGENT_THINK_URL?.trim()) gaps.push("VOICE_AGENT_THINK_URL");
  if (!isSpeakProviderConfigured(env)) {
    const provider = env.VOICE_AGENT_SPEAK_PROVIDER?.trim().toLowerCase();
    if (provider === "cartesia") {
      if (!env.CARTESIA_API_KEY?.trim()) gaps.push("CARTESIA_API_KEY");
      if (!env.CARTESIA_VOICE_ID?.trim()) gaps.push("CARTESIA_VOICE_ID");
    } else {
      if (!env.ELEVENLABS_API_KEY?.trim()) gaps.push("ELEVENLABS_API_KEY");
      if (!env.ELEVENLABS_VOICE_ID?.trim()) gaps.push("ELEVENLABS_VOICE_ID");
    }
  }
  return gaps;
}

/**
 * Think-adapter timeout. Must stay comfortably BELOW Deepgram's own think
 * timeout (~20s): if we are late, Deepgram fires THINK_REQUEST_FAILED and the
 * student hears silence — better to abort early and stream the spoken apology.
 */
export function getThinkTimeoutMs(): number {
  const v = parseInt(process.env.VOICE_AGENT_THINK_TIMEOUT_MS || "12000", 10);
  return Number.isFinite(v) && v > 2_000 ? Math.min(v, 18_000) : 12_000;
}

/** Build the speak block per configured provider; throws on missing secrets. */
function buildSpeakBlock(
  env: VoiceAgentEnv,
  warnings: string[],
  voiceIdOverride?: string,
): { provider: Record<string, unknown>; endpoint?: Record<string, unknown>; model: string } {
  const provider = env.VOICE_AGENT_SPEAK_PROVIDER?.trim().toLowerCase();

  if (provider === "deepgram") {
    const model = env.VOICE_AGENT_SPEAK_DEEPGRAM_MODEL?.trim() || "aura-2-thalia-en";
    if (!/-en$/.test(model)) {
      // Aura carries language in the model name; only *-en exist today.
      warnings.push(
        `Deepgram TTS model "${model}" may not support Arabic — Aura-2 covers en/es/de/fr/nl/it/ja only.`,
      );
    }
    return {
      provider: { type: "deepgram", version: "v1", model, speed: 1.0 },
      model,
    };
  }

  if (provider === "cartesia") {
    const apiKey = requireEnv(env, "CARTESIA_API_KEY");
    const voiceId = voiceIdOverride || requireEnv(env, "CARTESIA_VOICE_ID");
    const model = env.CARTESIA_MODEL?.trim() || "sonic-3";
    const language = env.VOICE_AGENT_SPEAK_LANGUAGE?.trim() || "ar";
    return {
      provider: {
        type: "cartesia",
        model_id: model,
        voice: { mode: "id", id: voiceId },
        language,
      },
      endpoint: {
        url: "https://api.cartesia.ai/tts/websocket",
        headers: { "x-api-key": apiKey },
      },
      model,
    };
  }

  // Default: ElevenLabs turbo v2.5 — WebSocket-streamable with Arabic (ar).
  if (provider && provider !== "eleven_labs") {
    warnings.push(
      `Unknown VOICE_AGENT_SPEAK_PROVIDER "${provider}" — falling back to eleven_labs.`,
    );
  }
  const apiKey = requireEnv(env, "ELEVENLABS_API_KEY");
  const voiceId = voiceIdOverride || requireEnv(env, "ELEVENLABS_VOICE_ID");
  const model = env.ELEVENLABS_MODEL?.trim() || "eleven_turbo_v2_5";
  const language = env.VOICE_AGENT_SPEAK_LANGUAGE?.trim() || "ar";
  return {
    provider: {
      type: "eleven_labs",
      model_id: model,
      language,
    },
    endpoint: {
      // Deepgram requires ElevenLabs' multi-stream-input WS endpoint for
      // streaming TTS inside agent sessions (plain /text-to-speech is
      // rejected with INVALID_SETTINGS).
      url: `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/multi-stream-input`,
      headers: { "xi-api-key": apiKey },
    },
    model,
  };
}

// ---------------------------------------------------------------------------
// Multi-voice support (persona-lite): primary + optional alternate ElevenLabs
// voices, selectable at session start (?voice=alt) or mid-session via
// {type:"set_voice"} — the relay builds the payloads server-side so the
// browser never sees provider credentials.
// ---------------------------------------------------------------------------

export interface AgentVoiceOption {
  key: string;
  label: string;
  voiceId: string;
}

/** Voices exposed to clients; empty when the provider isn't eleven_labs/cartesia. */
export function listAgentVoices(env: VoiceAgentEnv): AgentVoiceOption[] {
  const provider = env.VOICE_AGENT_SPEAK_PROVIDER?.trim().toLowerCase();
  let baseKey: string | undefined;
  let altId: string | undefined;

  if (!provider || provider === "eleven_labs") {
    if (!env.ELEVENLABS_API_KEY?.trim()) return [];
    baseKey = env.ELEVENLABS_VOICE_ID?.trim();
    altId = env.ELEVENLABS_VOICE_ID_ALT?.trim();
  } else if (provider === "cartesia") {
    if (!env.CARTESIA_API_KEY?.trim()) return [];
    baseKey = env.CARTESIA_VOICE_ID?.trim();
    altId = env.CARTESIA_VOICE_ID_ALT?.trim();
  } else {
    return []; // deepgram: single voice
  }

  if (!baseKey) return [];
  const voices: AgentVoiceOption[] = [
    {
      key: "primary",
      label: env.VOICE_AGENT_VOICE_NAME_PRIMARY?.trim() || "الصوت الأول",
      voiceId: baseKey,
    },
  ];
  if (altId) {
    voices.push({
      key: "alt",
      label: env.VOICE_AGENT_VOICE_NAME_ALT?.trim() || "الصوت الثاني",
      voiceId: altId,
    });
  }
  return voices;
}

export function resolveVoiceOption(
  env: VoiceAgentEnv,
  key?: string | null,
): AgentVoiceOption | null {
  const voices = listAgentVoices(env);
  if (!voices.length) return null;
  return voices.find((v) => v.key === key) ?? voices[0];
}

/**
 * Build the complete Voice Agent `Settings` payload.
 * Throws when required env pieces are missing — callers gate attachment on
 * isVoiceAgentConfigured() first, so a throw here is a programming error.
 *
 * opts.resume:    reconnect of an existing conversation (sid already has
 *                 buffered turns) — skips the greeting so a network blip
 *                 doesn't replay "أهلين!" mid-conversation.
 * opts.sessionId: stable per-conversation id; rides on the think endpoint
 *                 headers so the adapter can merge prior-turn history.
 * opts.userId:    authenticated Sigma user (from the relay's JWT check);
 *                 forwarded so the think adapter can scope TOOL calls
 *                 (calendar/tasks) to the right account. Server-side only.
 */
export function buildAgentSettings(
  env: VoiceAgentEnv,
  voiceKey?: string | null,
  opts?: {
    resume?: boolean;
    sessionId?: string | null;
    userId?: string | null;
  },
): BuiltAgentSettings {
  const warnings: string[] = [];

  const thinkUrl = requireEnv(env, "VOICE_AGENT_THINK_URL");
  const sharedSecret = requireEnv(env, "VOICE_AGENT_SHARED_SECRET");

  const listenModel = env.VOICE_AGENT_LISTEN_MODEL?.trim() || "nova-3";
  // Arabic-first: nova-3 "multi" is en/es code-switching ONLY and mangles
  // Levantine Arabic (verified 2026-08-24). Default to `ar`.
  const listenLanguage = env.VOICE_AGENT_LISTEN_LANGUAGE?.trim() || "ar";
  const inputSampleRate = Number(env.VOICE_AGENT_INPUT_SAMPLE_RATE || 16000);
  const outputSampleRate = Number(env.VOICE_AGENT_OUTPUT_SAMPLE_RATE || 24000);

  const voiceOption = resolveVoiceOption(env, voiceKey);
  const speak = buildSpeakBlock(env, warnings, voiceOption?.voiceId);

  const greetingRaw = env.VOICE_AGENT_GREETING?.trim();
  // Unset -> default greeting. "off" (or empty string) disables it.
  const greetingEnabled =
    !opts?.resume && greetingRaw !== "off" && greetingRaw !== "";

  const settings: Record<string, unknown> = {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: inputSampleRate },
      output: {
        encoding: "linear16",
        sample_rate: outputSampleRate,
        container: "none",
      },
    },
    agent: {
      listen: {
        provider: {
          type: "deepgram",
          model: listenModel,
          language: listenLanguage,
        },
      },
      think: {
        provider: {
          type: "open_ai", // OpenAI Chat Completions PROTOCOL — our adapter speaks it
          model: env.VOICE_AGENT_THINK_MODEL?.trim() || "sigma-voice-agent",
          temperature: Number(env.VOICE_AGENT_TEMPERATURE || 0.6),
        },
        endpoint: {
          url: thinkUrl,
          headers: {
            authorization: `Bearer ${sharedSecret}`,
            ...(opts?.sessionId
              ? { "x-sigma-session-id": opts.sessionId }
              : {}),
            ...(opts?.userId
              ? { "x-sigma-user-id": opts.userId }
              : {}),
            // Dev-tunnel helper: localtunnel shows an interstitial page to
            // browser-like requests unless this header is present. Harmless
            // in production and ignored by our adapter.
            "bypass-tunnel-reminder": "true",
          },
        },
      },
      speak: { provider: speak.provider, ...(speak.endpoint ? { endpoint: speak.endpoint } : {}) },
    },
  };

  if (greetingEnabled) {
    const greeting = greetingRaw || DEFAULT_VOICE_GREETING;
    (settings.agent as Record<string, unknown>).greeting = greeting;
  }

  return {
    settings,
    warnings,
    summary: {
      listenModel,
      listenLanguage,
      speakProvider: String((speak.provider as { type: string }).type),
      speakModel: speak.model,
      thinkEndpoint: thinkUrl,
      greetingEnabled,
    },
  };
}

/** Cheap readiness probe used by the status endpoint and WS gating. */
export function isVoiceAgentConfigured(env: VoiceAgentEnv): boolean {
  return Boolean(
    env.DEEPGRAM_API_KEY?.trim() &&
      env.VOICE_AGENT_SHARED_SECRET?.trim() &&
      env.VOICE_AGENT_THINK_URL?.trim() &&
      isSpeakProviderConfigured(env),
  );
}

/**
 * Mid-session voice switch: the Deepgram `UpdateSpeak` message with a fully
 * server-built speak block (credentials stay here, never in the browser).
 * Returns null for unknown keys — callers ignore silently.
 */
export function buildUpdateSpeakPayload(
  env: VoiceAgentEnv,
  voiceKey: string,
): Record<string, unknown> | null {
  const option = listAgentVoices(env).find((v) => v.key === voiceKey);
  if (!option) return null;
  const warnings: string[] = [];
  const speak = buildSpeakBlock(env, warnings, option.voiceId);
  return {
    type: "UpdateSpeak",
    speak: {
      provider: speak.provider,
      ...(speak.endpoint ? { endpoint: speak.endpoint } : {}),
    },
  };
}
