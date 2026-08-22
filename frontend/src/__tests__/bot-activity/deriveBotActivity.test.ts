import { describe, expect, it } from "vitest";
import {
  deriveBotActivity,
  formatDuration,
  getToolSubLabel,
  highestPriority,
} from "@/features/ai-assistant/ui/bot-activity/deriveBotActivity";
import type { AuiPart, StepStreamEvent } from "@/features/ai-assistant/ui/bot-activity/types";

const NOW = 1_700_000_000_000;
const START = NOW - 1500;

describe("deriveBotActivity", () => {
  describe("idle / empty", () => {
    it("returns idle when no status", () => {
      const a = deriveBotActivity({ parts: [], status: null, now: NOW });
      expect(a.status).toBe("idle");
      expect(a.steps).toEqual([]);
      expect(a.currentStep).toBeNull();
      expect(a.tokenCount).toBe(0);
      expect(a.isStreaming).toBe(false);
    });

    it("returns idle when status is complete with no running steps", () => {
      const a = deriveBotActivity({ parts: [], status: { type: "complete" }, now: NOW });
      expect(a.status).toBe("idle");
    });
  });

  describe("running → status precedence", () => {
    it("returns thinking when no parts and no events", () => {
      const a = deriveBotActivity({ parts: [], status: { type: "running" }, now: NOW });
      expect(a.status).toBe("thinking");
    });

    it("returns streaming when text parts have content", () => {
      const parts: AuiPart[] = [{ type: "text", text: "Hello " }];
      const a = deriveBotActivity({ parts, status: { type: "running" }, now: NOW });
      expect(a.status).toBe("streaming");
      expect(a.isStreaming).toBe(true);
      // chars/4 = 6/4 = 2 (rounded)
      expect(a.tokenCount).toBe(2);
    });

    it("returns tool_running when a tool-call is in progress", () => {
      const parts: AuiPart[] = [{
        type: "tool-call",
        toolCallId: "c1",
        toolName: "calculator",
        status: { type: "running" },
      }];
      const a = deriveBotActivity({ parts, status: { type: "running" }, now: NOW });
      expect(a.status).toBe("tool_running");
    });

    it("returns moderating when a moderation event is running", () => {
      const events: StepStreamEvent[] = [
        { id: "mod1", kind: "moderation", status: "running", ts: START },
      ];
      const a = deriveBotActivity({ parts: [], status: { type: "running" }, streamEvents: events, now: NOW });
      expect(a.status).toBe("moderating");
    });

    it("returns retrieving when rag_pipeline is running", () => {
      const events: StepStreamEvent[] = [
        { id: "r1", kind: "rag_pipeline", status: "running", ts: START },
      ];
      const a = deriveBotActivity({ parts: [], status: { type: "running" }, streamEvents: events, now: NOW });
      expect(a.status).toBe("retrieving");
    });

    it("uses the latest running step when multiple are running", () => {
      const events: StepStreamEvent[] = [
        { id: "m", kind: "moderation", status: "complete", ts: START },
        { id: "r", kind: "rag_pipeline", status: "running", ts: START + 100 },
      ];
      const a = deriveBotActivity({ parts: [], status: { type: "running" }, streamEvents: events, now: NOW });
      expect(a.status).toBe("retrieving");
      expect(a.currentStep?.id).toBe("r");
    });
  });

  describe("stopped → interrupted", () => {
    it("returns interrupted when status is stopped", () => {
      const a = deriveBotActivity({ parts: [], status: { type: "stopped" }, now: NOW });
      expect(a.status).toBe("interrupted");
    });
  });

  describe("errored → error", () => {
    it("returns error when status is errored", () => {
      const events: StepStreamEvent[] = [
        { id: "e1", kind: "generation", status: "error", error: "rate limit", ts: NOW - 100 },
      ];
      const a = deriveBotActivity({ parts: [], status: { type: "errored" }, streamEvents: events, now: NOW });
      expect(a.status).toBe("error");
      expect(a.errorMessage).toBe("rate limit");
    });

    it("falls back to a generic message if no errored step", () => {
      const a = deriveBotActivity({ parts: [], status: { type: "errored" }, now: NOW });
      expect(a.status).toBe("error");
      expect(a.errorMessage).toBe("Stream failed");
    });
  });

  describe("step building from events", () => {
    it("merges running and complete events with the same id", () => {
      const events: StepStreamEvent[] = [
        { id: "m", kind: "moderation", status: "running", ts: START },
        { id: "m", kind: "moderation", status: "complete", ts: START + 120, label: "Allowed" },
      ];
      const a = deriveBotActivity({ parts: [], status: { type: "complete" }, streamEvents: events, now: NOW });
      expect(a.steps).toHaveLength(1);
      expect(a.steps[0].status).toBe("complete");
      expect(a.steps[0].label).toBe("Allowed");
      expect(a.steps[0].durationMs).toBe(120);
    });

    it("keeps steps sorted by startedAt", () => {
      const events: StepStreamEvent[] = [
        { id: "g", kind: "generation", status: "complete", ts: START + 200 },
        { id: "m", kind: "moderation", status: "complete", ts: START },
        { id: "r", kind: "rag_pipeline", status: "complete", ts: START + 100 },
      ];
      const a = deriveBotActivity({ parts: [], status: { type: "complete" }, streamEvents: events, now: NOW });
      expect(a.steps.map((s) => s.id)).toEqual(["m", "r", "g"]);
    });

    it("computes running duration against `now`", () => {
      const events: StepStreamEvent[] = [
        { id: "r", kind: "rag_pipeline", status: "running", ts: START },
      ];
      const a = deriveBotActivity({ parts: [], status: { type: "running" }, streamEvents: events, now: NOW });
      expect(a.steps[0].durationMs).toBe(NOW - START);
    });
  });

  describe("merging AUI parts", () => {
    it("adds tool-call parts as steps even without stream events", () => {
      const parts: AuiPart[] = [{
        type: "tool-call",
        toolCallId: "c1",
        toolName: "calculator",
        status: { type: "running" },
      }];
      const a = deriveBotActivity({ parts, status: { type: "running" }, now: NOW });
      expect(a.steps.find((s) => s.toolName === "calculator")).toBeTruthy();
    });

    it("does not override an event-provided label", () => {
      const events: StepStreamEvent[] = [
        { id: "tool-c1", kind: "tool_call", status: "running", toolName: "web_search", label: "Searching 'calculus limits'", ts: START },
      ];
      const parts: AuiPart[] = [{
        type: "tool-call",
        toolCallId: "c1",
        toolName: "web_search",
        status: { type: "running" },
      }];
      const a = deriveBotActivity({ parts, status: { type: "running" }, streamEvents: events, now: NOW });
      const step = a.steps.find((s) => s.id === "tool-c1");
      expect(step?.label).toBe("Searching 'calculus limits'");
    });
  });

  describe("token estimation", () => {
    it("sums text lengths divided by 4 and rounds", () => {
      const parts: AuiPart[] = [
        { type: "text", text: "x".repeat(100) },
        { type: "text", text: "y".repeat(50) },
      ];
      const a = deriveBotActivity({ parts, status: { type: "running" }, now: NOW });
      expect(a.tokenCount).toBe(Math.round(150 / 4));
    });

    it("ignores non-text parts", () => {
      const parts: AuiPart[] = [
        { type: "text", text: "abc" },
        { type: "reasoning", text: "ignored" } as unknown as AuiPart,
      ];
      const a = deriveBotActivity({ parts, status: { type: "running" }, now: NOW });
      expect(a.tokenCount).toBe(1);
    });
  });

  describe("elapsed time", () => {
    it("returns 0 when no start ts", () => {
      const a = deriveBotActivity({ parts: [], status: { type: "running" }, now: NOW });
      expect(a.elapsedMs).toBe(0);
    });

    it("returns now - start when start is provided", () => {
      const a = deriveBotActivity({ parts: [], status: { type: "running" }, messageStartTs: START, now: NOW });
      expect(a.elapsedMs).toBe(1500);
    });

    it("never goes negative", () => {
      const a = deriveBotActivity({ parts: [], status: { type: "running" }, messageStartTs: NOW + 1000, now: NOW });
      expect(a.elapsedMs).toBe(0);
    });
  });
});

