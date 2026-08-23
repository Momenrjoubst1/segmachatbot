import { describe, it, expect } from "vitest";
import {
  SilenceEndpointDetector,
  isLikelyIncomplete,
  DEFAULT_ENDPOINT_CONFIG,
} from "../silence-endpoint-detector";

/** Deterministic clock for scenario tests. */
function makeClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("SilenceEndpointDetector", () => {
  it("never endpoints before the user has spoken (pre-speech silence)", () => {
    const c = makeClock();
    const d = new SilenceEndpointDetector(undefined, c.now);
    for (let i = 0; i < 100; i++) {
      c.advance(50);
      expect(d.feed(5).endpoint).toBe(false); // quiet room RMS
    }
    expect(d.hasSpoken).toBe(false);
  });

  it("fires ~silenceMs after speech ends", () => {
    const c = makeClock();
    const d = new SilenceEndpointDetector(undefined, c.now);

    // speak for 2s
    for (let i = 0; i < 40; i++) {
      c.advance(50);
      d.feed(900);
    }
    // go silent
    let firedAt = -1;
    for (let i = 1; i <= 30; i++) {
      c.advance(50);
      if (d.feed(10).endpoint) {
        firedAt = i * 50;
        break;
      }
    }
    // 850ms base + hangover slack -> fires between 850 and 900ms of silence
    expect(firedAt).toBeGreaterThanOrEqual(DEFAULT_ENDPOINT_CONFIG.silenceMs);
    expect(firedAt).toBeLessThanOrEqual(
      DEFAULT_ENDPOINT_CONFIG.silenceMs + 100,
    );
  });

  it("does NOT fire through mid-sentence pauses shorter than threshold", () => {
    const c = makeClock();
    const d = new SilenceEndpointDetector(undefined, c.now);
    for (let i = 0; i < 20; i++) { c.advance(50); d.feed(800); }
    // user thinks for 600ms mid-sentence
    for (let i = 0; i < 12; i++) { c.advance(50); d.feed(15); }
    // resumes speaking
    for (let i = 0; i < 20; i++) { c.advance(50); d.feed(850); }
    expect(d.hasSpoken).toBe(true);
    // still inside the utterance — no endpoint yet
    const last = d.feed(700);
    expect(last.endpoint).toBe(false);
  });

  it("extends required silence when transcript is semantically incomplete", () => {
    const base = { ...DEFAULT_ENDPOINT_CONFIG };
    const c = makeClock();
    const d = new SilenceEndpointDetector(base, c.now);
    for (let i = 0; i < 20; i++) { c.advance(50); d.feed(800); }
    // silent while text ends with "و" -> needs +500ms more
    let fired = false;
    for (let i = 1; i <= 20; i++) {
      c.advance(50);
      if (d.feed(10, true /* incomplete clause */).endpoint) { fired = true; break; }
    }
    // would have fired at 850 without extension; with +500 must not fire by 1000
    expect(fired).toBe(false);
    // continue to 1400ms of silence -> fires even as semantic continuation
    fired = false;
    for (let i = 0; i < 10 && !fired; i++) {
      c.advance(50);
      fired = d.feed(10, true).endpoint;
    }
    expect(fired).toBe(true);
  });

  it("ignores sub-minimum blips (cough/tap) without ending turn", () => {
    const c = makeClock();
    const d = new SilenceEndpointDetector(undefined, c.now);
    c.advance(100);
    d.feed(1200); // one loud blip opens gate...
    c.advance(300);
    const dec = d.feed(5); // ...but silence arrives before minUtteranceMs
    expect(dec.endpoint).toBe(false);
  });

  it("force-fires at max utterance length even with continuous sound", () => {
    const c = makeClock();
    const d = new SilenceEndpointDetector(undefined, c.now);
    let fired = false;
    for (let i = 0; i < 1300 && !fired; i++) {
      c.advance(50); // 65s of continuous noise
      fired = d.feed(950).endpoint;
    }
    expect(fired).toBe(true);
  });

  it("reset() returns to pre-speech state", () => {
    const c = makeClock();
    const d = new SilenceEndpointDetector(undefined, c.now);
    c.advance(10);
    d.feed(900);
    d.reset();
    expect(d.hasSpoken).toBe(false);
    c.advance(5000);
    expect(d.feed(3).endpoint).toBe(false);
  });
});

describe("isLikelyIncomplete", () => {
  it("flags Arabic conjunction/preposition tails", () => {
    expect(isLikelyIncomplete("أريد أن أعرف أكثر عن")).toBe(true);
    expect(isLikelyIncomplete("الرياضيات و")).toBe(true);
    expect(isLikelyIncomplete("لنفترض أن")).toBe(true);
  });
  it("flags dangling punctuation", () => {
    expect(isLikelyIncomplete("أولًا:")).toBe(true);
    expect(isLikelyIncomplete("مثل،")).toBe(true);
  });
  it("treats finished clauses as complete", () => {
    expect(isLikelyIncomplete("اشرح لي نظرية فيثاغورس")).toBe(false);
    expect(isLikelyIncomplete("what is integral of x squared")).toBe(false);
  });
  it("flags English continuation tails too", () => {
    expect(isLikelyIncomplete("explain the theory of")).toBe(true);
    expect(isLikelyIncomplete("and then")).toBe(true);
  });
});