import { describe, it, expect } from "vitest";
import { mediaAwareFetch } from "../services/chat/media-wire.js";
import {
  runWithMediaRegistry,
  registerMediaPayload,
} from "../services/chat/media-registry.js";

type FetchCapture = { url: string; init?: RequestInit };

function capturingImpl(capture: FetchCapture): typeof fetch {
  return async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    capture.url = String(input);
    capture.init = init;
    return new Response("{}");
  };
}

describe("mediaAwareFetch", () => {
  it("passes bodies without sentinels through untouched", async () => {
    const capture: FetchCapture = {} as FetchCapture;
    const wrapped = mediaAwareFetch(capturingImpl(capture));
    const body = JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] });

    await wrapped("https://provider.example/v1/chat/completions", { method: "POST", body });

    expect(JSON.parse(String(capture.init?.body))).toEqual(
      JSON.parse(body),
    );
  });

  it("rewrites video sentinels into video_url blocks", async () => {
    const capture: FetchCapture = {} as FetchCapture;
    const wrapped = mediaAwareFetch(capturingImpl(capture));

    await runWithMediaRegistry(async () => {
      const sentinel = registerMediaPayload({
        kind: "video",
        mediaType: "video/mp4",
        filename: "lecture.mp4",
        url: "https://r2.example.com/signed/lecture.mp4",
      });
      const body = JSON.stringify({
        messages: [{
          role: "user",
          content: [
            { type: "text", text: `اشرح هالفديو ${sentinel} من فضلك` },
          ],
        }],
      });
      await wrapped("https://provider.example/v1/chat/completions", { method: "POST", body });
    });

    const parsed = JSON.parse(String(capture.init?.body));
    const parts = parsed.messages[0].content;
    // Text before + native block + text after — order preserved.
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ type: "text", text: "اشرح هالفديو" });
    expect(parts[1]).toEqual({
      type: "video_url",
      video_url: { url: "https://r2.example.com/signed/lecture.mp4" },
    });
    expect(parts[2]).toEqual({ type: "text", text: "من فضلك" });
  });

  it("rewrites audio sentinels into input_audio blocks with raw base64", async () => {
    const capture: FetchCapture = {} as FetchCapture;
    const wrapped = mediaAwareFetch(capturingImpl(capture));

    await runWithMediaRegistry(async () => {
      const sentinel = registerMediaPayload({
        kind: "audio",
        mediaType: "audio/mpeg",
        filename: "voice.mp3",
        dataUrl: "data:audio/mpeg;base64,Q3Jvc3NQYXJ0eUJhc2U2NA==",
      });
      const body = JSON.stringify({
        messages: [{ role: "user", content: [{ type: "text", text: sentinel }] }],
      });
      await wrapped("https://provider.example/v1/chat/completions", { method: "POST", body });
    });

    const parsed = JSON.parse(String(capture.init?.body));
    expect(parsed.messages[0].content).toEqual([{
      type: "input_audio",
      input_audio: { data: "Q3Jvc3NQYXJ0eUJhc2U2NA==", format: "mp3" },
    }]);
  });

  it("drops the whole text part when it contained only a known sentinel", async () => {
    const capture: FetchCapture = {} as FetchCapture;
    const wrapped = mediaAwareFetch(capturingImpl(capture));

    await runWithMediaRegistry(async () => {
      const sentinel = registerMediaPayload({
        kind: "video",
        mediaType: "video/mp4",
        filename: "v.mp4",
        dataUrl: "data:video/mp4;base64,AAAA",
      });
      const body = JSON.stringify({
        messages: [{ role: "user", content: [{ type: "text", text: sentinel }] }],
      });
      await wrapped("https://provider.example", { method: "POST", body });
    });

    const parsed = JSON.parse(String(capture.init?.body));
    expect(parsed.messages[0].content).toEqual([{
      type: "video_url",
      video_url: { url: "data:video/mp4;base64,AAAA" },
    }]);
  });

  it("degrades unknown sentinel ids to a note instead of crashing", async () => {
    const capture: FetchCapture = {} as FetchCapture;
    const wrapped = mediaAwareFetch(capturingImpl(capture));

    const body = JSON.stringify({
      messages: [{ role: "user", content: [{ type: "text", text: "⟦MEDIA:not-registered⟧" }] }],
    });
    // No registry bound — wrapper must still send a sane request.
    await wrapped("https://provider.example", { method: "POST", body });

    const parsed = JSON.parse(String(capture.init?.body));
    expect(parsed.messages[0].content[0].text).toContain("[media: unavailable]");
  });

  it("removes stale content-length after rewriting", async () => {
    const capture: FetchCapture = {} as FetchCapture;
    const impl: typeof fetch = async (input, init) => {
      capture.init = init;
      return new Response("{}");
    };
    const wrapped = mediaAwareFetch(impl);

    await runWithMediaRegistry(async () => {
      const sentinel = registerMediaPayload({
        kind: "video", mediaType: "video/webm", filename: "w.webm", url: "https://x/w.webm",
      });
      const headers = new Headers({ "content-type": "application/json", "content-length": "42" });
      await wrapped("https://provider.example", {
        method: "POST",
        headers,
        body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: sentinel }] }] }),
      });
    });

    expect(capture.init?.headers && new Headers(capture.init.headers as HeadersInit).get("content-length")).toBeNull();
  });
});
