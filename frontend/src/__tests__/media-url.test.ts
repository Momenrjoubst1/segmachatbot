import { describe, expect, it } from "vitest";
import {
  classifyMediaUrl,
  getVimeoId,
  getYouTubeId,
  isBareLink,
  isImageUrl,
} from "@/features/ai-assistant/ui/media-url";

describe("classifyMediaUrl", () => {
  it("classifies direct video file URLs", () => {
    expect(classifyMediaUrl("https://cdn.example.com/clip.mp4")?.kind).toBe("video");
    expect(classifyMediaUrl("https://cdn.example.com/clip.webm?token=1")?.kind).toBe("video");
  });

  it("classifies direct audio file URLs", () => {
    expect(classifyMediaUrl("https://cdn.example.com/podcast.mp3")?.kind).toBe("audio");
    expect(classifyMediaUrl("https://cdn.example.com/voice-note.m4a")?.kind).toBe("audio");
  });

  it("detects YouTube URLs in all common shapes", () => {
    const cases = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    ];
    for (const url of cases) {
      const media = classifyMediaUrl(url);
      expect(media?.kind, url).toBe("youtube");
      expect(media?.embedId, url).toBe("dQw4w9WgXcQ");
    }
  });

  it("detects Vimeo URLs", () => {
    expect(classifyMediaUrl("https://vimeo.com/76979871")).toEqual({
      kind: "vimeo",
      embedId: "76979871",
    });
  });

  it("leaves regular pages and documents unclassified", () => {
    expect(classifyMediaUrl("https://example.com/article")).toBeNull();
    expect(classifyMediaUrl("https://example.com/doc.pdf")).toBeNull();
    expect(classifyMediaUrl(undefined)).toBeNull();
    expect(classifyMediaUrl("not a url at all ???")).toBeNull();
  });
});

describe("getYouTubeId", () => {
  it("returns null for non-YouTube hosts", () => {
    const url = new URL("https://vimeo.com/123456");
    expect(getYouTubeId(url)).toBeNull();
  });

  it("rejects empty ids", () => {
    expect(getYouTubeId(new URL("https://youtu.be/"))).toBeNull();
  });
});

describe("getVimeoId", () => {
  it("parses numeric video paths", () => {
    expect(getVimeoId(new URL("https://player.vimeo.com/video/76979871"))).toBe("76979871");
  });

  it("returns null for other hosts", () => {
    expect(getVimeoId(new URL("https://youtube.com/watch?v=x"))).toBeNull();
  });
});

describe("isBareLink", () => {
  it("treats text equal to the href as a bare link", () => {
    expect(
      isBareLink("https://cdn.example.com/clip.mp4", "https://cdn.example.com/clip.mp4"),
    ).toBe(true);
  });

  it("ignores protocol / www / trailing slash differences", () => {
    expect(isBareLink("example.com/watch/", "https://www.example.com/watch")).toBe(true);
  });

  it("keeps named markdown links as regular links", () => {
    expect(isBareLink("Watch the lecture here", "https://youtube.com/watch?v=abc")).toBe(false);
  });

  it("treats empty link text as bare", () => {
    expect(isBareLink("", "https://example.com/a.wav")).toBe(true);
  });
});

describe("isImageUrl", () => {
  it("recognizes raster extensions", () => {
    expect(isImageUrl("https://x.com/a.png")).toBe(true);
    expect(isImageUrl("https://x.com/a.JPG")).toBe(true);
  });

  it("rejects non-image urls", () => {
    expect(isImageUrl("https://x.com/a.mp4")).toBe(false);
    expect(isImageUrl("https://x.com/page")).toBe(false);
  });
});
