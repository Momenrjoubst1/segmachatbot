import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { reportBotActivity, useBotActivitySnapshot } from "@/features/ai-assistant/ui/bot-activity/botActivityBridge";
import type { BotActivity } from "@/features/ai-assistant/ui/bot-activity/types";

const IDLE: BotActivity = {
  status: "idle",
  steps: [],
  currentStep: null,
  elapsedMs: 0,
  tokenCount: 0,
  isStreaming: false,
};

const THINKING: BotActivity = {
  status: "thinking",
  steps: [],
  currentStep: null,
  elapsedMs: 250,
  tokenCount: 0,
  isStreaming: false,
};

describe("botActivityBridge", () => {
  beforeEach(() => {
    // Reset to idle between tests by reporting it explicitly. (The bridge
    // has no public reset; tests should report what they need.)
    reportBotActivity(IDLE);
  });

  it("starts with the most recent reported activity", () => {
    act(() => reportBotActivity(THINKING));
    const { result } = renderHook(() => useBotActivitySnapshot());
    expect(result.current.status).toBe("thinking");
    expect(result.current.elapsedMs).toBe(250);
  });

  it("updates subscribers when a new activity is reported", () => {
    const { result } = renderHook(() => useBotActivitySnapshot());
    expect(result.current.status).toBe("idle");

    act(() => reportBotActivity(THINKING));
    expect(result.current.status).toBe("thinking");
  });

  it("broadcasts updates to multiple subscribers", () => {
    const a = renderHook(() => useBotActivitySnapshot());
    const b = renderHook(() => useBotActivitySnapshot());
    expect(b.result.current.status).toBe("idle");

    act(() => reportBotActivity(THINKING));

    expect(a.result.current.status).toBe("thinking");
    // b was also updated by the same broadcast.
    expect(b.result.current.status).toBe("thinking");
  });

  it("returns the last-known activity even if it is the default", () => {
    // No report ever made — but our beforeEach reset to IDLE.
    const { result } = renderHook(() => useBotActivitySnapshot());
    expect(result.current).toEqual(IDLE);
  });
});
