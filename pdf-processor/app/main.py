from __future__ import annotations

import base64
import os
import re
import tempfile

import boto3
import fitz
from botocore.config import Config
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .classification import classify_page
from .extraction import extract_page
from .figures import pair_figures
from .models import BBox, ProcessResult, ProcessedPage, TextBlock, TextChunk
from .structure import build_structure_tree

app = FastAPI(title="PDF Processor", version="0.3.0")

ALLOWED_DIRS = {tempfile.gettempdir(), "/tmp"}

# Chunking constants
MAX_CHUNK_CHARS = 1000
OVERLAP_CHARS = 100
VERTICAL_GAP_THRESHOLD = 20.0
FONT_SIZE_TOLERANCE = 1.5
SENTENCE_END = re.compile(r"(?<=[.!?؟])\s+")

# Cloudflare R2 config
R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "textbook-images")
R2_PUBLIC_URL = os.environ.get("R2_PUBLIC_URL", "")

# Create R2 client (S3-compatible)
r2_client = None
if R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY:
    r2_client = boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


async def upload_image_to_storage(
    image_base64: str,
    user_id: str,
    textbook_id: str,
    figure_id: str,
) -> str:
    """Upload image to Cloudflare R2 and return public URL."""
    if not r2_client or not R2_BUCKET_NAME:
        return ""

    img_bytes = base64.b64decode(image_base64)
    key = f"textbooks/{user_id}/{textbook_id}/{figure_id}.png"

    try:
        r2_client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=key,
            Body=img_bytes,
            ContentType="image/png",
        )
        # Return public URL
        if R2_PUBLIC_URL:
            return f"{R2_PUBLIC_URL}/{key}"
        return ""
    except Exception as e:
        print(f"Failed to upload to R2: {e}")
        return ""


@app.get("/health")
async def health():
    return {"status": "ok", "pymupdf_version": fitz.version[0]}


class ProcessRequest(BaseModel):
    pdf_path: str
    user_id: str = ""
    textbook_id: str = ""


def _validate_path(pdf_path: str) -> str:
    """Validate and resolve the PDF path to prevent path traversal."""
    resolved = os.path.realpath(pdf_path)
    parent = os.path.dirname(resolved)
    if parent not in ALLOWED_DIRS and not any(
        resolved.startswith(d + os.sep) for d in ALLOWED_DIRS
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid path: only temporary files in /tmp are allowed",
        )
    if not resolved.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    return resolved


def _resolve_structure_path(tree, page_number: int | None = None) -> str:
    """Walk the tree to find the deepest ancestor covering this page."""
    path_parts: list[str] = []
    node = tree
    while node.children:
        child = None
        for c in node.children:
            if c.page_start <= page_number <= c.page_end:
                child = c
                break
        if child is None:
            break
        path_parts.append(child.title)
        node = child
    return " > ".join(path_parts) if path_parts else ""


def _merge_adjacent_blocks(
    blocks: list[TextBlock], page_height: float
) -> list[TextBlock]:
    """Merge text blocks that are vertically close with similar font properties."""
    if not blocks:
        return []

    sorted_blocks = sorted(blocks, key=lambda b: (b.bbox.y0, b.bbox.x0))
    merged: list[TextBlock] = [sorted_blocks[0]]

    for block in sorted_blocks[1:]:
        prev = merged[-1]
        gap = block.bbox.y0 - prev.bbox.y1

        if (
            gap < VERTICAL_GAP_THRESHOLD
            and abs(block.font_size - prev.font_size) < FONT_SIZE_TOLERANCE
            and block.is_bold == prev.is_bold
            and block.is_italic == prev.is_italic
        ):
            merged[-1] = TextBlock(
                text=prev.text + " " + block.text,
                bbox=BBox(
                    x0=min(prev.bbox.x0, block.bbox.x0),
                    y0=prev.bbox.y0,
                    x1=max(prev.bbox.x1, block.bbox.x1),
                    y1=block.bbox.y1,
                ),
                font_size=prev.font_size,
                font_name=prev.font_name,
                is_bold=prev.is_bold,
                is_italic=prev.is_italic,
            )
        else:
            merged.append(block)

    return merged


