import { describe, expect, it } from "vitest";

import {
  buildAgentSettings,
  buildUpdateSpeakPayload,
  buildVoiceAgentSystemPrompt,
  isVoiceAgentConfigured,
  listAgentVoices,
} from "../services/voice/agent-settings.js";

const BASE_ENV = {
  DEEPGRAM_API_KEY: "dg-key",
  VOICE_AGENT_SHARED_SECRET: "secret-1",
  VOICE_AGENT_THINK_URL: "https://api.example.com/api/voice/chat/completions",
};

/** Fully-configured env: speak-provider credentials included (default eleven_labs). */
const READY_ENV = {
  ...BASE_ENV,
  ELEVENLABS_API_KEY: "el-key",
  ELEVENLABS_VOICE_ID: "voice-123",
};

describe("isVoiceAgentConfigured", () => {
  it("requires key + secret + think url AND speak-provider credentials", () => {
    expect(isVoiceAgentConfigured({})).toBe(false);
    expect(isVoiceAgentConfigured({ ...READY_ENV, DEEPGRAM_API_KEY: "" })).toBe(false);
    expect(isVoiceAgentConfigured({ ...READY_ENV, VOICE_AGENT_THINK_URL: " " })).toBe(false);
    // Regression guard: missing TTS creds must NOT report enabled — that
    // used to let every session die at Settings-send with a generic error.
    expect(isVoiceAgentConfigured(BASE_ENV)).toBe(false);
    expect(
      isVoiceAgentConfigured({ ...BASE_ENV, ELEVENLABS_API_KEY: "el-key" }),
    ).toBe(false); // voice id still missing
    expect(isVoiceAgentConfigured(READY_ENV)).toBe(true);
  });

  it("accepts cartesia credentials when cartesia is selected", () => {
    const cartesia = {
      ...BASE_ENV,
      VOICE_AGENT_SPEAK_PROVIDER: "cartesia",
      CARTESIA_API_KEY: "c-key",
      CARTESIA_VOICE_ID: "cv-1",
    };
    expect(isVoiceAgentConfigured(cartesia)).toBe(true);
  });
});

