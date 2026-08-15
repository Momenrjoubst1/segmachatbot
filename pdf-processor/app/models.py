from __future__ import annotations

from pydantic import BaseModel, Field


class BBox(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float


class TextBlock(BaseModel):
    text: str
    bbox: BBox
    font_size: float
    font_name: str
    is_bold: bool
    is_italic: bool


class ExtractedImage(BaseModel):
    index: int
    bbox: BBox
    width: int
    height: int
    base64: str


class PageExtraction(BaseModel):
    page_number: int
    width: float
    height: float
    text_blocks: list[TextBlock]
    images: list[ExtractedImage]
    approximate_columns: int
    font_size_histogram: dict[str, int]


class PageClassification(BaseModel):
    page_number: int
    page_type: str = Field(
        pattern="^(cover|blank|text_only|mixed|figure_only|table_heavy|toc|index)$"
    )


class ProcessedPage(BaseModel):
    extraction: PageExtraction
    classification: PageClassification


class StructureNode(BaseModel):
    level: str
    title: str
    page_start: int
    page_end: int
    children: list[StructureNode] = []


class FigurePair(BaseModel):
    figure_id: str
    page_number: int
    caption: str
    image_url: str = ""  # URL after upload to storage
    image_base64: str = ""  # Base64 for upload (optional)
    bounding_box: dict[str, float]


class TextChunk(BaseModel):
    page_number: int
    structure_path: str
    content: str


class ProcessResult(BaseModel):
    total_pages: int
    pages: list[ProcessedPage]
    structure_tree: StructureNode
    figures: list[FigurePair]
    chunks: list[TextChunk]
