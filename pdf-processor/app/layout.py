"""Stage 2 — Layout understanding.

Turns raw per-page extractions into the page "digital twin":
  - cross-page repeating header/footer + page-number detection
  - semantic roles: title / heading / body / caption / page_number /
    header / footer / footnote
  - column-aware reading order (RTL for Arabic-dominant pages, LTR otherwise)
  - upgraded page classification (true blank = zero content elements)
  - page roles: cover_front / interior / cover_back / blank
  - book-level language (ar / en / mixed)
"""
from __future__ import annotations

import re

from .models import (
    BBox,
    ImageSummary,
    PageExtraction,
    PageModel,
    TextBlock,
)

from .constants import (
    HEADER_ZONE,
    FOOTER_ZONE,
    FOOTNOTE_ZONE,
    CAPTION_MAX_DIST,
    VERTICAL_GAP_THRESHOLD,
    FONT_SIZE_TOLERANCE,
    HEADER_ZONE,
    FOOTER_ZONE,
    CAPTION_KEYWORDS,
    PAGE_NUM_PATTERN,
    TOC_KEYWORDS,
    INDEX_KEYWORDS,
    TOC_LINE_PATTERN,
)


def _normalize_zone_text(text: str) -> str:
    """Key for cross-page repetition: lowercase, digits/punctuation stripped."""
    return re.sub(r"\s+", " ", re.sub(r"[^\w\u0600-\u06FF ]+", "", text.lower())).strip()


# ── book-level helpers ──────────────────────────────────────────────────────

def _body_font_size(pages: list[PageExtraction]) -> float:
    """The book's body text size = most common block size, weighted by blocks."""
    counts: dict[float, int] = {}
    for page in pages:
        for key, cnt in page.font_size_histogram.items():
            counts[round(float(key), 1)] = counts.get(round(float(key), 1), 0) + cnt
    if not counts:
        return 11.0
    # smallest of the top-2 frequent sizes is a safer "body" pick than the
    # single most common one (headings repeat boilerplate less, but a book
    # with all-body-text pages can still skew)
    ranked = sorted(counts, key=lambda s: -counts[s])
    if len(ranked) >= 2 and counts[ranked[0]] - counts[ranked[1]] < counts[ranked[0]] * 0.15:
        return min(ranked[0], ranked[1])
    return ranked[0]


def _repeating_zone_texts(pages: list[PageExtraction]) -> tuple[set[str], set[str]]:
    """Normalized texts that repeat in the header/footer zone across pages."""
    header_counts: dict[str, set[int]] = {}
    footer_counts: dict[str, set[int]] = {}
    n_pages = len(pages)
    if n_pages < 4:
        return set(), set()

    for page in pages:
        for b in page.text_blocks:
            key = _normalize_zone_text(b.text)
            if not key or len(key) < 3:
                continue
            if b.bbox.y1 < page.height * HEADER_ZONE:
                header_counts.setdefault(key, set()).add(page.page_number)
            elif b.bbox.y0 > page.height * FOOTER_ZONE:
                footer_counts.setdefault(key, set()).add(page.page_number)

    threshold = max(3, round(n_pages * 0.45))
    headers = {k for k, p in header_counts.items() if len(p) >= threshold}
    footers = {k for k, p in footer_counts.items() if len(p) >= threshold}
    return headers, footers


# ── roles ───────────────────────────────────────────────────────────────────

def _overlaps_horizontally(a: BBox, b: BBox) -> bool:
    return a.x0 < b.x1 and b.x0 < a.x1


