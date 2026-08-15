from __future__ import annotations

from .models import ExtractedImage, FigurePair, PageExtraction

CAPTION_KEYWORDS = {"figure", "fig.", "fig", "table", "image", "diagram", "chart", "photo"}
MIN_CAPTION_LENGTH = 10


def pair_figures(pages: list[PageExtraction]) -> list[FigurePair]:
    pairs: list[FigurePair] = []
    fig_counter = 0

    for page in pages:
        if not page.images:
            continue

        caption_blocks = []
        for block in page.text_blocks:
            text_lower = block.text.lower()
            if any(kw in text_lower for kw in CAPTION_KEYWORDS):
                if len(block.text.strip()) >= MIN_CAPTION_LENGTH:
                    caption_blocks.append(block)

        for img in page.images:
            fig_counter += 1
            figure_id = f"fig_{page.page_number}_{img.index}"

            best_caption = _find_nearest_caption(img, caption_blocks, page)

            pairs.append(
                FigurePair(
                    figure_id=figure_id,
                    page_number=page.page_number,
                    caption=best_caption if best_caption else f"Figure on page {page.page_number}",
                    image_base64=img.base64,
                    bounding_box={
                        "x0": img.bbox.x0,
                        "y0": img.bbox.y0,
                        "x1": img.bbox.x1,
                        "y1": img.bbox.y1,
                    },
                )
            )

    return pairs


def _find_nearest_caption(
    img: ExtractedImage, caption_blocks: list, page: PageExtraction
) -> str | None:
    if not caption_blocks:
        return None

    img_cx = (img.bbox.x0 + img.bbox.x1) / 2.0
    img_cy = (img.bbox.y0 + img.bbox.y1) / 2.0

    best_score = float("inf")
    best_text = None

    for block in caption_blocks:
        block_cx = (block.bbox.x0 + block.bbox.x1) / 2.0
        block_cy = (block.bbox.y0 + block.bbox.y1) / 2.0

        vertical_dist = abs(block_cy - img_cy)
        horizontal_dist = abs(block_cx - img_cx)

        score = 0.7 * vertical_dist + 0.3 * horizontal_dist

        if score < best_score:
            best_score = score
            best_text = block.text

    if best_score < page.height * 0.4:
        return best_text
    return None
