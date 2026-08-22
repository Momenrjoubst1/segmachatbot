"""
PDF Processor Constants - Shared with backend config
All magic numbers centralized here with env var overrides
"""

import os

# ==========================================
# Chunking Constants
# ==========================================
MAX_CHUNK_CHARS = int(os.environ.get("MAX_CHUNK_CHARS", "1000"))
OVERLAP_CHARS = int(os.environ.get("OVERLAP_CHARS", "100"))
VERTICAL_GAP_THRESHOLD = float(os.environ.get("VERTICAL_GAP_THRESHOLD", "20.0"))
FONT_SIZE_TOLERANCE = float(os.environ.get("FONT_SIZE_TOLERANCE", "1.5"))

# ==========================================
# PDF Processing Limits
# ==========================================
MAX_PDF_PAGES = int(os.environ.get("MAX_PDF_PAGES", "800"))
MAX_PDF_BYTES = 500 * 1024 * 1024  # 500 MB

# ==========================================
# Progress & Timeouts
# ==========================================
PROGRESS_TTL_SECONDS = int(os.environ.get("PROGRESS_TTL_SECONDS", "3600"))
PROGRESS_EVERY_N_PAGES = 5
PDF_PROCESSOR_TIMEOUT = int(os.environ.get("PDF_PROCESSOR_TIMEOUT", "600"))  # seconds
PDF_PROCESSOR_DOWNLOAD_TIMEOUT = int(os.environ.get("PDF_PROCESSOR_DOWNLOAD_TIMEOUT", "120"))  # seconds

# ==========================================
# Layout Analysis
# ==========================================
CAPTION_MAX_DIST = 90.0
HEADER_ZONE = 0.085
FOOTER_ZONE = 0.915
FOOTNOTE_ZONE = 0.88
VECTOR_MIN_AREA = 150.0
VECTOR_CLUSTER_GAP = 6.0
MAX_VECTOR_CLUSTERS = 60
CAPTION_MAX_DIST = 90.0

# ==========================================
# Image / File Limits
# ==========================================
MAX_PROXY_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_CODE_LENGTH = 50_000
MAX_STDIN_LENGTH = 10_000
MAX_OUTPUT_CHARS = 50_000
IMAGE_TOKEN_COST = 85

# ==========================================
# Layout Constants
# ==========================================
HEADER_ZONE = 0.085
FOOTER_ZONE = 0.915
FOOTNOTE_ZONE = 0.88
CAPTION_MAX_DIST = 90.0
TOC_KEYWORDS = {"table of contents", "contents", "فهرس", "المحتويات", "المحتويات"}
INDEX_KEYWORDS = {
    "index", "الفهرس", "مسرد", "المصطلحات", "glossary",
    "author index", "subject index", "فهرس المؤلفين", "فهرس المواضيع",
}
TOC_LINE_PATTERN = r"\.{2,}\s*\d+"
PAGE_NUM_PATTERN = r"^[\s\-–—|]*\d{1,4}[\s\-–—|]*$"
CAPTION_KEYWORDS = {
    "figure", "fig.", "fig", "table", "chart", "diagram", "image", "photo", "map",
    "شكل", "جدول", "رسم", "مخطط", "صورة", "خريطة", "بيان",
}

# ==========================================
# Layout Constants (from layout.py)
# ==========================================
VERTICAL_GAP_THRESHOLD = 20.0
FONT_SIZE_TOLERANCE = 1.5
HEADER_ZONE = 0.085
FOOTER_ZONE = 0.915
FOOTNOTE_ZONE = 0.88
CAPTION_MAX_DIST = 90.0