def _split_long_text(
    text: str, max_chars: int = MAX_CHUNK_CHARS, overlap: int = OVERLAP_CHARS
) -> list[str]:
    """Split text at sentence boundaries with overlap for context continuity."""
    if len(text) <= max_chars:
        return [text]

    sentences = SENTENCE_END.split(text)

    chunks: list[str] = []
    current = ""

    for sentence in sentences:
        if len(current) + len(sentence) + 1 <= max_chars:
            current = (current + " " + sentence).strip()
        else:
            if current:
                chunks.append(current)
            if len(sentence) > max_chars:
                words = sentence.split()
                current = ""
                for word in words:
                    if len(current) + len(word) + 1 <= max_chars:
                        current = (current + " " + word).strip()
                    else:
                        if current:
                            chunks.append(current)
                        current = word
            else:
                current = sentence

    if current:
        chunks.append(current)

    if len(chunks) > 1 and overlap > 0:
        overlapped = [chunks[0]]
        for i in range(1, len(chunks)):
            prev = chunks[i - 1]
            overlap_part = prev[-overlap:] if len(prev) > overlap else prev
            space_idx = overlap_part.find(" ")
            if space_idx > 0:
                overlap_part = overlap_part[space_idx + 1 :]
            overlapped.append(overlap_part + " " + chunks[i])
        chunks = overlapped

    return [c for c in chunks if len(c) > 20]


def _build_chunks(pages, structure_tree) -> list[TextChunk]:
    """Build one chunk per page by merging all text blocks."""
    chunks: list[TextChunk] = []
    SKIP_TYPES = {"toc", "index", "cover", "blank"}
    for page in pages:
        page_num = page.extraction.page_number

        # Skip pages that shouldn't be chunked
        if page.classification.page_type in SKIP_TYPES:
            continue

        path = _resolve_structure_path(structure_tree, page_num)

        merged = _merge_adjacent_blocks(
            page.extraction.text_blocks, page.extraction.height
        )

        all_texts = [block.text.strip() for block in merged if len(block.text.strip()) >= 20]
        if not all_texts:
            continue

        full_text = " ".join(all_texts)
        chunks.append(
            TextChunk(
                page_number=page_num,
                structure_path=path,
                content=full_text,
            )
        )
    return chunks


@app.post("/process", response_model=ProcessResult)
async def process_pdf(req: ProcessRequest):
    resolved_path = _validate_path(req.pdf_path)

    try:
        doc = fitz.open(resolved_path)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Cannot open PDF: file may be corrupt or encrypted",
        )

    try:
        pages: list[ProcessedPage] = []
        for i in range(len(doc)):
            page = doc[i]
            extraction = extract_page(page, i + 1)
            classification = classify_page(extraction, is_first_page=(i == 0))
            pages.append(
                ProcessedPage(extraction=extraction, classification=classification)
            )

        structure_tree = build_structure_tree([p.extraction for p in pages])
        figures = pair_figures([p.extraction for p in pages])
        chunks = _build_chunks(pages, structure_tree)

        # Upload images to storage if credentials available
        if req.user_id and req.textbook_id and SUPABASE_URL and SUPABASE_SERVICE_KEY:
            for fig in figures:
                if fig.image_base64:
                    image_url = await upload_image_to_storage(
                        fig.image_base64,
                        req.user_id,
                        req.textbook_id,
                        fig.figure_id,
                    )
                    fig.image_url = image_url
                    fig.image_base64 = ""  # Clear base64 from response

        # Clear base64 from page images to reduce response size
        for page in pages:
            for img in page.extraction.images:
                img.base64 = ""

        return ProcessResult(
            total_pages=len(pages),
            pages=pages,
            structure_tree=structure_tree,
            figures=figures,
            chunks=chunks,
        )
    finally:
        doc.close()