describe("buildAgentSettings session continuity", () => {
  it("stamps sid + user headers for the think adapter", () => {
    const { settings } = buildAgentSettings(READY_ENV, null, {
      sessionId: "conv-abc",
      userId: "00000000-0000-0000-0000-000000000001",
    });
    const headers = (settings.agent as Record<string, any>).think.endpoint.headers;
    expect(headers["x-sigma-session-id"]).toBe("conv-abc");
    expect(headers["x-sigma-user-id"]).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("resume sessions skip the greeting so reconnects don't replay it", () => {
    const fresh = buildAgentSettings(READY_ENV);
    const resumed = buildAgentSettings(READY_ENV, null, { resume: true });
    expect((fresh.settings.agent as Record<string, any>).greeting).toBeDefined();
    expect((resumed.settings.agent as Record<string, any>).greeting).toBeUndefined();
  });
});

describe("buildVoiceAgentSystemPrompt", () => {
  it("embeds Sigma identity and spoken-only rules", () => {
    const p = buildVoiceAgentSystemPrompt();
    expect(p).toContain("Sigma");
    expect(p).toContain("Voice Conversation Mode");
    expect(p).toMatch(/no markdown/i);
  });
});

describe("buildAgentSettings", () => {
  const elevenEnv = {
    ...BASE_ENV,
    ELEVENLABS_API_KEY: "el-key",
    ELEVENLABS_VOICE_ID: "voice-123",
  };

  it("defaults to eleven_labs with arabic and wss endpoint", () => {
    const { settings, summary, warnings } = buildAgentSettings(elevenEnv);
    expect(warnings).toEqual([]);
    expect(summary.speakProvider).toBe("eleven_labs");

    const agent = settings.agent as Record<string, any>;
    // Arabic-first: nova-3 "multi" is en/es ONLY and mangles Levantine Arabic.
    expect(agent.listen.provider).toMatchObject({
      type: "deepgram",
      model: "nova-3",
      language: "ar",
    });
    // BYO think: open_ai protocol + our adapter URL + bearer secret
    expect(agent.think.provider.type).toBe("open_ai");
    expect(agent.think.endpoint.url).toBe(BASE_ENV.VOICE_AGENT_THINK_URL);
    expect(agent.think.endpoint.headers.authorization).toBe("Bearer secret-1");
    // No think.prompt — the adapter owns the system prompt.
    expect(agent.think.prompt).toBeUndefined();

    expect(agent.speak.provider).toMatchObject({
      type: "eleven_labs",
      model_id: "eleven_turbo_v2_5",
      language: "ar",
    });
    expect(agent.speak.endpoint.url).toContain(
      "wss://api.elevenlabs.io/v1/text-to-speech/voice-123",
    );
    expect(agent.speak.endpoint.headers["xi-api-key"]).toBe("el-key");

    expect(settings.audio.input).toEqual({ encoding: "linear16", sample_rate: 16000 });
    expect(settings.audio.output).toEqual({
      encoding: "linear16",
      sample_rate: 24000,
      container: "none",
    });
    expect(typeof agent.greeting).toBe("string");
    expect((agent.greeting as string).length).toBeGreaterThan(0);
  });

  it("greeting=off removes the greeting", () => {
    const { settings } = buildAgentSettings({ ...elevenEnv, VOICE_AGENT_GREETING: "off" });
    expect((settings.agent as Record<string, any>).greeting).toBeUndefined();
  });

  it("deepgram provider warns about missing Arabic coverage for non-en models", () => {
    const { warnings, summary } = buildAgentSettings({
      ...BASE_ENV,
      VOICE_AGENT_SPEAK_PROVIDER: "deepgram",
      VOICE_AGENT_SPEAK_DEEPGRAM_MODEL: "aura-2-sirio-es",
    });
    expect(summary.speakProvider).toBe("deepgram");
    expect(warnings.some((w) => w.includes("Arabic"))).toBe(true);
  });

  it("cartesia provider requires key + voice id", () => {
    expect(() =>
      buildAgentSettings({ ...BASE_ENV, VOICE_AGENT_SPEAK_PROVIDER: "cartesia" }),
    ).toThrow(/CARTESIA_API_KEY/);

    const { settings } = buildAgentSettings({
      ...BASE_ENV,
      VOICE_AGENT_SPEAK_PROVIDER: "cartesia",
      CARTESIA_API_KEY: "c-key",
      CARTESIA_VOICE_ID: "cv-1",
    });
    const speak = (settings.agent as Record<string, any>).speak;
    expect(speak.provider.voice).toEqual({ mode: "id", id: "cv-1" });
    expect(speak.endpoint.headers["x-api-key"]).toBe("c-key");
  });

  it("throws when shared secret or think url missing", () => {
    expect(() => buildAgentSettings({ DEEPGRAM_API_KEY: "k" })).toThrow();
  });

  it("exposes primary + alt elevenlabs voices and switches mid-session", () => {
    const env = {
      ...elevenEnv,
      ELEVENLABS_VOICE_ID_ALT: "alt-voice-9",
      VOICE_AGENT_VOICE_NAME_PRIMARY: "سنا",
      VOICE_AGENT_VOICE_NAME_ALT: "حكيم",
    };
    const voices = listAgentVoices(env);
    expect(voices).toEqual([
      { key: "primary", label: "سنا", voiceId: "voice-123" },
      { key: "alt", label: "حكيم", voiceId: "alt-voice-9" },
    ]);

    // Initial Settings honors the alt choice
    const { settings } = buildAgentSettings(env, "alt");
    expect(
      ((settings.agent as Record<string, any>).speak.endpoint.url as string),
    ).toContain("text-to-speech/alt-voice-9");

    // Mid-session UpdateSpeak payload is fully server-built
    const payload = buildUpdateSpeakPayload(env, "alt") as Record<string, any>;
    expect(payload.type).toBe("UpdateSpeak");
    expect(payload.speak.provider.type).toBe("eleven_labs");
    expect(payload.speak.endpoint.url).toContain("alt-voice-9");
    expect(payload.speak.endpoint.headers["xi-api-key"]).toBe("el-key");

    // Unknown key → null (relay ignores silently)
    expect(buildUpdateSpeakPayload(env, "nope")).toBeNull();
  });

  it("returns a single voice when no alt configured", () => {
    const voices = listAgentVoices(elevenEnv);
    expect(voices).toHaveLength(1);
    expect(voices[0].key).toBe("primary");
  });
});
