from __future__ import annotations

import re

from .models import PageClassification, PageExtraction

BLANK_CHAR_THRESHOLD = 50
COVER_FONT_SIZE_THRESHOLD = 20.0
TOC_KEYWORDS = {
    "table of contents", "contents", "فهرس", "chapter", "section",
}
INDEX_KEYWORDS = {"index", "الفهرس", "author index", "subject index", "glossary", "فهرس المؤلفين", "فهرس المواضيع"}
TOC_LINE_PATTERN = re.compile(r"\.{2,}\s*\d+")


def _is_index_page(extraction: PageExtraction) -> bool:
    """Check if page is an alphabetical index listing."""
    text_lower = " ".join(b.text.lower() for b in extraction.text_blocks)

    has_index_keyword = any(kw in text_lower for kw in INDEX_KEYWORDS)
    if not has_index_keyword:
        return False

    if len(extraction.text_blocks) < 5:
        return False

    lines_with_page_num = 0
    for block in extraction.text_blocks:
        if re.search(r"\w+\s*\.{2,}\s*\d+", block.text):
            lines_with_page_num += 1

    return lines_with_page_num >= len(extraction.text_blocks) * 0.3


def classify_page(extraction: PageExtraction, is_first_page: bool) -> PageClassification:
    total_chars = sum(len(b.text) for b in extraction.text_blocks)
    total_images = len(extraction.images)
    page_area = extraction.width * extraction.height

    image_area = 0.0
    for img in extraction.images:
        iw = img.bbox.x1 - img.bbox.x0
        ih = img.bbox.y1 - img.bbox.y0
        image_area += iw * ih
    image_ratio = image_area / page_area if page_area > 0 else 0.0

    # Cover precedes the blank check: a first page carrying a large title is
    # a cover even when the title is shorter than BLANK_CHAR_THRESHOLD.
    if is_first_page:
        max_font = max((b.font_size for b in extraction.text_blocks), default=0)
        if max_font >= COVER_FONT_SIZE_THRESHOLD:
            return PageClassification(page_number=extraction.page_number, page_type="cover")

    # Blank only when there is neither text nor imagery — pages dominated by
    # figures fall through to the figure/table checks below.
    if total_chars < BLANK_CHAR_THRESHOLD and total_images == 0:
        return PageClassification(page_number=extraction.page_number, page_type="blank")

    text_lower = " ".join(b.text.lower() for b in extraction.text_blocks)

    # Index detection first: it requires an index-specific keyword, so it can
    # never swallow generic TOC pages — but Arabic indexes ("فهرس المؤلفين")
    # would otherwise be caught earlier by the "فهرس" TOC keyword substring.
    if _is_index_page(extraction):
        return PageClassification(page_number=extraction.page_number, page_type="index")

    # TOC detection (keyword-driven)
    for kw in TOC_KEYWORDS:
        if kw in text_lower:
            return PageClassification(page_number=extraction.page_number, page_type="toc")

    toc_like_lines = 0
    for block in extraction.text_blocks:
        if TOC_LINE_PATTERN.search(block.text):
            toc_like_lines += 1
    if toc_like_lines >= 3:
        return PageClassification(page_number=extraction.page_number, page_type="toc")

    if image_ratio > 0.60 and total_chars < 200:
        return PageClassification(page_number=extraction.page_number, page_type="figure_only")

    if total_images >= 3 and total_chars < 500:
        return PageClassification(page_number=extraction.page_number, page_type="table_heavy")

    if total_images > 0 and total_chars > 200:
        return PageClassification(page_number=extraction.page_number, page_type="mixed")

    return PageClassification(page_number=extraction.page_number, page_type="text_only")
