"""Tests for app.structure.build_structure_tree."""

from __future__ import annotations

from app.models import BBox, PageExtraction, TextBlock
from app.structure import build_structure_tree


def make_block(text: str, font_size: float) -> TextBlock:
    return TextBlock(
        text=text,
        bbox=BBox(x0=50, y0=50, x1=500, y1=80),
        font_size=font_size,
        font_name="Arial",
        is_bold=font_size > 12,
        is_italic=False,
    )


def make_page(page_number: int, blocks: list[TextBlock]) -> PageExtraction:
    return PageExtraction(
        page_number=page_number,
        width=612,
        height=792,
        text_blocks=blocks,
        images=[],
        approximate_columns=1,
        font_size_histogram={},
    )


def test_empty_pages_returns_bare_root():
    root = build_structure_tree([])
    assert root.level == "root"
    assert root.page_start == 1
    assert root.page_end == 1
    assert root.children == []


def test_single_heading_becomes_chapter():
    root = build_structure_tree([make_page(1, [make_block("Chapter 1", 20)])])
    assert len(root.children) == 1
    child = root.children[0]
    assert child.level == "chapter"
    assert child.title == "Chapter 1"
    assert (child.page_start, child.page_end) == (1, 1)


def test_hierarchical_nesting_and_page_ranges():
    pages = [
        make_page(1, [make_block("Chapter 1", 20)]),
        make_page(2, [make_block("Section 1.1", 16)]),
        make_page(3, [make_block("Subsection 1.1.1", 14)]),
    ]
    root = build_structure_tree(pages)
    assert len(root.children) == 1
    chapter = root.children[0]
    assert chapter.level == "chapter"
    assert len(chapter.children) == 1
    section = chapter.children[0]
    assert section.level == "section"
    assert len(section.children) == 1
    assert section.children[0].level == "subsection"
    # Parent page ranges collapse onto the span of their heading children,
    # cascading post-order down to the deepest descendants first.
    assert (chapter.page_start, chapter.page_end) == (3, 3)
    assert (section.page_start, section.page_end) == (3, 3)


def test_blocks_beyond_top_three_sizes_are_content():
    # Only the three largest distinct font sizes are structural; anything
    # smaller is treated as content and excluded from the tree. Structural
    # blocks nest by rank: chapter > section > subsection.
    sizes = [24, 20, 16, 12]
    page = make_page(1, [make_block(f"text-{s}", s) for s in sizes])
    root = build_structure_tree([page])
    assert [c.title for c in root.children] == ["text-24"]
    assert [c.title for c in root.children[0].children] == ["text-20"]
    assert [c.title for c in root.children[0].children[0].children] == ["text-16"]


def test_sibling_chapters_after_nesting():
    pages = [
        make_page(1, [make_block("Chapter 1", 20), make_block("Section 1.1", 16)]),
        make_page(2, [make_block("Chapter 2", 20)]),
    ]
    root = build_structure_tree(pages)
    assert [c.title for c in root.children] == ["Chapter 1", "Chapter 2"]
    assert [c.title for c in root.children[0].children] == ["Section 1.1"]
    assert root.page_end == 2
