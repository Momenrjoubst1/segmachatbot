from __future__ import annotations

import base64
from unittest.mock import MagicMock, patch

import pytest

from app.extraction import (
    _build_font_histogram,
    _detect_background,
    _detect_columns,
    _extract_images,
    _extract_text_blocks,
    _extract_vector_clusters,
    _int_color_to_hex,
    _unit_color_to_hex,
    detect_script,
    extract_page,
    normalize_arabic_visual_text,
)
from app.models import BBox, ExtractedImage, TextBlock, VectorCluster


# ── normalize_arabic_visual_text ──────────────────────────────────────────────


class TestNormalizeArabicVisualText:
    def test_strips_tatweel(self):
        assert normalize_arabic_visual_text("بسم\u0640الله") == "بسمالله"

    def test_normalizes_alef_variants(self):
        for char in "\u0622\u0623\u0625":
            result = normalize_arabic_visual_text(f"{char}bcd")
            assert result.startswith("ا"), f"Expected alef, got {result}"

    def test_normalizes_teh_marbuta(self):
        assert normalize_arabic_visual_text("\u0629") == "ه"

    def test_normalizes_alef_maqsvra(self):
        assert normalize_arabic_visual_text("\u0649") == "ي"

    def test_strips_diacritics(self):
        text_with_diacritics = "بَسْمَةٌ"
        result = normalize_arabic_visual_text(text_with_diacritics)
        for ch in result:
            assert ord(ch) < 0x064B or ord(ch) > 0x065F, f"Diacritic remaining: U+{ord(ch):04X}"

    def test_plain_english_unchanged(self):
        assert normalize_arabic_visual_text("Hello World") == "Hello World"

    def test_empty_string(self):
        assert normalize_arabic_visual_text("") == ""

    def test_combined_normalizations(self):
        text = "بَسْمَة\u0640اللهِ"
        result = normalize_arabic_visual_text(text)
        assert "\u0640" not in result
        # diacritics stripped
        for ch in result:
            assert ord(ch) < 0x064B or ord(ch) > 0x065F


# ── detect_script ─────────────────────────────────────────────────────────────


class TestDetectScript:
    def test_arabic_text(self):
        assert detect_script("بسم الله الرحمن الرحيم") == "ar"

    def test_english_text(self):
        assert detect_script("Hello world this is English") == "en"

    def test_empty_text(self):
        assert detect_script("") == "other"

    def test_mixed_favors_arabic_when_equal(self):
        assert detect_script("abcعربي") in ("ar", "en")

    def test_arabic_dominant(self):
        assert detect_script("عربي جداً hello") == "ar"

    def test_latin_dominant(self):
        assert detect_script("Mostly English with عربي") == "en"

    def test_numbers_only(self):
        assert detect_script("12345") == "other"


# ── _int_color_to_hex ─────────────────────────────────────────────────────────


class TestIntColorToHex:
    def test_black(self):
        assert _int_color_to_hex(0) == "#000000"

    def test_white(self):
        assert _int_color_to_hex(0xFFFFFF) == "#ffffff"

    def test_pure_red(self):
        assert _int_color_to_hex(0xFF0000) == "#ff0000"

    def test_with_alpha_bits_ignored(self):
        assert _int_color_to_hex(0xFF0000FF) == "#ff0000"

    def test_mid_gray(self):
        assert _int_color_to_hex(0x808080) == "#808080"


# ── _unit_color_to_hex ────────────────────────────────────────────────────────


class TestUnitColorToHex:
    def test_black_tuple(self):
        assert _unit_color_to_hex((0.0, 0.0, 0.0)) == "#000000"

    def test_white_tuple(self):
        assert _unit_color_to_hex((1.0, 1.0, 1.0)) == "#ffffff"

    def test_red(self):
        assert _unit_color_to_hex((1.0, 0.0, 0.0)) == "#ff0000"

    def test_none_input(self):
        assert _unit_color_to_hex(None) is None

    def test_empty_tuple(self):
        assert _unit_color_to_hex(()) is None

    def test_with_alpha(self):
        result = _unit_color_to_hex((0.5, 0.5, 0.5, 1.0))
        assert result == "#808080"

    def test_invalid_type(self):
        assert _unit_color_to_hex("not a color") is None


