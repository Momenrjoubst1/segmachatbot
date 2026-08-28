from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.classification import (
    BLANK_CHAR_THRESHOLD,
    COVER_FONT_SIZE_THRESHOLD,
    TOC_KEYWORDS,
    _is_index_page,
    classify_page,
)
from app.models import BBox, ExtractedImage, PageClassification, PageExtraction, TextBlock


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_extraction(
    text_blocks=None,
    images=None,
    width: float = 612.0,
    height: float = 792.0,
    page_number: int = 1,
) -> PageExtraction:
    return PageExtraction(
        page_number=page_number,
        width=width,
        height=height,
        text_blocks=text_blocks or [],
        images=images or [],
        approximate_columns=1,
        font_size_histogram={},
    )


def _make_block(
    text: str,
    font_size: float = 12.0,
    x0: float = 72,
    y0: float = 72,
    x1: float = 540,
    y1: float = 100,
) -> TextBlock:
    return TextBlock(
        text=text,
        bbox=BBox(x0=x0, y0=y0, x1=x1, y1=y1),
        font_size=font_size,
        font_name="Helvetica",
        is_bold=False,
        is_italic=False,
    )


def _make_image(
    x0: float = 100,
    y0: float = 300,
    x1: float = 500,
    y1: float = 500,
) -> ExtractedImage:
    return ExtractedImage(
        index=0,
        bbox=BBox(x0=x0, y0=y0, x1=x1, y1=y1),
        width=400,
        height=200,
        base64="dGVzdA==",
    )


# ── classify_page ─────────────────────────────────────────────────────────────


class TestClassifyPage:
    def test_blank_page(self):
        ext = _make_extraction(
            text_blocks=[_make_block("x" * 10)],
            page_number=1,
        )
        result = classify_page(ext, is_first_page=False)
        assert result.page_type == "blank"

    def test_cover_page_first_page_large_font(self):
        ext = _make_extraction(
            text_blocks=[_make_block("Biology", font_size=28.0)],
            page_number=1,
        )
        result = classify_page(ext, is_first_page=True)
        assert result.page_type == "cover"

    def test_cover_not_on_non_first_page(self):
        ext = _make_extraction(
            text_blocks=[_make_block("Biology", font_size=28.0)],
            page_number=5,
        )
        result = classify_page(ext, is_first_page=False)
        # Not blank because total_chars >= threshold, not first page so not cover
        assert result.page_type != "cover"

    def test_cover_requires_first_page(self):
        ext = _make_extraction(
            text_blocks=[_make_block("Biology", font_size=28.0)],
            page_number=1,
        )
        result = classify_page(ext, is_first_page=False)
        assert result.page_type != "cover"

    def test_toc_by_keyword(self):
        ext = _make_extraction(
            text_blocks=[
                _make_block("Table of Contents"),
                _make_block("Chapter 1 .............. 3"),
                _make_block("Chapter 2 .............. 7"),
            ],
            page_number=2,
        )
        result = classify_page(ext, is_first_page=False)
        assert result.page_type == "toc"

    def test_toc_by_pattern(self):
        blocks = [
            _make_block(f"Section {i} .................... {i * 10}")
            for i in range(4)
        ]
        ext = _make_extraction(text_blocks=blocks, page_number=2)
        result = classify_page(ext, is_first_page=False)
        assert result.page_type == "toc"

    def test_index_page(self):
        blocks = [_make_block("Index")]
        for letter in "ABCDEFGHIJKLM":
            blocks.append(_make_block(f"{letter}uthor .................. {ord(letter) - 64}"))
        ext = _make_extraction(text_blocks=blocks, page_number=50)
        result = classify_page(ext, is_first_page=False)
        assert result.page_type == "index"

    def test_figure_only_page(self):
        # High image ratio (> 0.60), low text
        big_image = _make_image(x0=0, y0=0, x1=500, y1=600)
        ext = _make_extraction(
            text_blocks=[_make_block("Fig. 1")],
            images=[big_image],
            page_number=5,
        )
        result = classify_page(ext, is_first_page=False)
        assert result.page_type == "figure_only"

    def test_table_heavy_page(self):
        images = [_make_image() for _ in range(3)]
        ext = _make_extraction(
            text_blocks=[_make_block("data values and numbers " * 10)],
            images=images,
            page_number=5,
        )
        result = classify_page(ext, is_first_page=False)
        assert result.page_type == "table_heavy"

    def test_mixed_page(self):
        ext = _make_extraction(
            text_blocks=[_make_block("Some text content " * 20)],
            images=[_make_image()],
            page_number=5,
        )
        result = classify_page(ext, is_first_page=False)
        assert result.page_type == "mixed"

    def test_text_only_page(self):
        ext = _make_extraction(
            text_blocks=[
                _make_block("Paragraph one " * 15),
                _make_block("Paragraph two " * 15),
            ],
            page_number=3,
        )
        result = classify_page(ext, is_first_page=False)
        assert result.page_type == "text_only"

    def test_page_number_set_correctly(self):
        ext = _make_extraction(
            text_blocks=[_make_block("x" * 10)],
            page_number=42,
        )
        result = classify_page(ext, is_first_page=False)
        assert result.page_number == 42


# ── _is_index_page ────────────────────────────────────────────────────────────


class TestIsIndexPage:
    def test_empty_blocks(self):
        ext = _make_extraction(text_blocks=[])
        assert _is_index_page(ext) is False

    def test_no_index_keyword(self):
        ext = _make_extraction(
            text_blocks=[_make_block("Just regular text")] * 5,
        )
        assert _is_index_page(ext) is False

    def test_too_few_blocks(self):
        ext = _make_extraction(
            text_blocks=[_make_block("Author index")],
        )
        assert _is_index_page(ext) is False

    def test_real_index_page(self):
        blocks = [_make_block("Author Index")]
        for letter in "ABCDEFGHIJ":
            blocks.append(_make_block(f"{letter}uthor topic .................. {ord(letter) - 64}"))
        ext = _make_extraction(text_blocks=blocks)
        assert _is_index_page(ext) is True

    def test_index_keyword_without_dot_leader_pattern(self):
        blocks = [_make_block("Index")] * 6
        ext = _make_extraction(text_blocks=blocks)
        # Has keyword and >=5 blocks but no dot-leader lines
        assert _is_index_page(ext) is False
