from __future__ import annotations

import base64
import json
import os
import re
import tempfile
from urllib.parse import urlparse, urlunparse

import boto3
import fitz
from botocore.config import Config
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from .constants import (
    MAX_CHUNK_CHARS,
    OVERLAP_CHARS,
    VERTICAL_GAP_THRESHOLD,
    FONT_SIZE_TOLERANCE,
    MAX_PDF_PAGES,
)
from .extraction import extract_page
from .figures import pair_figures
from .curriculum import build_curriculum
from .layout import analyze_book
from .models import BBox, ProcessResult, TextBlock, TextChunk
from .structure import build_structure_tree

app = FastAPI(title="PDF Processor", version="0.5.0")

ALLOWED_DIRS = {tempfile.gettempdir(), "/tmp"}

# Progress reporting
PROGRESS_TTL_SECONDS = int(os.environ.get("PROGRESS_TTL_SECONDS", "3600"))
PROGRESS_EVERY_N_PAGES = 5

# Chunking constants (shared with backend config)
MAX_CHUNK_CHARS = int(os.environ.get("MAX_CHUNK_CHARS", "1000"))
OVERLAP_CHARS = int(os.environ.get("OVERLAP_CHARS", "100"))
VERTICAL_GAP_THRESHOLD = float(os.environ.get("VERTICAL_GAP_THRESHOLD", "20.0"))
FONT_SIZE_TOLERANCE = float(os.environ.get("FONT_SIZE_TOLERANCE", "1.5"))
SENTENCE_END = re.compile(r"(?<=[.!?؟])\s+")

# PDF Processing
MAX_PDF_PAGES = int(os.environ.get("MAX_PDF_PAGES", "800"))

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


def upload_image_to_storage(
    image_base64: str,
    user_id: str,
    textbook_id: str,
    figure_id: str,
) -> str:
    """Upload image to Cloudflare R2 and return its object key."""
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
        # Return the bare object key — the backend converts it to a
        # short-lived presigned URL so figures are never exposed via
        # permanent public URLs. Set R2_RETURN_PUBLIC_URL=1 to keep the
        # legacy public-URL behavior (e.g. an intentionally public bucket).
        if os.environ.get("R2_RETURN_PUBLIC_URL") == "1" and R2_PUBLIC_URL:
            return f"{R2_PUBLIC_URL}/{key}"
        return key
    except Exception as e:
        print(f"Failed to upload to R2: {e}")
        return ""


def _build_redis_client():
    """Optional Redis client for real-time progress reporting.

    Writes `textbook:progress:{id}` keys with the same payload shape the
    backend reads ({stage, pages_done, total_pages}). Progress is strictly
    best-effort: if Redis is unavailable, processing continues normally and
    the UI falls back to the indeterminate spinner.
    """
    url = os.environ.get("REDIS_URL", "")
    if not url:
        return None
    try:
        import redis as redis_lib

        parsed = urlparse(url)
        # An empty password in the URL would make redis-py send AUTH against
        # a server with no password configured (which errors out).
        if parsed.password in (None, ""):
            netloc = parsed.hostname or "localhost"
            if parsed.port:
                netloc += f":{parsed.port}"
            url = urlunparse((parsed.scheme, netloc, parsed.path, "", "", ""))
        return redis_lib.Redis.from_url(url, socket_timeout=2, socket_connect_timeout=2)
    except Exception as e:
        print(f"Redis progress reporting disabled: {e}")
        return None


redis_client = _build_redis_client()


def _report_progress(textbook_id: str, stage: str, done: int, total: int) -> None:
    if not redis_client or not textbook_id:
        return
    try:
        payload = json.dumps(
            {"stage": stage, "pages_done": done, "total_pages": total}
        )
        redis_client.set(
            f"textbook:progress:{textbook_id}", payload, ex=PROGRESS_TTL_SECONDS
        )
    except Exception:
        pass  # progress is best-effort, never fail processing for it


# Security and limits
PDF_PROCESSOR_TOKEN = os.environ.get("PDF_PROCESSOR_TOKEN", "")
MAX_PAGES = int(os.environ.get("PDF_MAX_PAGES", "800"))
UUID_REGEX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)


@app.get("/health")
async def health():
    return {"status": "ok", "pymupdf_version": fitz.version[0]}


class ProcessRequest(BaseModel):
    pdf_path: str
    user_id: str = ""
    textbook_id: str = ""


class ExtractTextRequest(BaseModel):
    pdf_path: str
    max_pages: int = 80
    max_chars: int = 300_000