describe("formatDuration", () => {
  it("formats < 1s as ms", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(340)).toBe("340ms");
    expect(formatDuration(50)).toBe("50ms");
  });

  it("formats < 60s with 1 decimal under 10s, else integer", () => {
    expect(formatDuration(1100)).toBe("1.1s");
    expect(formatDuration(9999)).toBe("10.0s");
    expect(formatDuration(15000)).toBe("15s");
  });

  it("formats >= 60s as m SSs", () => {
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(125_000)).toBe("2m 05s");
  });
});

describe("getToolSubLabel", () => {
  it("converts snake_case to Title Case", () => {
    expect(getToolSubLabel("web_search")).toBe("Web Search");
    expect(getToolSubLabel("create_calendar_event")).toBe("Create Calendar Event");
  });

  it("handles single word", () => {
    expect(getToolSubLabel("calculator")).toBe("Calculator");
  });
});

describe("highestPriority", () => {
  it("returns the first match in the priority order", () => {
    expect(highestPriority(["idle", "streaming", "error"])).toBe("error");
    expect(highestPriority(["thinking", "tool_running"])).toBe("tool_running");
    expect(highestPriority(["idle"])).toBe("idle");
  });

  it("returns idle when no candidates match", () => {
    expect(highestPriority([])).toBe("idle");
  });
});
