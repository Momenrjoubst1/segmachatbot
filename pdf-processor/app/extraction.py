from __future__ import annotations

import base64
import logging
import re
import unicodedata

import fitz

from .models import BBox, ExtractedImage, PageExtraction, TextBlock, VectorCluster
from .constants import (
    ARABIC_PRESENTATION_RE,
    ARABIC_RE,
    LATIN_RE,
    LTR_TOKEN_RE,
)

logger = logging.getLogger("pdf-processor")


# ── Arabic normalization ──────────────────────────────────────────────────

# Tashkeel (diacritics):  U+064B–U+065F + U+0610–U+061A
_ARABIC_DIACRITICS_RE = re.compile(
    "[\u064B-\u065F\u0610-\u061A\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]"
)
_TATWEEL_RE = re.compile("\u0640")
_ALEF_VARIANTS_RE = re.compile("[\u0622\u0623\u0625]")
_TEH_MARBUTA_RE = re.compile("\u0629")
_ALEF_MAQSUR_RE = re.compile("\u0649")


def normalize_arabic_visual_text(text: str) -> str:
    """Strip Arabic diacritics (tashkeel), normalize alef/teh-marbuta/alef-maqsura,
    and remove tatweel.  Mirrors the SQL normalize_arabic() function so the
    text stored in the DB (and fed to embeddings) is consistent."""
    result = _TATWEEL_RE.sub("", text)
    result = _ALEF_VARIANTS_RE.sub("\u0627", result)
    result = _TEH_MARBUTA_RE.sub("\u0647", result)
    result = _ALEF_MAQSUR_RE.sub("\u064A", result)
    result = _ARABIC_DIACRITICS_RE.sub("", result)
    return result


def detect_script(text: str) -> str:
    """Classify the dominant script of a text snippet: ar / en / other."""
    arabic = len(ARABIC_RE.findall(text))
    latin = len(LATIN_RE.findall(text))
    if arabic > 0 and arabic >= latin:
        return "ar"
    if latin > 0:
        return "en"
    return "other"


def _int_color_to_hex(color: int) -> str:
    """PyMuPDF span colors are 32-bit sRGB ints (RRGGBBAA when alpha present)."""
    if color > 0xFFFFFF:
        color >>= 8  # drop the trailing alpha byte
    return f"#{color & 0xFFFFFF:06x}"


def _unit_color_to_hex(color) -> str | None:
    """PyMuPDF drawing colors are (r, g, b) tuples in 0..1 range."""
    if not color:
        return None
    try:
        r, g, b = color[:3]
        return f"#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}"
    except (TypeError, ValueError):
        return None


# ── text ────────────────────────────────────────────────────────────────────

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


def _extract_text_blocks(page: fitz.Page) -> list[TextBlock]:
    blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
    text_blocks: list[TextBlock] = []

    for block in blocks:
        if block["type"] != 0:
            continue

        lines_text: list[str] = []
        # weighted by character count across the whole block
        size_chars: dict[float, int] = {}
        font_for_size: dict[float, str] = {}
        color_chars: dict[str, int] = {}
        script_chars: dict[str, int] = {"ar": 0, "en": 0, "other": 0}
        is_bold = False
        is_italic = False
        bbox_vals = [block["bbox"][0], block["bbox"][1], block["bbox"][2], block["bbox"][3]]

        for line in block["lines"]:
            line_text = ""
            for span in line["spans"]:
                text = span["text"]
                text = normalize_arabic_visual_text(text)
                line_text += text

                size = round(span["size"], 1)
                size_chars[size] = size_chars.get(size, 0) + len(text.strip())
                font_for_size.setdefault(size, span["font"])

                color_hex = _int_color_to_hex(span.get("color", 0))
                color_chars[color_hex] = color_chars.get(color_hex, 0) + len(text.strip())

                script = detect_script(text)
                script_chars[script] = script_chars.get(script, 0) + len(text.strip())

                # flags bitmask: 2 = italic, 16 = bold — more reliable than
                # font names, which lie for embedded/subset fonts
                flags = span.get("flags", 0)
                if flags & 16 or "bold" in span["font"].lower():
                    is_bold = True
                if flags & 2 or "italic" in span["font"].lower() or "oblique" in span["font"].lower():
                    is_italic = True

            lines_text.append(line_text)

        combined_text = " ".join(lines_text).strip()
        if not combined_text:
            continue

        best_font_size = max(size_chars, key=lambda s: size_chars[s]) if size_chars else 0.0
        best_font_name = font_for_size.get(best_font_size, "")
        dominant_color = max(color_chars, key=lambda c: color_chars[c]) if color_chars else "#000000"
        dominant_script = max(script_chars, key=lambda s: script_chars[s]) if script_chars else "en"

        text_blocks.append(
            TextBlock(
                text=combined_text,
                bbox=BBox(x0=bbox_vals[0], y0=bbox_vals[1], x1=bbox_vals[2], y1=bbox_vals[3]),
                font_size=best_font_size,
                font_name=best_font_name,
                is_bold=is_bold,
                is_italic=is_italic,
                color=dominant_color,
                script=dominant_script,
            )
        )

    return text_blocks