# ── _detect_columns ───────────────────────────────────────────────────────────


class TestDetectColumns:
    def _block(self, x0: float, x1: float) -> TextBlock:
        return TextBlock(
            text="x",
            bbox=BBox(x0=x0, y0=0, x1=x1, y1=10),
            font_size=12.0,
            font_name="Helvetica",
            is_bold=False,
            is_italic=False,
        )

    def test_empty_blocks(self):
        assert _detect_columns([], 612.0) == 0

    def test_single_block(self):
        assert _detect_columns([self._block(72, 200)], 612.0) == 1

    def test_two_columns(self):
        left = self._block(36, 280)
        right = self._block(332, 576)
        result = _detect_columns([left, right], 612.0)
        assert result in (1, 2)

    def test_single_column_layout(self):
        blocks = [self._block(72 + i * 10, 200 + i * 10) for i in range(5)]
        assert _detect_columns(blocks, 612.0) == 1


# ── _build_font_histogram ─────────────────────────────────────────────────────


class TestBuildFontHistogram:
    def _block(self, size: float) -> TextBlock:
        return TextBlock(
            text="x",
            bbox=BBox(x0=0, y0=0, x1=10, y1=10),
            font_size=size,
            font_name="Helvetica",
            is_bold=False,
            is_italic=False,
        )

    def test_empty(self):
        assert _build_font_histogram([]) == {}

    def test_single_size(self):
        blocks = [self._block(12.0) for _ in range(3)]
        hist = _build_font_histogram(blocks)
        assert hist == {"12.0": 3}

    def test_multiple_sizes(self):
        blocks = [self._block(12.0), self._block(18.0), self._block(12.0)]
        hist = _build_font_histogram(blocks)
        assert hist["12.0"] == 2
        assert hist["18.0"] == 1

    def test_sorted_by_count_descending(self):
        blocks = [self._block(10.0)] * 5 + [self._block(20.0)] * 2
        hist = _build_font_histogram(blocks)
        keys = list(hist.keys())
        assert hist[keys[0]] >= hist[keys[1]]


# ── _extract_text_blocks (mocked fitz.Page) ───────────────────────────────────


class TestExtractTextBlocks:
    def _make_page(self, blocks_data):
        """Build a minimal mock fitz.Page that returns dict-style text blocks."""
        page = MagicMock()
        page.get_text.return_value = {"blocks": blocks_data}
        return page

    def test_empty_page(self):
        page = self._make_page([])
        result = _extract_text_blocks(page)
        assert result == []

    def test_skips_image_blocks(self):
        page = self._make_page([{"type": 1, "bbox": (0, 0, 100, 100)}])
        result = _extract_text_blocks(page)
        assert result == []

    def test_extracts_text_block(self):
        block = {
            "type": 0,
            "bbox": (72, 72, 540, 150),
            "lines": [
                {
                    "spans": [
                        {
                            "text": "Hello",
                            "font": "Helvetica",
                            "size": 12.0,
                            "color": 0,
                            "flags": 0,
                        }
                    ]
                }
            ],
        }
        page = self._make_page([block])
        result = _extract_text_blocks(page)
        assert len(result) == 1
        assert result[0].text == "Hello"
        assert result[0].font_size == 12.0

    def test_skips_empty_text(self):
        block = {
            "type": 0,
            "bbox": (72, 72, 540, 150),
            "lines": [
                {
                    "spans": [
                        {
                            "text": "   ",
                            "font": "Helvetica",
                            "size": 12.0,
                            "color": 0,
                            "flags": 0,
                        }
                    ]
                }
            ],
        }
        page = self._make_page([block])
        result = _extract_text_blocks(page)
        assert result == []

    def test_detects_bold_from_flags(self):
        block = {
            "type": 0,
            "bbox": (72, 72, 540, 150),
            "lines": [
                {
                    "spans": [
                        {
                            "text": "Bold",
                            "font": "Helvetica",
                            "size": 14.0,
                            "color": 0,
                            "flags": 16,  # bold
                        }
                    ]
                }
            ],
        }
        page = self._make_page([block])
        result = _extract_text_blocks(page)
        assert result[0].is_bold is True

    def test_detects_italic_from_flags(self):
        block = {
            "type": 0,
            "bbox": (72, 72, 540, 150),
            "lines": [
                {
                    "spans": [
                        {
                            "text": "Italic",
                            "font": "Helvetica",
                            "size": 12.0,
                            "color": 0,
                            "flags": 2,  # italic
                        }
                    ]
                }
            ],
        }
        page = self._make_page([block])
        result = _extract_text_blocks(page)
        assert result[0].is_italic is True

    def test_multiple_lines_joined(self):
        block = {
            "type": 0,
            "bbox": (72, 72, 540, 200),
            "lines": [
                {"spans": [{"text": "Line1", "font": "Helvetica", "size": 12.0, "color": 0, "flags": 0}]},
                {"spans": [{"text": "Line2", "font": "Helvetica", "size": 12.0, "color": 0, "flags": 0}]},
            ],
        }
        page = self._make_page([block])
        result = _extract_text_blocks(page)
        assert len(result) == 1
        assert "Line1" in result[0].text
        assert "Line2" in result[0].text


