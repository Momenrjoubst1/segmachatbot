from __future__ import annotations

import base64
import logging

import fitz

from .models import BBox, ExtractedImage, PageExtraction, TextBlock

logger = logging.getLogger("pdf-processor")


def _detect_columns(text_blocks: list[TextBlock], page_width: float) -> int:
    if not text_blocks:
        return 0

    x_centers: list[float] = []
    for block in text_blocks:
        cx = (block.bbox.x0 + block.bbox.x1) / 2.0
        x_centers.append(cx)

    if len(x_centers) < 2:
        return 1

    x_centers.sort()
    gaps: list[float] = []
    for i in range(1, len(x_centers)):
        gaps.append(x_centers[i] - x_centers[i - 1])

    median_gap = sorted(gaps)[len(gaps) // 2]
    large_gaps = [g for g in gaps if g > page_width * 0.25]

    if len(large_gaps) >= 1 and median_gap > page_width * 0.15:
        return 2
    return 1


def _build_font_histogram(text_blocks: list[TextBlock]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for block in text_blocks:
        key = f"{block.font_size:.1f}"
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def extract_page(page: fitz.Page, page_number: int) -> PageExtraction:
    rect = page.rect

    text_blocks: list[TextBlock] = []
    blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]

    for block in blocks:
        if block["type"] != 0:
            continue

        lines_text: list[str] = []
        best_font_size = 0.0
        best_font_name = ""
        is_bold = False
        is_italic = False
        bbox_vals = [block["bbox"][0], block["bbox"][1], block["bbox"][2], block["bbox"][3]]

        for line in block["lines"]:
            line_text = ""
            for span in line["spans"]:
                line_text += span["text"]
                if span["size"] > best_font_size:
                    best_font_size = span["size"]
                    best_font_name = span["font"]
                    is_bold = "bold" in span["font"].lower()
                    is_italic = "italic" in span["font"].lower()
            lines_text.append(line_text)

        combined_text = " ".join(lines_text).strip()
        if not combined_text:
            continue

        text_blocks.append(
            TextBlock(
                text=combined_text,
                bbox=BBox(x0=bbox_vals[0], y0=bbox_vals[1], x1=bbox_vals[2], y1=bbox_vals[3]),
                font_size=round(best_font_size, 1),
                font_name=best_font_name,
                is_bold=is_bold,
                is_italic=is_italic,
            )
        )

    images: list[ExtractedImage] = []
    image_list = page.get_images(full=True)

    for img_idx, img_info in enumerate(image_list):
        xref = img_info[0]
        try:
            pix = fitz.Pixmap(page.parent, xref)
            if pix.n > 4:
                pix = fitz.Pixmap(fitz.csRGB, pix)

            img_bytes = pix.tobytes("png")
            b64 = base64.b64encode(img_bytes).decode("ascii")

            img_rects = page.get_image_rects(xref)
            if img_rects:
                r = img_rects[0]
                bbox = BBox(x0=r.x0, y0=r.y0, x1=r.x1, y1=r.y1)
            else:
                bbox = BBox(x0=0, y0=0, x1=pix.width, y1=pix.height)

            images.append(
                ExtractedImage(
                    index=img_idx,
                    bbox=bbox,
                    width=pix.width,
                    height=pix.height,
                    base64=b64,
                )
            )
        except Exception as e:
            logger.warning("Failed to extract image %d on page %d: %s", img_idx, page_number, e)
            continue

    columns = _detect_columns(text_blocks, rect.width)
    histogram = _build_font_histogram(text_blocks)

    return PageExtraction(
        page_number=page_number,
        width=rect.width,
        height=rect.height,
        text_blocks=text_blocks,
        images=images,
        approximate_columns=columns,
        font_size_histogram=histogram,
    )
