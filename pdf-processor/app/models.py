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
    # ── v2 fields (defaults keep older callers/tests working) ──
    color: str = "#000000"        # dominant text color, hex
    script: str = "en"            # ar | en | other (dominant script of the block)
    role: str = "body"            # semantic role: title|heading|body|caption|page_number|header|footer|footnote
    reading_order: int = -1       # assigned by layout analysis (-1 = unassigned)


class ExtractedImage(BaseModel):
    index: int
    bbox: BBox
    width: int
    height: int
    base64: str
    dominant_colors: list[str] = []   # up to 3 hex colors by pixel frequency
    is_colored: bool = True           # False = grayscale / black-and-white


class ImageSummary(BaseModel):
    """Raster image as stored in the page model (base64 stripped)."""
    index: int
    bbox: BBox
    width: int
    height: int
    dominant_colors: list[str] = []
    is_colored: bool = True


class VectorCluster(BaseModel):
    """A cluster of vector drawing paths treated as one visual figure."""
    bbox: BBox
    fill_colors: list[str] = []
    stroke_colors: list[str] = []
    path_count: int = 0
    area_ratio: float = 0.0  # fraction of the page area covered


class PageExtraction(BaseModel):
    page_number: int
    width: float
    height: float
    text_blocks: list[TextBlock]
    images: list[ExtractedImage]
    approximate_columns: int
    font_size_histogram: dict[str, int]
    # ── v2 fields ──
    background_color: str = "#FFFFFF"
    vector_clusters: list[VectorCluster] = []
    dominant_script: str = "en"   # ar | en | mixed
    content_element_count: int = 0  # text + images + vector clusters (for true blank detection)


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
    # ── v2 layout-aware metadata ──
    block_role: str = "body"
    text_color: str | None = None
    bbox: dict[str, float] | None = None


class PageModel(BaseModel):
    """The stored digital-twin of one page face (Stage 1 + 2 output)."""
    page_number: int
    width: float
    height: float
    background_color: str
    page_role: str = "interior"   # cover_front | interior | cover_back | blank
    page_type: str = "text_only"  # blank|text_only|mixed|figure_only|table_heavy|toc|index|cover
    dominant_script: str = "en"   # ar | en | mixed
    approximate_columns: int = 1
    font_size_histogram: dict[str, int] = {}
    blocks: list[TextBlock] = []
    images: list[ImageSummary] = []
    vector_clusters: list[VectorCluster] = []
    thumbnail_key: str = ""  # R2 key of the rendered page PNG (visual pages only)


# ── Curriculum layer (pedagogical structure) ────────────────────────────────

class CurriculumNode(BaseModel):
    """A node in the book's pedagogical tree: unit → lesson → topic."""
    level: str = "topic"          # unit | lesson | topic | special
    title: str
    page_start: int
    page_end: int
    question_type: str | None = None  # lesson_questions | unit_questions | None
    order_index: int = 0
    children: list["CurriculumNode"] = []


class QuestionItem(BaseModel):
    """One question extracted from a lesson/unit questions section."""
    number: str = ""
    text: str
    page_number: int
    question_type: str = "lesson_questions"  # lesson_questions | unit_questions
    section_path: str = ""                   # "الوحدة الأولى > الدرس الأول"


class GlossaryEntry(BaseModel):
    term: str
    definition: str = ""
    page_number: int


class CurriculumResult(BaseModel):
    root: CurriculumNode
    questions: list[QuestionItem] = []
    glossary: list[GlossaryEntry] = []


class ProcessResult(BaseModel):
    total_pages: int
    page_models: list[PageModel]
    structure_tree: StructureNode
    figures: list[FigurePair]
    chunks: list[TextChunk]
    book_language: str = "en"  # ar | en | mixed
    curriculum: CurriculumResult | None = None