def _assign_roles(
    page: PageExtraction,
    body_size: float,
    header_keys: set[str],
    footer_keys: set[str],
) -> list[TextBlock]:
    """Returns the page's blocks with semantic roles assigned."""
    blocks = page.text_blocks
    figure_boxes = [img.bbox for img in page.images] + [vc.bbox for vc in page.vector_clusters]

    for b in blocks:
        zone_key = _normalize_zone_text(b.text)
        in_top = b.bbox.y1 < page.height * HEADER_ZONE
        in_bottom = b.bbox.y0 > page.height * FOOTER_ZONE

        # 1) running header / footer / page number
        if in_top and zone_key in header_keys:
            b.role = "header"
            continue
        if in_bottom and zone_key in footer_keys:
            b.role = "footer"
            continue
        if (in_top or in_bottom) and len(b.text.strip()) <= 8 and PAGE_NUM_PATTERN.match(b.text.strip()):
            b.role = "page_number"
            continue

        # 2) caption: close to a figure + (keyword | smaller than body)
        text_lower = b.text.lower()
        has_caption_keyword = any(kw in text_lower for kw in CAPTION_KEYWORDS)
        near_figure = False
        for fb in figure_boxes:
            v_gap = max(fb.y0 - b.bbox.y1, b.bbox.y0 - fb.y1, 0)
            if v_gap < CAPTION_MAX_DIST and _overlaps_horizontally(b.bbox, fb):
                near_figure = True
                break
        if near_figure and (has_caption_keyword or b.font_size < body_size * 0.98):
            b.role = "caption"
            continue

        # 3) footnote: bottom zone and visibly smaller
        if b.bbox.y0 > page.height * FOOTNOTE_ZONE and b.font_size < body_size * 0.85:
            b.role = "footnote"
            continue

        # 4) headings by typography
        if b.font_size >= body_size * 1.7:
            b.role = "title"
            continue
        if b.font_size >= body_size * 1.25 or (b.is_bold and b.font_size >= body_size * 1.1):
            b.role = "heading"
            continue

        b.role = "body"

    return blocks


# ── reading order ───────────────────────────────────────────────────────────

def _assign_reading_order(page: PageExtraction, blocks: list[TextBlock]) -> list[TextBlock]:
    """Column-aware reading order. Full-width blocks split the page into
    vertical regions; inside each region, columns are read right-to-left for
    Arabic pages and left-to-right otherwise."""
    width = page.width
    rtl = page.dominant_script == "ar"
    two_cols = page.approximate_columns >= 2

    indexed = list(enumerate(blocks))
    full = sorted(
        [(i, b) for i, b in indexed if (b.bbox.x1 - b.bbox.x0) > width * 0.7],
        key=lambda t: t[1].bbox.y0,
    )
    column_blocks = [(i, b) for i, b in indexed if (i, b) not in full]

    def col_rank(b: TextBlock) -> int:
        if not two_cols:
            return 0
        cx = (b.bbox.x0 + b.bbox.x1) / 2
        col = 1 if cx > width / 2 else 0
        return (1 - col) if rtl else col

    ordered: list[tuple[int, TextBlock]] = []
    for region in range(len(full) + 1):
        # band `region` sits ABOVE full[region] (bounded below by it), so its
        # column blocks are read before that full-width block
        region_blocks = sorted(
            [
                (i, b)
                for i, b in column_blocks
                if sum(1 for _f, fb in full if fb.bbox.y1 <= b.bbox.y0) == region
            ],
            key=lambda t: (col_rank(t[1]), t[1].bbox.y0),
        )
        ordered.extend(region_blocks)
        if region < len(full):
            ordered.append(full[region])

    # anything unmatched (shouldn't happen) goes last by y
    matched = {i for i, _ in ordered}
    leftovers = sorted(
        [(i, b) for i, b in indexed if i not in matched], key=lambda t: t[1].bbox.y0
    )
    ordered.extend(leftovers)

    for pos, (_i, b) in enumerate(ordered):
        b.reading_order = pos
    return [b for _, b in ordered]


# ── classification v2 ───────────────────────────────────────────────────────

