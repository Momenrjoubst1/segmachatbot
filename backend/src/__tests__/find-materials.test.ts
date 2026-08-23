import { describe, it, expect } from "vitest";
import {
  normalizeMaterialText,
  rankMaterialMatches,
  dedupeMaterialMatches,
  type MaterialMatch,
} from "../tools/education/find-materials/match-materials.js";
import { buildMaterialCardMarkdown, MATERIAL_LINK_PREFIX } from "../tools/education/find-materials/material-card.js";

function row(overrides: Partial<MaterialMatch> = {}): MaterialMatch {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    fileName: "الفيزياء.pdf",
    courseName: null,
    status: "completed",
    totalPages: 120,
    sizeBytes: 1024,
    createdAt: "2026-01-01T00:00:00Z",
    fileUrl: "r2://textbooks/u/1/source.pdf",
    ...overrides,
  };
}

describe("normalizeMaterialText", () => {
  it("unifies alef/ya/teh-marbuta forms", () => {
    expect(normalizeMaterialText("أَلْفِيزْيَا")).toBe(normalizeMaterialText("الفيزيا"));
    expect(normalizeMaterialText("إحيا")).toBe(normalizeMaterialText("أحيا"));
    expect(normalizeMaterialText("رياضة")).toBe(normalizeMaterialText("رياضه"));
  });

  it("lowercases and strips punctuation", () => {
    expect(normalizeMaterialText("Physics.PDF!")).toBe("physics pdf");
  });

  it("handles empty input", () => {
    expect(normalizeMaterialText("")).toBe("");
  });
});

describe("rankMaterialMatches", () => {
  it("ranks exact name matches above substring matches", () => {
    const rows = [
      row({ id: "b", fileName: "ملخص الفيزياء العامة.pdf" }),
      row({ id: "a", fileName: "الفيزياء.pdf" }),
    ];
    const ranked = rankMaterialMatches(rows, "الفيزياء");
    expect(ranked[0].match.id).toBe("a");
    expect(ranked[0].reason).toBe("name_exact");
    expect(ranked.length).toBe(2);
  });

  it("matches through diacritics and alef variants", () => {
    const ranked = rankMaterialMatches([row({ fileName: "أحياء.pdf" })], "احياء");
    expect(ranked).toHaveLength(1);
    expect(ranked[0].reason).toBe("name_exact");
  });

  it("matches by course name when the file name does not match", () => {
    const rows = [row({ fileName: "كتاب_الفصل_الثاني.pdf", courseName: "الكيمياء" })];
    const ranked = rankMaterialMatches(rows, "كيمياء");
    expect(ranked).toHaveLength(1);
    expect(ranked[0].reason).toBe("course_match");
  });

  it("drops non-matching rows", () => {
    const ranked = rankMaterialMatches([row({ fileName: "التاريخ.pdf" })], "الرياضيات");
    expect(ranked).toHaveLength(0);
  });

  it("empty query keeps recency order (score 0)", () => {
    const rows = [row({ id: "newest" }), row({ id: "older" })];
    const ranked = rankMaterialMatches(rows, "");
    expect(ranked.map((r) => r.match.id)).toEqual(["newest", "older"]);
  });

  it("boosts completed over processing duplicates", () => {
    const rows = [
      row({ id: "processing", fileName: "الرياضيات.pdf", status: "processing" }),
      row({ id: "done", fileName: "الرياضيات.pdf", status: "completed" }),
    ];
    const ranked = rankMaterialMatches(rows, "الرياضيات");
    expect(ranked[0].match.id).toBe("done");
  });
});

describe("dedupeMaterialMatches", () => {
  it("keeps the best-ranked entry per normalized file name", () => {
    const rows = [
      row({ id: "p1", fileName: "الفيزياء.pdf", status: "processing" }),
      row({ id: "p2", fileName: "الفيزياء  PDF", status: "completed" }),
      row({ id: "p3", fileName: "الكيمياء.pdf" }),
    ];
    const deduped = dedupeMaterialMatches(rankMaterialMatches(rows, "فيزياء"));
    // only the physics pair collapses; chemistry didn't match the query
    expect(deduped).toHaveLength(1);
    expect(deduped[0].match.id).toBe("p2");
  });
});

describe("buildMaterialCardMarkdown", () => {
  it("emits a material:// markdown link with encoded params", () => {
    const md = buildMaterialCardMarkdown(
      row({ id: "abc-123", fileName: "الفيزياء.pdf", courseName: "العلوم", totalPages: 42, status: "completed" })
    );
    expect(md).toContain(`](${MATERIAL_LINK_PREFIX}abc-123?`);
    expect(md).toContain("name=");
    expect(md).toContain("course=");
    expect(md).toContain("pages=42");
    expect(md).toContain("status=completed");
  });

  it("strips characters that would break the markdown link", () => {
    const md = buildMaterialCardMarkdown(row({ fileName: "weird [book] (v2).pdf" }));
    expect(md.startsWith("[📄 weird book v2.pdf]")).toBe(true);
  });
});
