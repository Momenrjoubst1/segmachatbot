import { describe, it, expect } from "vitest";
import {
  MATERIAL_LINK_PREFIX,
  isMaterialHref,
  parseMaterialHref,
} from "@/features/ai-assistant/ui/material-viewer/material-link";

describe("parseMaterialHref", () => {
  it("parses a full material link with Arabic metadata", () => {
    const href =
      MATERIAL_LINK_PREFIX +
      encodeURIComponent("abc-123") +
      "?" +
      new URLSearchParams({
        name: "الفيزياء.pdf",
        course: "العلوم",
        pages: "120",
        status: "completed",
      }).toString();
    const ref = parseMaterialHref(href);
    expect(ref).not.toBeNull();
    expect(ref!.id).toBe("abc-123");
    expect(ref!.name).toBe("الفيزياء.pdf");
    expect(ref!.course).toBe("العلوم");
    expect(ref!.pages).toBe(120);
    expect(ref!.status).toBe("completed");
  });

  it("parses a bare link without params", () => {
    const ref = parseMaterialHref(`${MATERIAL_LINK_PREFIX}a1b2c3d4`);
    expect(ref).toEqual({ id: "a1b2c3d4" });
  });

  it("rejects non-material schemes and garbage ids", () => {
    expect(parseMaterialHref("https://example.com/file.pdf")).toBeNull();
    expect(parseMaterialHref("material://textbook/")).toBeNull();
    expect(parseMaterialHref("material://textbook/../../etc")).toBeNull();
    expect(parseMaterialHref("material://other/abc")).toBeNull();
  });

  it("rejects missing or non-string hrefs", () => {
    expect(parseMaterialHref(null)).toBeNull();
    expect(parseMaterialHref(undefined)).toBeNull();
    expect(parseMaterialHref("")).toBeNull();
  });

  it("ignores invalid page values but keeps the ref usable", () => {
    const href = `${MATERIAL_LINK_PREFIX}abc?pages=notanumber`;
    const ref = parseMaterialHref(href);
    expect(ref!.id).toBe("abc");
    expect(ref!.pages).toBeUndefined();
  });

  it("isMaterialHref mirrors parse success", () => {
    expect(isMaterialHref(`${MATERIAL_LINK_PREFIX}abc?name=x.pdf`)).toBe(true);
    expect(isMaterialHref("https://example.com")).toBe(false);
  });
});
