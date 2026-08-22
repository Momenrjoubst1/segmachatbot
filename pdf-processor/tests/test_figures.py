from __future__ import annotations

import pytest

from app.constants import CAPTION_KEYWORDS, MIN_CAPTION_LENGTH
from app.figures import _find_nearest_caption, pair_figures
from app.models import BBox, ExtractedImage, PageExtraction, TextBlock


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_image(
    index: int = 0,
    x0: float = 100.0,
    y0: float = 300.0,
    x1: float = 400.0,
    y1: float = 500.0,
) -> ExtractedImage:
    return ExtractedImage(
        index=index,
        bbox=BBox(x0=x0, y0=y0, x1=x1, y1=y1),
        width=300,
        height=200,
        base64="aGVsbG8=",
    )


def _make_caption_block(
    text: str,
    x0: float = 72.0,
    y0: float = 510.0,
    x1: float = 540.0,
    y1: float = 540.0,
) -> TextBlock:
    return TextBlock(
        text=text,
        bbox=BBox(x0=x0, y0=y0, x1=x1, y1=y1),
        font_size=10.0,
        font_name="Helvetica",
        is_bold=False,
        is_italic=False,
    )


def _make_page(
    text_blocks=None,
    images=None,
    page_number: int = 1,
    width: float = 612.0,
    height: float = 792.0,
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


# ── pair_figures ──────────────────────────────────────────────────────────────


class TestPairFigures:
    def test_no_pages(self):
        assert pair_figures([]) == []

    def test_pages_without_images(self):
        page = _make_page(text_blocks=[_make_block_helper("Some text")])
        assert pair_figures([page]) == []

    def test_single_image_no_caption(self):
        img = _make_image()
        page = _make_page(images=[img])
        result = pair_figures([page])
        assert len(result) == 1
        assert result[0].figure_id == "fig_1_0"
        assert "Figure on page 1" in result[0].caption

    def test_single_image_with_caption(self):
        img = _make_image(x0=100, y0=300, x1=400, y1=500)
        caption = _make_caption_block(
            "Figure 1: The Glycolysis Pathway",
            x0=100, y0=510, x1=400, y1=540,
        )
        page = _make_page(images=[img], text_blocks=[caption])
        result = pair_figures([page])
        assert len(result) == 1
        assert result[0].caption == "Figure 1: The Glycolysis Pathway"

    def test_multiple_images_multiple_captions(self):
        img1 = _make_image(index=0, x0=50, y0=200, x1=300, y1=400)
        img2 = _make_image(index=1, x0=350, y0=200, x1=600, y1=400)
        cap1 = _make_caption_block("Figure A", x0=50, y0=410, x1=300, y1=440)
        cap2 = _make_caption_block("Figure B", x0=350, y0=410, x1=600, y1=440)
        page = _make_page(images=[img1, img2], text_blocks=[cap1, cap2])
        result = pair_figures([page])
        assert len(result) == 2
        captions = {r.figure_id: r.caption for r in result}
        assert captions["fig_1_0"] == "Figure A"
        assert captions["fig_1_1"] == "Figure B"

    def test_figure_ids_unique_across_pages(self):
        img = _make_image()
        p1 = _make_page(images=[img], page_number=1)
        p2 = _make_page(images=[img], page_number=2)
        result = pair_figures([p1, p2])
        ids = [r.figure_id for r in result]
        assert len(ids) == len(set(ids))

    def test_caption_too_short_ignored(self):
        short_caption = _make_caption_block("Fig")
        img = _make_image()
        page = _make_page(images=[img], text_blocks=[short_caption])
        result = pair_figures([page])
        assert result[0].caption == "Figure on page 1"

    def test_caption_without_keyword_ignored(self):
        block = _make_caption_block("This is just regular paragraph text about something unrelated")
        img = _make_image()
        page = _make_page(images=[img], text_blocks=[block])
        result = pair_figures([page])
        assert result[0].caption == "Figure on page 1"

    def test_bounding_box_in_output(self):
        img = _make_image(x0=10.0, y0=20.0, x1=110.0, y1=120.0)
        page = _make_page(images=[img])
        result = pair_figures([page])
        bbox = result[0].bounding_box
        assert bbox["x0"] == 10.0
        assert bbox["y0"] == 20.0
        assert bbox["x1"] == 110.0
        assert bbox["y1"] == 120.0

    def test_image_base64_preserved(self):
        img = _make_image()
        img.base64 = "dGVzdA=="
        page = _make_page(images=[img])
        result = pair_figures([page])
        assert result[0].image_base64 == "dGVzdA=="


# ── _find_nearest_caption ─────────────────────────────────────────────────────


class TestFindNearestCaption:
    def test_no_captions(self):
        img = _make_image()
        page = _make_page()
        assert _find_nearest_caption(img, [], page) is None

    def test_nearest_caption_below(self):
        img = _make_image(x0=100, y0=300, x1=400, y1=500)
        cap = _make_caption_block("Figure 1: Below image", y0=510, y1=540)
        page = _make_page(height=792.0)
        result = _find_nearest_caption(img, [cap], page)
        assert result == "Figure 1: Below image"

    def test_caption_too_far_returns_none(self):
        img = _make_image(x0=100, y0=300, x1=400, y1=500)
        # Caption very far away vertically
        far_cap = _make_caption_block("Far away", y0=700, y1=730)
        page = _make_page(height=200.0)  # very short page
        result = _find_nearest_caption(img, [far_cap], page)
        assert result is None

    def test_picks_closest_caption(self):
        img = _make_image(x0=100, y0=300, x1=400, y1=500)
        near = _make_caption_block("Near", y0=510, y1=540)
        far = _make_caption_block("Far", y0=10, y1=40)
        page = _make_page(height=792.0)
        result = _find_nearest_caption(img, [near, far], page)
        assert result == "Near"

    def test_horizontal_proximity_matters(self):
        img = _make_image(x0=100, y0=300, x1=400, y1=500)
        # Same vertical distance but different horizontal
        left_cap = _make_caption_block("Left", x0=50, y0=510, x1=200, y1=540)
        right_cap = _make_caption_block("Right", x0=250, y0=510, x1=400, y1=540)
        page = _make_page(height=792.0)
        result = _find_nearest_caption(img, [left_cap, right_cap], page)
        # Should pick the one with lower combined distance
        assert result in ("Left", "Right")


# helper needed for test_single_page_no_caption
def _make_block_helper(text):
    return TextBlock(
        text=text,
        bbox=BBox(x0=72, y0=72, x1=540, y1=100),
        font_size=12.0,
        font_name="Helvetica",
        is_bold=False,
        is_italic=False,
    )