# ── images ──────────────────────────────────────────────────────────────────

def _image_color_stats(pix: fitz.Pixmap) -> tuple[list[str], bool]:
    """Top colors by frequency (bucketed for counting, but each bucket is
    represented by its most frequent EXACT color — pure white must come out
    as #ffffff, not a bucket midpoint) + colored flag."""
    try:
        small = fitz.Pixmap(pix)
        while small.width * small.height > 4096:
            small.shrink(1)  # halve each pass
        # bucket -> (count, most-common exact color in the bucket)
        counts: dict[tuple[int, int, int], tuple[int, tuple[int, int, int]]] = {}
        colored_pixels = 0
        total = 0
        for y in range(0, small.height, 2):
            for x in range(0, small.width, 2):
                px = small.pixel(x, y)
                if not px:
                    continue
                if len(px) >= 3:
                    r, g, b = px[0], px[1], px[2]
                else:
                    r = g = b = px[0]
                total += 1
                key = (r >> 4, g >> 4, b >> 4)
                entry = counts.get(key, (0, (r, g, b)))
                counts[key] = (entry[0] + 1, entry[1])
                if max(r, g, b) - min(r, g, b) > 40:
                    colored_pixels += 1
        if total == 0:
            return [], True
        top = sorted(counts, key=lambda k: -counts[k][0])[:3]
        hexes = [
            f"#{counts[k][1][0]:02x}{counts[k][1][1]:02x}{counts[k][1][2]:02x}" for k in top
        ]
        is_colored = colored_pixels / total > 0.02
        return hexes, is_colored
    except Exception as e:
        logger.warning("Image color stats failed: %s", e)
        return [], True


def _extract_images(page: fitz.Page, page_number: int) -> list[ExtractedImage]:
    images: list[ExtractedImage] = []
    image_list = page.get_images(full=True)

    for img_idx, img_info in enumerate(image_list):
        xref = img_info[0]
        try:
            pix = fitz.Pixmap(page.parent, xref)
            if pix.n > 4:
                pix = fitz.Pixmap(fitz.csRGB, pix)

            dominant_colors, is_colored = _image_color_stats(pix)

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
                    dominant_colors=dominant_colors,
                    is_colored=is_colored,
                )
            )
        except Exception as e:
            logger.warning("Failed to extract image %d on page %d: %s", img_idx, page_number, e)
            continue

    return images


# ── vector drawings ─────────────────────────────────────────────────────────

_VECTOR_MIN_AREA = 150.0      # pt² — drop invisible specks
_VECTOR_CLUSTER_GAP = 6.0     # pt — merge paths this close together
_MAX_VECTOR_CLUSTERS = 60