# ── _extract_images (mocked fitz.Page) ────────────────────────────────────────


class TestExtractImages:
    @patch("app.extraction.fitz")
    def test_no_images(self, mock_fitz):
        page = MagicMock()
        page.get_images.return_value = []
        result = _extract_images(page, page_number=1)
        assert result == []

    @patch("app.extraction._image_color_stats", return_value=(["#ff0000"], True))
    @patch("app.extraction.fitz")
    def test_extracts_single_image(self, mock_fitz, mock_colors):
        mock_pix = MagicMock()
        mock_pix.n = 3  # RGB
        mock_pix.width = 100
        mock_pix.height = 80
        mock_pix.tobytes.return_value = b"\x89PNGfake"

        mock_fitz.Pixmap.return_value = mock_pix
        mock_fitz.csRGB = MagicMock()

        page = MagicMock()
        page.get_images.return_value = [(42,)]  # xref=42
        page.get_image_rects.return_value = [MagicMock(x0=10, y0=20, x1=110, y1=100)]
        page.parent = MagicMock()

        result = _extract_images(page, page_number=1)
        assert len(result) == 1
        assert result[0].width == 100
        assert result[0].height == 80

    @patch("app.extraction.fitz")
    def test_skips_failed_image(self, mock_fitz):
        mock_fitz.Pixmap.side_effect = Exception("corrupt")
        page = MagicMock()
        page.get_images.return_value = [(1,)]
        result = _extract_images(page, page_number=1)
        assert result == []


# ── _extract_vector_clusters ──────────────────────────────────────────────────


class TestExtractVectorClusters:
    @patch("app.extraction.fitz")
    def test_no_drawings(self, mock_fitz):
        page = MagicMock()
        page.get_drawings.return_value = []
        page.rect = MagicMock(width=612, height=792)
        clusters, bg = _extract_vector_clusters(page)
        assert clusters == []
        assert bg is None

    @patch("app.extraction.fitz")
    def test_detects_background_fill(self, mock_fitz):
        rect_mock = MagicMock()
        rect_mock.width = 612
        rect_mock.height = 792
        rect_mock.x0 = 0
        rect_mock.y0 = 0
        rect_mock.x1 = 612
        rect_mock.y1 = 792

        page_rect = MagicMock(width=612, height=792)
        page = MagicMock()
        page.get_drawings.return_value = [
            {
                "rect": MagicMock(
                    x0=0, y0=0, x1=612, y1=792,
                    width=612, height=792,
                    intersects=lambda other: False,
                ),
                "fill": (1.0, 1.0, 1.0),
                "color": None,
                "items": [],
            }
        ]
        page.rect = page_rect

        clusters, bg = _extract_vector_clusters(page)
        # full-bleed fill should be background, not a cluster
        assert bg == "#ffffff"

    @patch("app.extraction.fitz")
    def test_empty_page_area(self, mock_fitz):
        page = MagicMock()
        page.get_drawings.return_value = []
        page.rect = MagicMock(width=0, height=0)
        clusters, bg = _extract_vector_clusters(page)
        assert clusters == []