def _classify_page(
    page: PageExtraction,
    blocks: list[TextBlock],
    body_size: float,
    is_first: bool,
    is_last: bool,
) -> tuple[str, str]:
    """Returns (page_type, page_role)."""
    content = [b for b in blocks if b.role not in ("header", "footer", "page_number")]
    text_chars = sum(len(b.text.strip()) for b in content)
    text_lower = " ".join(b.text.lower() for b in content)

    page_area = page.width * page.height
    image_area = sum(
        (img.bbox.x1 - img.bbox.x0) * (img.bbox.y1 - img.bbox.y0) for img in page.images
    )
    vector_area = sum(
        (vc.bbox.x1 - vc.bbox.x0) * (vc.bbox.y1 - vc.bbox.y0) for vc in page.vector_clusters
    )
    visual_ratio = min(1.0, (image_area + vector_area) / page_area) if page_area else 0.0

    # true blank: no content elements at all (figures included)
    if not content and not page.images and not page.vector_clusters:
        return "blank", "blank"

    # toc / index (keyword + dotted-line patterns, bilingual)
    toc_lines = sum(1 for b in content if TOC_LINE_PATTERN.search(b.text))
    if any(kw in text_lower for kw in TOC_KEYWORDS) or toc_lines >= 3:
        return "toc", "interior"
    if _is_index_page(content, text_lower):
        return "index", "interior"

    # cover: first page carrying a title-size block
    has_title = any(b.font_size >= body_size * 1.6 for b in content)
    if is_first and has_title:
        return "cover", "cover_front"

    if visual_ratio > 0.55 and text_chars < 200:
        page_type = "figure_only"
    elif len(page.vector_clusters) >= 6 and text_chars < 800:
        # many small vector structures = table grid / ruled layout
        page_type = "table_heavy"
    elif (page.images or page.vector_clusters) and text_chars >= 200:
        page_type = "mixed"
    else:
        page_type = "text_only"

    # back cover: a visually-dominated or empty page at the very end
    if is_last and page_type in ("figure_only", "blank"):
        return page_type, "cover_back"

    return page_type, "interior"


def _is_index_page(content: list[TextBlock], text_lower: str) -> bool:
    if not any(kw in text_lower for kw in INDEX_KEYWORDS):
        return False
    if len(content) < 5:
        return False
    lines_with_page_num = sum(
        1 for b in content if re.search(r"\w+\s*\.{2,}\s*\d+", b.text) or re.search(r"\w+\s+\d{1,4}$", b.text.strip())
    )
    return lines_with_page_num >= len(content) * 0.3


# ── book assembly ───────────────────────────────────────────────────────────

def analyze_book(pages: list[PageExtraction]) -> tuple[list[PageModel], str]:
    """Full Stage-2 analysis. Returns (page_models, book_language)."""
    body_size = _body_font_size(pages)
    header_keys, footer_keys = _repeating_zone_texts(pages)

    # book language by text volume
    script_chars = {"ar": 0, "en": 0, "other": 0}
    for page in pages:
        for b in page.text_blocks:
            script_chars[b.script] = script_chars.get(b.script, 0) + len(b.text.strip())
    total_chars = sum(script_chars.values())
    if total_chars == 0:
        book_language = "en"
    else:
        book_language = max(("ar", "en"), key=lambda s: script_chars.get(s, 0))
        if (
            script_chars.get("ar", 0) / total_chars >= 0.25
            and script_chars.get("en", 0) / total_chars >= 0.25
        ):
            book_language = "mixed"

    page_models: list[PageModel] = []
    n = len(pages)
    for idx, page in enumerate(pages):
        blocks = _assign_roles(page, body_size, header_keys, footer_keys)
        blocks = _assign_reading_order(page, blocks)
        page_type, page_role = _classify_page(
            page, blocks, body_size, is_first=(idx == 0), is_last=(idx == n - 1)
        )

        page_models.append(
            PageModel(
                page_number=page.page_number,
                width=page.width,
                height=page.height,
                background_color=page.background_color,
                page_role=page_role,
                page_type=page_type,
                dominant_script=page.dominant_script,
                approximate_columns=page.approximate_columns,
                font_size_histogram=page.font_size_histogram,
                blocks=blocks,
                images=[
                    ImageSummary(
                        index=img.index,
                        bbox=img.bbox,
                        width=img.width,
                        height=img.height,
                        dominant_colors=img.dominant_colors,
                        is_colored=img.is_colored,
                    )
                    for img in page.images
                ],
                vector_clusters=page.vector_clusters,
            )
        )

    return page_models, book_language