def _extract_vector_clusters(page: fitz.Page) -> tuple[list[VectorCluster], str | None]:
    """Cluster vector paths into figure-like groups; detect a full-page
    background fill. Returns (clusters, background_color_candidate)."""
    try:
        drawings = page.get_drawings()
    except Exception as e:
        logger.warning("get_drawings failed on page: %s", e)
        return [], None

    page_area = page.rect.width * page.rect.height
    if page_area <= 0:
        return [], None

    background: str | None = None
    candidates: list[tuple[fitz.Rect, str | None, str | None, int, float]] = []

    for d in drawings:
        r = d["rect"]
        area = max(0.0, r.width) * max(0.0, r.height)
        fill_hex = _unit_color_to_hex(d.get("fill"))
        stroke_hex = _unit_color_to_hex(d.get("color"))

        if fill_hex and area > 0.88 * page_area:
            # full-bleed fill — treat as the page background, not a figure
            if background is None:
                background = fill_hex
            continue

        if area < _VECTOR_MIN_AREA and not stroke_hex:
            continue
        if area < 1.0 and stroke_hex:
            continue

        candidates.append((fitz.Rect(r), fill_hex, stroke_hex, len(d.get("items", [])), area))

    # cluster: big rects first, absorb overlapping/nearby rects
    candidates.sort(key=lambda t: -t[4])
    clusters: list[dict] = []
    for r, fill_hex, stroke_hex, items, _area in candidates:
        grown = fitz.Rect(r.x0 - _VECTOR_CLUSTER_GAP, r.y0 - _VECTOR_CLUSTER_GAP,
                          r.x1 + _VECTOR_CLUSTER_GAP, r.y1 + _VECTOR_CLUSTER_GAP)
        placed = False
        for c in clusters:
            if c["rect"].intersects(grown):
                c["rect"] |= r
                if fill_hex and fill_hex not in c["fills"]:
                    c["fills"].append(fill_hex)
                if stroke_hex and stroke_hex not in c["strokes"]:
                    c["strokes"].append(stroke_hex)
                c["items"] += items
                placed = True
                break
        if not placed:
            clusters.append({
                "rect": fitz.Rect(r),
                "fills": [fill_hex] if fill_hex else [],
                "strokes": [stroke_hex] if stroke_hex else [],
                "items": items,
            })

    result: list[VectorCluster] = []
    for c in clusters:
        area_ratio = (c["rect"].width * c["rect"].height) / page_area
        if area_ratio < 0.001:
            continue
        result.append(
            VectorCluster(
                bbox=BBox(x0=c["rect"].x0, y0=c["rect"].y0, x1=c["rect"].x1, y1=c["rect"].y1),
                fill_colors=c["fills"][:6],
                stroke_colors=c["strokes"][:6],
                path_count=c["items"],
                area_ratio=round(area_ratio, 4),
            )
        )
        if len(result) >= _MAX_VECTOR_CLUSTERS:
            break

    return result, background


# ── background ──────────────────────────────────────────────────────────────

def _detect_background(page: fitz.Page, vector_bg: str | None) -> str:
    """Page background color: explicit full-page vector fill wins, otherwise
    the most frequent EXACT color in a tiny render of the page (exact — a
    white page must report #ffffff)."""
    if vector_bg:
        return vector_bg
    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(0.05, 0.05))  # ~30×40 px
        if pix.n > 4:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        counts: dict[tuple[int, int, int], int] = {}
        for y in range(pix.height):
            for x in range(pix.width):
                px = pix.pixel(x, y)
                if not px:
                    continue
                if len(px) >= 3:
                    key = (px[0], px[1], px[2])
                else:
                    key = (px[0], px[0], px[0])
                counts[key] = counts.get(key, 0) + 1
        if not counts:
            return "#FFFFFF"
        top = max(counts, key=lambda k: counts[k])
        return f"#{top[0]:02x}{top[1]:02x}{top[2]:02x}"
    except Exception as e:
        logger.warning("Background detection failed: %s", e)
        return "#FFFFFF"


# ── page entry point ────────────────────────────────────────────────────────

def extract_page(page: fitz.Page, page_number: int) -> PageExtraction:
    rect = page.rect

    text_blocks = _extract_text_blocks(page)
    images = _extract_images(page, page_number)
    vector_clusters, vector_bg = _extract_vector_clusters(page)
    background_color = _detect_background(page, vector_bg)

    # dominant script for the page (by text volume, images don't count)
    script_chars = {"ar": 0, "en": 0, "other": 0}
    for b in text_blocks:
        script_chars[b.script] = script_chars.get(b.script, 0) + len(b.text.strip())
    positive = {k: v for k, v in script_chars.items() if v > 0}
    if not positive:
        dominant_script = "en"  # no text — script is irrelevant, default en
    else:
        dominant_script = max(positive, key=lambda s: positive[s])
        # a meaningful mix (≥25% each) counts as mixed
        total = sum(positive.values())
        if len(positive) >= 2:
            top2 = sorted(positive.values(), reverse=True)
            if top2[1] / total >= 0.25:
                dominant_script = "mixed"

    columns = _detect_columns(text_blocks, rect.width)
    histogram = _build_font_histogram(text_blocks)
    content_element_count = len(text_blocks) + len(images) + len(vector_clusters)

    return PageExtraction(
        page_number=page_number,
        width=rect.width,
        height=rect.height,
        text_blocks=text_blocks,
        images=images,
        approximate_columns=columns,
        font_size_histogram=histogram,
        background_color=background_color,
        vector_clusters=vector_clusters,
        dominant_script=dominant_script,
        content_element_count=content_element_count,
    )