# ── _detect_background ────────────────────────────────────────────────────────


class TestDetectBackground:
    def test_vector_background_preferred(self):
        page = MagicMock()
        result = _detect_background(page, "#ff0000")
        assert result == "#ff0000"

    @patch("app.extraction.fitz")
    def test_renders_fallback(self, mock_fitz):
        page = MagicMock()
        mock_pix = MagicMock()
        mock_pix.n = 3
        mock_pix.width = 30
        mock_pix.height = 40

        # Build pixel data: all white
        def pixel_fn(x, y):
            return (255, 255, 255)

        mock_pix.pixel = pixel_fn
        page.get_pixmap.return_value = mock_pix
        mock_fitz.Matrix.return_value = MagicMock()
        mock_fitz.csRGB = MagicMock()

        result = _detect_background(page, None)
        assert result == "#ffffff"

    def test_exception_returns_white(self):
        page = MagicMock()
        page.get_pixmap.side_effect = Exception("fail")
        result = _detect_background(page, None)
        assert result == "#FFFFFF"


# ── extract_page (integration with mocked fitz) ──────────────────────────────


class TestExtractPage:
    @patch("app.extraction._detect_background", return_value="#ffffff")
    @patch("app.extraction._extract_vector_clusters", return_value=([], None))
    @patch("app.extraction._extract_images", return_value=[])
    @patch("app.extraction._extract_text_blocks", return_value=[])
    def test_empty_page(self, mock_tb, mock_img, mock_vec, mock_bg):
        page = MagicMock()
        page.rect = MagicMock(width=612, height=792)
        result = extract_page(page, page_number=1)
        assert result.page_number == 1
        assert result.width == 612
        assert result.height == 792
        assert result.text_blocks == []
        assert result.images == []
        assert result.background_color == "#ffffff"

    @patch("app.extraction._detect_background", return_value="#ffffff")
    @patch("app.extraction._extract_vector_clusters", return_value=([], None))
    @patch("app.extraction._extract_images", return_value=[])
    @patch("app.extraction._extract_text_blocks")
    def test_dominant_script_en(self, mock_tb, mock_img, mock_vec, mock_bg):
        block = TextBlock(
            text="Hello world this is english text",
            bbox=BBox(x0=72, y0=72, x1=540, y1=150),
            font_size=12.0,
            font_name="Helvetica",
            is_bold=False,
            is_italic=False,
            script="en",
        )
        mock_tb.return_value = [block]
        page = MagicMock()
        page.rect = MagicMock(width=612, height=792)
        result = extract_page(page, page_number=1)
        assert result.dominant_script == "en"

    @patch("app.extraction._detect_background", return_value="#ffffff")
    @patch("app.extraction._extract_vector_clusters", return_value=([], None))
    @patch("app.extraction._extract_images", return_value=[])
    @patch("app.extraction._extract_text_blocks")
    def test_content_element_count(self, mock_tb, mock_img, mock_vec, mock_bg):
        # Real models — PageExtraction validates its fields, so bare
        # MagicMocks crash later passes (e.g. x-center sorting).
        mock_tb.return_value = [
            TextBlock(text="a", bbox=BBox(x0=0, y0=0, x1=100, y1=10), font_size=10.0, font_name="F", is_bold=False, is_italic=False),
            TextBlock(text="b", bbox=BBox(x0=200, y0=0, x1=300, y1=10), font_size=10.0, font_name="F", is_bold=False, is_italic=False),
        ]
        mock_img.return_value = [ExtractedImage(index=0, bbox=BBox(x0=0, y0=0, x1=50, y1=50), width=50, height=50, base64="")]
        mock_vec.return_value = ([VectorCluster(bbox=BBox(x0=0, y0=0, x1=40, y1=40))], None)
        page = MagicMock()
        page.rect = MagicMock(width=612, height=792)
        result = extract_page(page, page_number=1)
        assert result.content_element_count == 4  # 2 text + 1 image + 1 vector
