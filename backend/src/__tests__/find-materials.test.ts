import { describe, it, expect } from "vitest";
import {
  normalizeMaterialText,
  rankMaterialMatches,
  dedupeMaterialMatches,
  matchMaterialOpenRequest,
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

describe("matchMaterialOpenRequest", () => {
  it("matches Arabic noun-first opens and strips articles", () => {
    expect(matchMaterialOpenRequest("افتح مادة الفيزياء")).toEqual({ query: "فيزياء" });
    expect(matchMaterialOpenRequest("وريني كتاب الكيمياء")).toEqual({ query: "كيمياء" });
    expect(matchMaterialOpenRequest("بدي المادة الفيزياء.")).toEqual({ query: "فيزياء" });
  });

  it("matches the بدي/اريد verb family (the user's exact phrasing)", () => {
    expect(matchMaterialOpenRequest("بدي مادة الفيزياء")).toEqual({ query: "فيزياء" });
    expect(matchMaterialOpenRequest("أريد الكيمياء pdf")).toEqual({ query: "كيمياء" });
  });

  it("handles «افتح لي مادة X» with the standalone لي", () => {
    expect(matchMaterialOpenRequest("افتح لي مادة الرياضيات")).toEqual({ query: "رياضيات" });
  });

  it("matches Arabic suffix form «افتح الفيزياء pdf»", () => {
    expect(matchMaterialOpenRequest("افتح الفيزياء pdf")).toEqual({ query: "فيزياء" });
  });

  it("list requests return an empty query", () => {
    expect(matchMaterialOpenRequest("شو موادي")).toEqual({ query: "" });
    expect(matchMaterialOpenRequest("show my materials")).toEqual({ query: "" });
  });

  it("matches natural English suffix order", () => {
    expect(matchMaterialOpenRequest("open the physics book")).toEqual({ query: "physics" });
    expect(matchMaterialOpenRequest("show me my math textbook!")).toEqual({ query: "math" });
  });

  it("rejects non-imperative messages even when they mention materials", () => {
    // study questions must reach the LLM, not open a file
    expect(matchMaterialOpenRequest("شو هي المادة السوداء في الكيمياء العضوية؟")).toBeNull();
    expect(matchMaterialOpenRequest("بدي مادة الكيمياء شرح درس الاحتراق بالتفصيل الممل")).toBeNull();
    expect(matchMaterialOpenRequest("ممكن تساعدني بالواجب")).toBeNull();
    // thread-summoner territory
    expect(matchMaterialOpenRequest("افتح الشات السابق")).toBeNull();
  });

  it("long captured queries are safe — a no-match lookup falls through to the LLM", () => {
    const r = matchMaterialOpenRequest("بدي مادة الكيمياء شرح درس الاحتراق");
    expect(r === null || (r?.query.includes("كيمياء") ?? false)).toBe(true);
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