@app.post("/extract-text")
def extract_text(req: ExtractTextRequest, authorization: str | None = Header(None)):
    """Lightweight text extraction for regular (non-material) chat files.
    No structure analysis, no chunks — just the text, capped."""
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    _validate_auth(token)

    resolved_path = _validate_path(req.pdf_path)
    max_pages = max(1, min(req.max_pages, 400))
    max_chars = max(1000, min(req.max_chars, 2_000_000))

    try:
        doc = fitz.open(resolved_path)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Cannot open PDF: file may be corrupt or encrypted",
        )

    try:
        parts: list[str] = []
        total = 0
        for i in range(min(len(doc), max_pages)):
            text = doc[i].get_text("text").strip()
            if not text:
                continue
            parts.append(f"--- Page {i + 1} ---\n{text}")
            total += len(text)
            if total >= max_chars:
                break
        return {"text": "\n\n".join(parts)[:max_chars], "pages": len(doc)}
    finally:
        doc.close()


def _validate_auth(token: str | None = None) -> None:
    if PDF_PROCESSOR_TOKEN and token != PDF_PROCESSOR_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _validate_path(pdf_path: str) -> str:
    """Validate and resolve the PDF path to prevent path traversal."""
    resolved = os.path.realpath(pdf_path)
    # Validate the RESOLVED path (after symlink resolution) is within allowed dirs
    # This prevents symlink attacks where a symlink in /tmp points outside
    if not any(
        resolved == d or resolved.startswith(d + os.sep) for d in ALLOWED_DIRS
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
                    y1=prev.bbox.y1,
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


# ── layout-aware chunking (v2) ──────────────────────────────────────────────

_CHUNK_ROLES = {"title", "heading", "body", "caption", "footnote"}


def _union_bbox_dict(blocks: list[TextBlock]) -> dict[str, float]:
    return {
        "x0": min(b.bbox.x0 for b in blocks),
        "y0": min(b.bbox.y0 for b in blocks),
        "x1": max(b.bbox.x1 for b in blocks),
        "y1": max(b.bbox.y1 for b in blocks),
    }


def _dominant(values: list[str]) -> str | None:
    if not values:
        return None
    counts: dict[str, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    return max(counts, key=lambda k: counts[k])


def _make_chunk(blocks: list[TextBlock], page_number: int, structure_path: str) -> list[TextChunk]:
    """Emit one or more TextChunks from a paragraph group (a single huge
    block may still be sentence-split via _split_long_text)."""
    text = " ".join(b.text.strip() for b in blocks if b.text.strip())
    if len(text) <= 20:
        return []

    roles = [b.role for b in blocks]
    role = _dominant(roles) or "body"
    color = _dominant([b.color for b in blocks])
    bbox = _union_bbox_dict(blocks)

    if len(text) > MAX_CHUNK_CHARS:
        parts = _split_long_text(text)
        return [
            TextChunk(
                page_number=page_number,
                structure_path=structure_path,
                content=part,
                block_role=role,
                text_color=color,
                bbox=bbox,
            )
            for part in parts
        ]

    return [
        TextChunk(
            page_number=page_number,
            structure_path=structure_path,
            content=text,
            block_role=role,
            text_color=color,
            bbox=bbox,
        )
    ]


def _build_chunks_v2(page_models, structure_tree) -> list[TextChunk]:
    """Layout-aware chunking: paragraphs are grouped by reading order within
    a page; headings start new groups; chunks never cut mid-paragraph."""
    chunks: list[TextChunk] = []
    SKIP_TYPES = {"toc", "index", "cover", "blank"}

    for pm in page_models:
        if pm.page_type in SKIP_TYPES:
            continue

        path = _resolve_structure_path(structure_tree, pm.page_number)

        content = sorted(
            [b for b in pm.blocks if b.role in _CHUNK_ROLES and b.text.strip()],
            key=lambda b: b.reading_order,
        )
        if not content:
            continue

        group: list[TextBlock] = []
        group_len = 0

        def flush(group: list[TextBlock]) -> None:
            if group:
                chunks.extend(_make_chunk(group, pm.page_number, path))

        for b in content:
            b_len = len(b.text.strip())
            # headings/titles are natural paragraph boundaries
            if b.role in ("title", "heading") and group:
                flush(group)
                group, group_len = [], 0
            # close the group before it would overflow
            if group and group_len + b_len + 1 > MAX_CHUNK_CHARS:
                flush(group)
                group, group_len = [], 0
            group.append(b)
            group_len += b_len + 1
            # a single block already at/over the limit closes immediately
            if group_len >= MAX_CHUNK_CHARS:
                flush(group)
                group, group_len = [], 0
        flush(group)

    return chunks


@app.post("/process", response_model=ProcessResult)
def process_pdf(req: ProcessRequest, authorization: str | None = Header(None)):
    # Deliberately a sync endpoint: FastAPI runs it in the threadpool, so
    # long CPU-bound PyMuPDF work cannot block the event loop (and the
    # /health endpoint stays responsive during processing).
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    _validate_auth(token)

    if req.user_id and not UUID_REGEX.match(req.user_id):
        raise HTTPException(status_code=400, detail="Invalid user_id format")
    if req.textbook_id and not UUID_REGEX.match(req.textbook_id):
        raise HTTPException(status_code=400, detail="Invalid textbook_id format")

    resolved_path = _validate_path(req.pdf_path)

    try:
        doc = fitz.open(resolved_path)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Cannot open PDF: file may be corrupt or encrypted",
        )

    if len(doc) > MAX_PAGES:
        doc.close()
        raise HTTPException(
            status_code=400,
            detail=f"PDF exceeds maximum page limit of {MAX_PAGES} (found {len(doc)} pages)",
        )

    try:
        total_pages = len(doc)
        _report_progress(req.textbook_id, "scanning", 0, total_pages)

        # Stage 1 — physical scan (deterministic)
        extractions = []
        for i in range(total_pages):
            page = doc[i]
            extractions.append(extract_page(page, i + 1))
            if (i + 1) % PROGRESS_EVERY_N_PAGES == 0 or (i + 1) == total_pages:
                _report_progress(req.textbook_id, "scanning", i + 1, total_pages)

        # Stage 2 — layout understanding (roles, reading order, classification)
        _report_progress(req.textbook_id, "layout", 0, total_pages)
        page_models, book_language = analyze_book(extractions)
        _report_progress(req.textbook_id, "layout", total_pages, total_pages)

        structure_tree = build_structure_tree(extractions)
        figures = pair_figures(extractions)
        chunks = _build_chunks_v2(page_models, structure_tree)

        # Stage 2b — curriculum map (units/lessons/topics, questions, glossary)
        _report_progress(req.textbook_id, "curriculum", 0, total_pages)
        curriculum = build_curriculum(page_models)
        _report_progress(req.textbook_id, "curriculum", total_pages, total_pages)

        # Upload images to R2 if credentials available
        if req.user_id and req.textbook_id and r2_client and figures:
            _report_progress(req.textbook_id, "figures", 0, len(figures))
            uploaded = 0
            for fig in figures:
                if fig.image_base64:
                    image_url = upload_image_to_storage(
                        fig.image_base64,
                        req.user_id,
                        req.textbook_id,
                        fig.figure_id,
                    )
                    fig.image_url = image_url
                    fig.image_base64 = ""  # Clear base64 from response
                    uploaded += 1
                    if uploaded % 5 == 0:
                        _report_progress(req.textbook_id, "figures", uploaded, len(figures))
            _report_progress(req.textbook_id, "figures", len(figures), len(figures))

        # Render + upload page thumbnails for visually-complex pages (input
        # for the backend's selective VLM pass; also used to show pages in chat)
        if req.user_id and req.textbook_id and r2_client:
            visual_pages = [
                pm
                for pm in page_models
                if pm.images
                or pm.vector_clusters
                or pm.page_type in ("figure_only", "table_heavy")
                or pm.page_role == "cover_front"
            ]
            for i, pm in enumerate(visual_pages):
                try:
                    pix = doc[pm.page_number - 1].get_pixmap(dpi=110)
                    png = pix.tobytes("png")
                    key = f"textbooks/{req.user_id}/{req.textbook_id}/pages/{pm.page_number}.png"
                    r2_client.put_object(
                        Bucket=R2_BUCKET_NAME, Key=key, Body=png, ContentType="image/png"
                    )
                    pm.thumbnail_key = key
                except Exception as e:
                    print(f"Thumbnail render failed for page {pm.page_number}: {e}")
                if (i + 1) % 10 == 0:
                    _report_progress(req.textbook_id, "thumbnails", i + 1, len(visual_pages))

        _report_progress(req.textbook_id, "scanning", total_pages, total_pages)
        return ProcessResult(
            total_pages=total_pages,
            page_models=page_models,
            structure_tree=structure_tree,
            figures=figures,
            chunks=chunks,
            book_language=book_language,
            curriculum=curriculum,
        )
    finally:
        doc.close()
