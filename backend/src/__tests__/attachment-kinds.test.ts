import { describe, it, expect } from "vitest";
import { detectKind, sniffMatches, KIND_SPECS } from "../services/chat/attachment-kinds.js";

function head(bytes: number[]): Buffer {
  return Buffer.from(bytes);
}

describe("detectKind", () => {
  it("classifies video mimes", () => {
    expect(detectKind("video/mp4", "lecture.mp4")).toBe("video");
    expect(detectKind("video/webm", "clip.webm")).toBe("video");
    expect(detectKind("video/x-msvideo", "old.avi")).toBe("video");
  });

  it("classifies audio mimes", () => {
    expect(detectKind("audio/mpeg", "song.mp3")).toBe("audio");
    expect(detectKind("audio/wav", "voice.wav")).toBe("audio");
    expect(detectKind("audio/x-m4a", "note.m4a")).toBe("audio");
  });

  it("falls back to extension when mime is empty or generic", () => {
    expect(detectKind("", "movie.MOV")).toBe("video");
    expect(detectKind("application/octet-stream", "track.flac")).toBe("audio");
    expect(detectKind("", "report.docx")).toBe("document");
  });

  it("classifies documents including office formats", () => {
    expect(detectKind("application/pdf", "book.pdf")).toBe("document");
    expect(detectKind(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "essay.docx",
    )).toBe("document");
    expect(detectKind("text/csv", "grades.csv")).toBe("document");
  });

  it("classifies text/code separately from documents", () => {
    expect(detectKind("text/plain", "notes.txt")).toBe("text");
    expect(detectKind("application/json", "data.json")).toBe("text");
    expect(detectKind("text/x-python", "main.py")).toBe("text");
  });

  it("rejects unregistered types", () => {
    expect(detectKind("application/zip", "archive.zip")).toBeNull();
    expect(detectKind("application/x-msdownload", "virus.exe")).toBeNull();
    expect(detectKind("", "noext")).toBeNull();
  });

  it("prefers video over audio when both could match (.webm)", () => {
    // .webm without a mime resolves to video (ordered KIND_ORDER)
    expect(detectKind("", "clip.webm")).toBe("video");
    // but an explicit audio/webm mime routes to audio
    expect(detectKind("audio/webm", "clip.webm")).toBe("audio");
  });
});

describe("sniffMatches", () => {
  it("accepts real mp4 bytes (ftyp box)", () => {
    const mp4 = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]; // ....ftypisom
    expect(sniffMatches("video", head(mp4))).toBe(true);
  });

  it("accepts webm EBML header", () => {
    expect(sniffMatches("video", head([0x1a, 0x45, 0xdf, 0xa3]))).toBe(true);
  });

  it("rejects a video claim that is actually text", () => {
    const fake = Buffer.from("Hello world, not a video!", "utf8");
    expect(sniffMatches("video", fake)).toBe(false);
  });

  it("accepts mp3 via ID3 tag and frame sync", () => {
    expect(sniffMatches("audio", Buffer.from("ID3\x04\x00", "latin1"))).toBe(true);
    expect(sniffMatches("audio", head([0xff, 0xfb, 0x90, 0x00]))).toBe(true);
  });

  it("accepts wav and ogg signatures", () => {
    const riff = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WAVE", "latin1")]);
    expect(sniffMatches("audio", riff)).toBe(true);
    expect(sniffMatches("audio", Buffer.from("OggS", "latin1"))).toBe(true);
  });

  it("accepts pdf magic and zip-based office docs", () => {
    expect(sniffMatches("document", Buffer.from("%PDF-1.7", "latin1"))).toBe(true);
    expect(sniffMatches("document", head([0x50, 0x4b, 0x03, 0x04]))).toBe(true); // docx/xlsx zip
    expect(sniffMatches("document", head([0xd0, 0xcf, 0x11, 0xe0]))).toBe(true); // legacy OLE2 doc
  });

  it("text-like kinds have no sniff requirement", () => {
    expect(KIND_SPECS.text.sniff).toBeNull();
    expect(sniffMatches("text", Buffer.from("anything"))).toBe(true);
  });
});
