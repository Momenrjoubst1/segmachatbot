"""Tests for v2 layout understanding: colors, scripts, reading order,
vector clusters, true blank pages, semantic roles."""
from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import fitz

from app.extraction import extract_page, detect_script
from app.layout import analyze_book
from app.models import BBox, PageExtraction, TextBlock


# ── unit: script detection ──────────────────────────────────────────────────

def test_detect_script():
    assert detect_script("مرحبا بالعالم") == "ar"
    assert detect_script("Hello world") == "en"
    assert detect_script("123 !؟ …") == "other"
    assert detect_script("mixed نص and text") in ("ar", "en")
    print("PASS: test_detect_script")


# ── unit: column reading order (RTL vs LTR) ────────────────────────────────

def _block(text, x0, y0, x1, y1, size=12.0, bold=False):
    return TextBlock(
        text=text,
        bbox=BBox(x0=x0, y0=y0, x1=x1, y1=y1),
        font_size=size,
        font_name="Helvetica",
        is_bold=bold,
        is_italic=False,
    )


def test_reading_order_rtl_vs_ltr():
    def build(script: str) -> PageExtraction:
        return PageExtraction(
            page_number=1,
            width=612,
            height=792,
            text_blocks=[
                _block("Lesson Title", 50, 40, 560, 70, size=24.0),   # full-width (510pt > 428)
                _block("RIGHT-COL", 320, 100, 560, 130),
                _block("LEFT-COL", 50, 100, 290, 130),
                _block("RIGHT-BODY", 320, 150, 560, 200),
                _block("LEFT-BODY", 50, 150, 290, 200),
            ],
            images=[],
            approximate_columns=2,
            font_size_histogram={"12.0": 4, "24.0": 1},
            dominant_script=script,
        )

    # RTL (Arabic): right column is read before the left one
    models_ar, _ = analyze_book([build("ar")])
    ar_order = [b.text for b in sorted(models_ar[0].blocks, key=lambda b: b.reading_order)]
    assert ar_order[0] == "Lesson Title", f"Title must be first, got {ar_order[0]}"
    assert ar_order[1] == "RIGHT-COL", f"RTL must read right column first, got {ar_order[1]}"
    assert ar_order[2] == "RIGHT-BODY"
    assert ar_order[3] == "LEFT-COL"

    # LTR (English): left column first
    models_en, _ = analyze_book([build("en")])
    en_order = [b.text for b in sorted(models_en[0].blocks, key=lambda b: b.reading_order)]
    assert en_order[1] == "LEFT-COL", f"LTR must read left column first, got {en_order[1]}"
    assert en_order[2] == "LEFT-BODY"
    print("PASS: test_reading_order_rtl_vs_ltr")


# ── PDF-based: colors, vector, blank, roles ─────────────────────────────────

def _make_v2_pdf(path: str) -> None:
    doc = fitz.open()

    # Page 1: colored title + normal body (English)
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 100), "Big Red Chapter Title", fontsize=28, fontname="helv", color=(1, 0, 0))
    page.insert_text((72, 150), "This is regular black body text about biology and cells.", fontsize=12, fontname="helv")

    # Page 2: blue filled vector shape + caption-like text + image-colored content
    page = doc.new_page(width=612, height=792)
    page.draw_rect(fitz.Rect(72, 72, 300, 220), color=None, fill=(0, 0, 1))
    page.insert_text((72, 240), "Figure 1: A blue diagram box", fontsize=10, fontname="helv")

    # Page 3: completely empty
    doc.new_page(width=612, height=792)

    doc.save(path)
    doc.close()


def test_pdf_v2_features():
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        pdf_path = f.name
    try:
        _make_v2_pdf(pdf_path)
        doc = fitz.open(pdf_path)
        extractions = [extract_page(doc[i], i + 1) for i in range(len(doc))]
        doc.close()

        models, book_lang = analyze_book(extractions)
        assert len(models) == 3

        p1, p2, p3 = models

        # Page 1: title color detected as red, role = title
        title = max(p1.blocks, key=lambda b: b.font_size)
        assert title.color.lower() == "#ff0000", f"Expected red title, got {title.color}"
        assert title.role in ("title", "heading"), f"Expected title/heading role, got {title.role}"
        assert p1.page_role == "cover_front", f"First page with big title should be cover_front, got {p1.page_role}"
        assert p1.background_color.lower() == "#ffffff"

        # Page 2: blue vector cluster with fill color
        assert len(p2.vector_clusters) >= 1, "Expected a vector cluster on page 2"
        vc = p2.vector_clusters[0]
        assert "#0000ff" in vc.fill_colors, f"Expected blue fill, got {vc.fill_colors}"
        # the text near the shape + keyword should be a caption
        caption = next((b for b in p2.blocks if "Figure 1" in b.text), None)
        assert caption is not None and caption.role == "caption", \
            f"Expected caption role, got {caption.role if caption else 'no block'}"

        # Page 3: true blank — no blocks, no images, no vectors
        assert p3.page_type == "blank", f"Expected blank page, got {p3.page_type}"
        assert p3.page_role == "blank"
        assert p3.blocks == [] and p3.images == [] and p3.vector_clusters == []

        # Book language
        assert book_lang == "en", f"Expected en book language, got {book_lang}"

        print("PASS: test_pdf_v2_features")
    finally:
        os.unlink(pdf_path)


if __name__ == "__main__":
    test_detect_script()
    test_reading_order_rtl_vs_ltr()
    test_pdf_v2_features()
    print("ALL LAYOUT V2 TESTS PASSED")
