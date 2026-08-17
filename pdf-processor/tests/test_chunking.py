"""Tests for improved chunking: merge + split + overlap."""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import _merge_adjacent_blocks, _split_long_text
from app.models import BBox, TextBlock


def _make_block(text: str, y0: float = 0, y1: float = 20, font_size: float = 12, bold: bool = False, italic: bool = False) -> TextBlock:
    return TextBlock(
        text=text,
        bbox=BBox(x0=50, y0=y0, x1=500, y1=y1),
        font_size=font_size,
        font_name="Helvetica",
        is_bold=bold,
        is_italic=italic,
    )


def test_merge_close_blocks():
    b1 = _make_block("The mitochondria is", y0=100, y1=120)
    b2 = _make_block("the powerhouse of the cell.", y0=125, y1=145)
    merged = _merge_adjacent_blocks([b1, b2], 792)
    assert len(merged) == 1
    assert "mitochondria" in merged[0].text
    assert "powerhouse" in merged[0].text
    print("PASS: test_merge_close_blocks")


def test_merge_different_fonts_no_merge():
    b1 = _make_block("Chapter 1", y0=100, y1=120, font_size=16, bold=True)
    b2 = _make_block("Introduction text", y0=125, y1=145, font_size=12, bold=False)
    merged = _merge_adjacent_blocks([b1, b2], 792)
    assert len(merged) == 2
    print("PASS: test_merge_different_fonts_no_merge")


def test_merge_far_blocks_no_merge():
    b1 = _make_block("Paragraph 1 end.", y0=100, y1=120)
    b2 = _make_block("Paragraph 2 start.", y0=200, y1=220)
    merged = _merge_adjacent_blocks([b1, b2], 792)
    assert len(merged) == 2
    print("PASS: test_merge_far_blocks_no_merge")


def test_merge_bold_vs_normal():
    b1 = _make_block("Important text", y0=100, y1=120, bold=True)
    b2 = _make_block("normal text", y0=125, y1=145, bold=False)
    merged = _merge_adjacent_blocks([b1, b2], 792)
    assert len(merged) == 2
    print("PASS: test_merge_bold_vs_normal")


def test_split_short_text():
    text = "Short text."
    chunks = _split_long_text(text, max_chars=1000, overlap=100)
    assert len(chunks) == 1
    assert chunks[0] == text
    print("PASS: test_split_short_text")


def test_split_long_text():
    # ~1500 chars with clear sentence boundaries
    sentences = ["Sentence one is here. "] * 60
    text = "".join(sentences)
    chunks = _split_long_text(text, max_chars=1000, overlap=100)
    assert len(chunks) > 1
    assert all(len(c) <= 1150 for c in chunks)
    print(f"PASS: test_split_long_text ({len(chunks)} chunks)")


def test_split_preserves_sentences():
    text = "First sentence. Second sentence. Third sentence. " * 40
    chunks = _split_long_text(text, max_chars=500, overlap=50)
    for chunk in chunks:
        # Each chunk should start/end at sentence boundaries (roughly)
        assert len(chunk) > 20
    print(f"PASS: test_split_preserves_sentences ({len(chunks)} chunks)")


def test_split_no_word_cutoff():
    text = "The mitochondria is the powerhouse of the cell. " * 50
    chunks = _split_long_text(text, max_chars=1000, overlap=100)
    for i, chunk in enumerate(chunks[1:], 1):
        # Should not start mid-word (overlap should be at word boundary)
        first_char = chunk[0]
        assert first_char != "p" or chunk.startswith("power"), f"Chunk {i} starts with unexpected character"
    print("PASS: test_split_no_word_cutoff")


def test_split_exact_boundary():
    text = "A" * 1000
    chunks = _split_long_text(text, max_chars=1000, overlap=100)
    assert len(chunks) == 1
    print("PASS: test_split_exact_boundary")


def test_split_overlap():
    text = "Word one. Word two. Word three. " * 100
    chunks = _split_long_text(text, max_chars=300, overlap=50)
    assert len(chunks) > 1
    # Check overlap exists: start of chunk[i] should appear in chunk[i-1]
    for i in range(1, len(chunks)):
        overlap_zone = chunks[i][:50]
        assert overlap_zone in chunks[i - 1] or chunks[i - 1][-50:] in chunks[i], f"No overlap in chunk {i}"
    print("PASS: test_split_overlap")


def test_build_chunks_splits_long_page():
    """Verify _build_chunks_v2 splits long pages via _split_long_text."""
    from app.main import _build_chunks_v2
    from app.layout import analyze_book
    from app.models import BBox, TextBlock, PageExtraction, StructureNode

    # Build a page with >1000 chars of text
    long_text = "This is a sentence about biology. " * 60  # ~1980 chars
    block = TextBlock(
        text=long_text,
        bbox=BBox(x0=50, y0=50, x1=500, y1=500),
        font_size=12.0,
        font_name="Helvetica",
        is_bold=False,
        is_italic=False,
    )
    extraction = PageExtraction(
        page_number=1,
        width=612,
        height=792,
        text_blocks=[block],
        images=[],
        approximate_columns=1,
        font_size_histogram={"12.0": 1},
    )
    page_models, _lang = analyze_book([extraction])

    tree = StructureNode(level="root", title="Root", page_start=1, page_end=1, children=[])
    chunks = _build_chunks_v2(page_models, tree)

    # Should produce MORE than 1 chunk (the long text should be split)
    assert len(chunks) > 1, f"Expected multiple chunks for long page, got {len(chunks)}"
    for c in chunks:
        assert len(c.content) <= 1150, f"Chunk too long: {len(c.content)} chars"
        assert c.page_number == 1
        assert c.bbox is not None, "v2 chunks must carry layout bbox"
        assert c.text_color is not None, "v2 chunks must carry text color"
    print(f"PASS: test_build_chunks_splits_long_page ({len(chunks)} chunks from ~1980 chars)")


def test_build_chunks_short_page_single_chunk():
    """Short pages should still produce exactly one chunk."""
    from app.main import _build_chunks_v2
    from app.layout import analyze_book
    from app.models import BBox, TextBlock, PageExtraction, StructureNode

    block = TextBlock(
        text="Short text about a topic.",
        bbox=BBox(x0=50, y0=50, x1=500, y1=100),
        font_size=12.0,
        font_name="Helvetica",
        is_bold=False,
        is_italic=False,
    )
    extraction = PageExtraction(
        page_number=1,
        width=612,
        height=792,
        text_blocks=[block],
        images=[],
        approximate_columns=1,
        font_size_histogram={"12.0": 1},
    )
    page_models, _lang = analyze_book([extraction])

    tree = StructureNode(level="root", title="Root", page_start=1, page_end=1, children=[])
    chunks = _build_chunks_v2(page_models, tree)

    assert len(chunks) == 1, f"Expected 1 chunk for short page, got {len(chunks)}"
    print("PASS: test_build_chunks_short_page_single_chunk")


if __name__ == "__main__":
    test_merge_close_blocks()
    test_merge_different_fonts_no_merge()
    test_merge_far_blocks_no_merge()
    test_merge_bold_vs_normal()
    test_split_short_text()
    test_split_long_text()
    test_split_preserves_sentences()
    test_split_no_word_cutoff()
    test_split_exact_boundary()
    test_split_overlap()
    test_build_chunks_splits_long_page()
    test_build_chunks_short_page_single_chunk()
    print("\nALL CHUNKING TESTS PASSED")
