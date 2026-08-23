import { describe, expect, it } from "vitest";

import { classifyClose } from "@/lib/voice-agent/agent-client";

describe("classifyClose — relay close-code contract", () => {
  it("auth and disabled are fatal", () => {
    expect(classifyClose(4401, "unauthorized")).toBe("auth");
    expect(classifyClose(4003, "voice_agent_disabled")).toBe("disabled");
  });

  it("distinguishes the two things sharing close code 4029", () => {
    // Slot conflict: transient, retried with its own budget.
    expect(classifyClose(4029, "already_streaming")).toBe("busy");
    // Daily cap: a clean end, NOT an error.
    expect(classifyClose(4029, "daily_limit_reached")).toBe("session_end");
  });

  it("duration caps end gracefully instead of erroring", () => {
    expect(classifyClose(4028, "max_session_duration")).toBe("session_end");
    expect(classifyClose(4408, "client_timeout")).toBe("session_end");
  });

  it("everything else is a plain connection failure", () => {
    expect(classifyClose(1006, "")).toBe("connection");
    expect(classifyClose(1011, "upstream_error")).toBe("connection");
    expect(classifyClose(4502, "upstream_error")).toBe("connection");
  });
});
