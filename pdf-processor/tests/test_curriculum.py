"""Tests for the Curriculum Layer with a synthetic Arabic-style tawjihi book:
unit → lessons → topics, lesson/unit question sections, end-of-book glossary."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.curriculum import build_curriculum
from app.extraction import detect_script
from app.layout import analyze_book
from app.models import BBox, PageExtraction, TextBlock


PAGE_W, PAGE_H = 612, 792


def _blk(text, y, size=12.0, bold=False, x0=72, x1=540, role_hint=None):
    return TextBlock(
        text=text,
        bbox=BBox(x0=x0, y0=y, x1=x1, y1=y + size + 4),
        font_size=size,
        font_name="Arial",
        is_bold=bold,
        is_italic=False,
        script=detect_script(text),  # mirror what extraction assigns
    )


def _page(num, blocks, script="ar"):
    return PageExtraction(
        page_number=num,
        width=PAGE_W,
        height=PAGE_H,
        text_blocks=blocks,
        images=[],
        approximate_columns=1,
        font_size_histogram={f"{b.font_size:.1f}": 1 for b in blocks},
        dominant_script=script,
        background_color="#FFFFFF",
        vector_clusters=[],
        content_element_count=len(blocks),
    )


def build_tawjihi_book():
    pages = []

    # p1 — cover
    pages.append(_page(1, [_blk("كتاب الأحياء — التوجيهي", 200, size=28)]))

    # p2 — TOC (dotted lines)
    pages.append(_page(2, [
        _blk("الفهرس", 80, size=20, bold=True),
        _blk("الوحدة الأولى: الخلية ............ 3", 120),
        _blk("الدرس الأول: تركيب الخلية ............ 4", 140),
        _blk("الدرس الثاني: الانقسام الخلوي ............ 6", 160),
    ]))

    # p3 — unit opener
    pages.append(_page(3, [_blk("الوحدة الأولى: الخلية", 100, size=24, bold=True, x0=150, x1=460)]))

    # p4 — lesson 1 + topics
    pages.append(_page(4, [
        _blk("الدرس الأول: تركيب الخلية", 80, size=20, bold=True, x0=150, x1=460),
        _blk("المجهر الضوئي", 160, size=15, bold=True),
        _blk("يستخدم المجهر الضوئي لفحص الخلايا النباتية ودراسة مكوناتها الدقيقة بدقة عالية جداً.", 200),
        _blk("الغشاء البلازمي", 320, size=15, bold=True),
        _blk("يحيط الغشاء البلازمي بالخلية وينظم مرور المواد بين الداخل والخارج.", 360),
    ]))

    # p5 — lesson 1 questions
    pages.append(_page(5, [
        _blk("أسئلة الدرس", 80, size=16, bold=True, x0=230, x1=380),
        _blk("1. عرّف الخلية.", 140),
        _blk("2. عدّد مكونات الخلية النباتية.", 180),
        _blk("3. ما وظيفة الغشاء البلازمي في تنظيم", 220),
        _blk("مرور المواد بين الخلية وبيئتها؟", 250),
    ]))

    # p6 — lesson 2 + body
    pages.append(_page(6, [
        _blk("الدرس الثاني: الانقسام الخلوي", 80, size=20, bold=True, x0=150, x1=460),
        _blk("الانقسام المتساووي", 160, size=15, bold=True),
        _blk("ينقسم فيه الغشاء البلازمي والسيتوبلازم وتتوزع الكروموسومات بالتساوي بين الخليتين.", 200),
    ]))

    # p7 — unit questions
    pages.append(_page(7, [
        _blk("أسئلة الوحدة", 80, size=16, bold=True, x0=230, x1=380),
        _blk("1. قارن بين الانقسام المتساوي والمختزل.", 140),
        _blk("2. وضّح أهمية الانقسام الخلوي في الكائنات الحية.", 180),
    ]))

    # p8 — glossary
    pages.append(_page(8, [
        _blk("مصطلحات الكتاب", 80, size=16, bold=True, x0=230, x1=380),
        _blk("الخلية: الوحدة البنائية والوظيفية للكائن الحي.", 140),
        _blk("الغشاء البلازمي: غشاء يحيط بالخلية وينظم تبادل المواد.", 180),
        _blk("الانقسام الخلوي: عملية تنقسم بها الخلية الأم إلى خليتين بنتين.", 220),
    ]))

    return pages


def run():
    extractions = build_tawjihi_book()
    page_models, lang = analyze_book(extractions)
    assert lang == "ar", f"expected ar, got {lang}"

    result = build_curriculum(page_models)
    root = result.root

    # ── tree shape ──
    units = [c for c in root.children if c.level == "unit"]
    assert len(units) == 1, f"expected 1 unit, got {[c.title for c in root.children]}"
    unit = units[0]
    assert unit.title.startswith("الوحدة الأولى"), unit.title
    assert unit.page_start == 3, f"unit start {unit.page_start}"
    assert unit.page_end == 7, f"unit end {unit.page_end}"  # before glossary p8

    lessons = [c for c in unit.children if c.level == "lesson"]
    assert len(lessons) == 2, f"expected 2 lessons, got {[c.title for c in unit.children]}"
    l1, l2 = lessons
    assert l1.title.startswith("الدرس الأول"), l1.title
    assert l1.page_start == 4 and l1.page_end == 5, f"l1 range {l1.page_start}-{l1.page_end}"
    assert l2.title.startswith("الدرس الثاني"), l2.title
    assert l2.page_start == 6 and l2.page_end == 7, f"l2 range {l2.page_start}-{l2.page_end}"

    l1_topics = [c for c in l1.children if c.level == "topic"]
    assert len(l1_topics) == 2, f"expected 2 topics in lesson 1, got {[c.title for c in l1.children]}"
    assert any("المجهر" in t.title for t in l1_topics)
    assert any("الغشاء" in t.title for t in l1_topics)

    # TOC page (p2) must NOT create duplicate sections
    all_titles = [n.title for n, _p in _flatten(root)]
    assert sum(1 for t in all_titles if "الوحدة الأولى" in t) == 1, all_titles

    # ── questions ──
    qs = result.questions
    lesson_qs = [q for q in qs if q.question_type == "lesson_questions"]
    unit_qs = [q for q in qs if q.question_type == "unit_questions"]
    assert len(lesson_qs) == 3, f"expected 3 lesson questions, got {len(lesson_qs)}: {[q.text[:20] for q in lesson_qs]}"
    assert len(unit_qs) == 2, f"expected 2 unit questions, got {len(unit_qs)}"
    assert lesson_qs[0].number == "1" and "عرّف" in lesson_qs[0].text
    # multi-line question continuation merged
    merged = [q for q in lesson_qs if "الغشاء البلازمي" in q.text and "بيئتها" in q.text]
    assert merged, "question continuation lines were not merged"
    # section attribution
    assert "الدرس الأول" in lesson_qs[0].section_path, lesson_qs[0].section_path
    assert "الوحدة الأولى" in unit_qs[0].section_path, unit_qs[0].section_path

    # ── glossary ──
    gl = result.glossary
    assert len(gl) == 3, f"expected 3 glossary entries, got {len(gl)}: {[(g.term, g.definition[:20]) for g in gl]}"
    assert gl[0].term == "الخلية" and "الوحدة البنائية" in gl[0].definition
    assert gl[2].term == "الانقسام الخلوي"

    print("PASS: curriculum tree (unit → lessons → topics + ranges)")
    print("PASS: TOC page excluded from sections")
    print("PASS: lesson/unit questions extracted with attribution + continuation merge")
    print("PASS: glossary term/definition pairs parsed")
    print("ALL CURRICULUM TESTS PASSED")


def _flatten(node, path=None, out=None):
    out = out if out is not None else []
    out.append((node, path or []))
    for c in node.children:
        _flatten(c, (path or []) + [node.title], out)
    return out


if __name__ == "__main__":
    run()
