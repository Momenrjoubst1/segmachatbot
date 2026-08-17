"""Curriculum Layer — infer the book's pedagogical structure.

Combines multiple weak signals into a strong tree (unit → lesson → topic):
  1. Explicit title patterns (bilingual): الوحدة/الدرس/Unit/Lesson/Chapter
  2. Typography tiers (title-size + centered/bold => lesson opener)
  3. Document order of heading blocks

Also extracts:
  - lesson/unit question sections as discrete QuestionItems (bilingual
    headers: أسئلة الدرس/أسئلة الوحدة/Review Questions...)
  - end-of-book glossary entries (term: definition pairs, bilingual)

Everything is deterministic — no AI calls. The result feeds the tutor
features (quiz mode, lesson navigation) and grounds the bot's answers in
the book's own organization.
"""
from __future__ import annotations

import re

from .models import (
    CurriculumNode,
    CurriculumResult,
    GlossaryEntry,
    PageModel,
    QuestionItem,
    TextBlock,
)

# ── bilingual patterns ──────────────────────────────────────────────────────

UNIT_RE = re.compile(
    r"^\s*(الوحدة|وحدة|الجزء|جزء|unit\s+\d|part\s+\d|chapter\s+\d)", re.I
)
LESSON_RE = re.compile(
    r"^\s*(الدرس|درس|lesson\s+\d|\d+\.\d+[\s.:])", re.I
)
QUESTION_HEADER_RE = re.compile(
    r"(أسئلة\s*الدرس|أسئلة\s*الوحدة|أسئلة\s*المراجعة|أسئلة\s*الفصل|أسئلة\s*النص"
    r"|تمارين|تدريبات|اختبر\s*نفسي|review\s*questions|chapter\s*review|questions"
    r"|exercises|assessment)",
    re.I,
)
UNIT_QUESTION_RE = re.compile(r"(الوحدة|unit|chapter)", re.I)
QUESTION_NUM_RE = re.compile(r"^\s*(\d{1,2}|[أ-ي]|[(\[]?[أ-ي][)\]]?)\s*[).\-–:،]\s*")
# Visual-order bidi PDFs leave the question number at the END of the line
QUESTION_NUM_END_RE = re.compile(r"\s*[.،؟?!]?\s*(\d{1,2})\s*[).\-–:،]\s*$")
GLOSSARY_HEADER_RE = re.compile(
    r"(المصطلحات|مصطلحات|مسرد|مفردات\s*الكتاب|مفردات|مفاهيم"
    r"|glossary|key\s*terms|important\s*terms|vocabulary)",
    re.I,
)
TERM_SPLIT_RE = re.compile(r"\s*[:：]\s*|\s+[—–]\s+")

_SKIP_PAGE_TYPES = {"toc", "index", "cover", "blank"}
_HEADING_ROLES = {"title", "heading"}
_MAX_TITLE_LEN = 120
_MAX_QUESTIONS = 500
_MAX_GLOSSARY = 1000

_LEVEL_NAME = {1: "unit", 2: "lesson", 3: "topic"}


def _is_centered(block: TextBlock, page: PageModel) -> bool:
    cx = (block.bbox.x0 + block.bbox.x1) / 2
    return abs(cx - page.width / 2) < page.width * 0.12


# ── tree construction ───────────────────────────────────────────────────────

def _collect_headings(page_models: list[PageModel]) -> list[dict]:
    candidates: list[dict] = []
    for pm in page_models:
        if pm.page_type in _SKIP_PAGE_TYPES:
            continue
        for b in pm.blocks:
            if b.role not in _HEADING_ROLES:
                continue
            text = b.text.strip()
            if not text or len(text) > _MAX_TITLE_LEN:
                continue
            if QUESTION_HEADER_RE.search(text) or GLOSSARY_HEADER_RE.search(text):
                continue  # section headers, not content sections
            candidates.append(
                {
                    "page": pm.page_number,
                    "size": b.font_size,
                    "bold": b.is_bold,
                    "centered": _is_centered(b, pm),
                    "text": text,
                    "level": 3,
                }
            )
    return candidates


def _assign_levels(candidates: list[dict]) -> None:
    """1 = unit, 2 = lesson, 3 = topic. Explicit patterns win; otherwise
    typography: the biggest headings (centered or bold) are lesson openers."""
    if not candidates:
        return
    max_size = max(c["size"] for c in candidates)
    for c in candidates:
        if UNIT_RE.search(c["text"]):
            c["level"] = 1
        elif LESSON_RE.search(c["text"]):
            c["level"] = 2
        elif c["size"] >= max_size * 0.92 and (c["centered"] or c["bold"]):
            c["level"] = 2
        else:
            c["level"] = 3


def _build_tree(
    candidates: list[dict], total_pages: int, book_title: str
) -> CurriculumNode:
    # 1) end pages from the flat document-ordered list: a section ends where
    #    the next same-or-higher level section starts
    n = len(candidates)
    for i, c in enumerate(candidates):
        c["page_end"] = total_pages
        for j in range(i + 1, n):
            if candidates[j]["level"] <= c["level"]:
                nxt = candidates[j]["page"]
                # exclusive end: pages belong to the section that STARTS on them
                c["page_end"] = (nxt - 1) if nxt > c["page"] else c["page"]
                break

    # 2) nest with a stack
    root = CurriculumNode(
        level="unit",  # book container
        title=book_title or "الكتاب",
        page_start=candidates[0]["page"] if candidates else 1,
        page_end=total_pages,
        children=[],
    )
    stack: list[CurriculumNode] = [root]
    for c in candidates:
        node = CurriculumNode(
            level=_LEVEL_NAME[c["level"]],
            title=c["text"],
            page_start=c["page"],
            page_end=c["page_end"],
            children=[],
        )
        while len(stack) > 1 and _rank(stack[-1].level) >= _rank(node.level):
            stack.pop()
        stack[-1].children.append(node)
        stack.append(node)

    # 3) order indices (DFS)
    counter = [0]

    def _index(node: CurriculumNode) -> None:
        node.order_index = counter[0]
        counter[0] += 1
        for child in node.children:
            _index(child)

    _index(root)
    return root


def _rank(level: str) -> int:
    return {"unit": 1, "lesson": 2, "topic": 3}.get(level, 4)


def _flatten_with_paths(
    node: CurriculumNode, path: list[str], out: list[tuple[CurriculumNode, list[str]]]
) -> None:
    current_path = path + [node.title]
    out.append((node, current_path))
    for child in node.children:
        _flatten_with_paths(child, current_path, out)


def _section_path_at(
    flat: list[tuple[CurriculumNode, list[str]]], page: int
) -> list[str]:
    """Deepest section covering this page. The book root is first in doc
    order, so any real section containing the page overrides it."""
    best: list[str] = []
    for node, path in flat:
        if node.page_start <= page <= node.page_end:
            best = path
    return best


# ── questions extraction ────────────────────────────────────────────────────

def _extract_questions(
    page_models: list[PageModel],
    flat: list[tuple[CurriculumNode, list[str]]],
) -> list[QuestionItem]:
    questions: list[QuestionItem] = []
    in_questions = False
    q_type = "lesson_questions"
    current_q: QuestionItem | None = None

    for pm in page_models:
        if pm.page_type in _SKIP_PAGE_TYPES:
            in_questions = False
            current_q = None
            continue

        path = " > ".join(_section_path_at(flat, pm.page_number)[1:])  # skip book root

        for b in sorted(pm.blocks, key=lambda x: x.reading_order):
            text = b.text.strip()
            if not text or b.role in ("header", "footer", "page_number"):
                continue

            header = QUESTION_HEADER_RE.search(text)
            if header:
                in_questions = True
                q_type = (
                    "unit_questions"
                    if UNIT_QUESTION_RE.search(text)
                    else "lesson_questions"
                )
                current_q = None
                continue

            if not in_questions:
                continue

            # exits: a content heading / new section / glossary ends the block
            if b.role == "title" or UNIT_RE.search(text) or LESSON_RE.search(text) or GLOSSARY_HEADER_RE.search(text):
                in_questions = False
                current_q = None
                continue

            if len(questions) >= _MAX_QUESTIONS:
                return questions

            # A single extracted block can hold several questions ("... 2. ...");
            # split on inline number markers before classifying each part
            parts = re.split(r"(?=\b\d{1,2}\s*[).\-–]\s)", text) if in_questions else [text]
            for part in parts:
                part = part.strip()
                if not part:
                    continue
                m = QUESTION_NUM_RE.match(part)
                if m:
                    number, body = m.group(1), part[m.end():].strip()
                else:
                    # visual-order bidi: the number trails the line ("... 2.")
                    m_end = QUESTION_NUM_END_RE.search(part)
                    if m_end:
                        number = m_end.group(1)
                        body = part[: m_end.start()].rstrip(".،؟! ").strip()
                    else:
                        number, body = "", part

                if number:
                    current_q = QuestionItem(
                        number=number,
                        text=body,
                        page_number=pm.page_number,
                        question_type=q_type,
                        section_path=path,
                    )
                    if current_q.text:
                        questions.append(current_q)
                elif current_q is not None and len(part) > 3:
                    current_q.text = (current_q.text + " " + part).strip()
                elif len(part) > 15:
                    current_q = QuestionItem(
                        number="",
                        text=part,
                        page_number=pm.page_number,
                        question_type=q_type,
                        section_path=path,
                    )
                    questions.append(current_q)

    return questions


# ── glossary extraction ────────────────────────────────────────────────────

def _find_glossary_start(page_models: list[PageModel]) -> int | None:
    """Page number of the LAST glossary header (entries run to book end)."""
    header_page = None
    for pm in page_models:
        for b in pm.blocks:
            if GLOSSARY_HEADER_RE.search(b.text):
                header_page = pm.page_number
                break
    return header_page


def _extract_glossary(page_models: list[PageModel]) -> list[GlossaryEntry]:
    header_page = _find_glossary_start(page_models)
    if header_page is None:
        return []

    entries: list[GlossaryEntry] = []
    for pm in page_models:
        if pm.page_number < header_page or pm.page_type == "blank":
            continue
        # stop if a real content section resumes after the glossary
        if any(
            UNIT_RE.search(b.text) or LESSON_RE.search(b.text)
            for b in pm.blocks
            if b.role in _HEADING_ROLES
        ):
            break
        for b in sorted(pm.blocks, key=lambda x: x.reading_order):
            if b.role in ("header", "footer", "page_number", "title", "heading"):
                # glossary headers themselves are headings — skip, but a
                # CONTENT heading (new chapter after glossary) is rare; accept
                if GLOSSARY_HEADER_RE.search(b.text):
                    continue
                continue
            text = b.text.strip()
            if not text:
                continue
            text = QUESTION_NUM_RE.sub("", text, count=1).strip()
            parts = TERM_SPLIT_RE.split(text, maxsplit=1)
            if len(parts) == 2 and 1 < len(parts[0].strip()) <= 45:
                entries.append(
                    GlossaryEntry(
                        term=parts[0].strip(),
                        definition=parts[1].strip(),
                        page_number=pm.page_number,
                    )
                )
            elif 1 < len(text) <= 45 and b.is_bold:
                entries.append(GlossaryEntry(term=text, definition="", page_number=pm.page_number))
            if len(entries) >= _MAX_GLOSSARY:
                return entries
    return entries


# ── entry point ─────────────────────────────────────────────────────────────

def build_curriculum(page_models: list[PageModel]) -> CurriculumResult:
    total_pages = page_models[-1].page_number if page_models else 0

    # Glossary pages are not part of any lesson/unit range
    glossary_start = _find_glossary_start(page_models)
    content_end = (glossary_start - 1) if glossary_start else total_pages

    # book title = first title block on the front cover (or first title)
    book_title = ""
    for pm in page_models:
        titles = [b.text.strip() for b in pm.blocks if b.role == "title"]
        if titles:
            book_title = titles[0]
            break

    candidates = _collect_headings(page_models)
    _assign_levels(candidates)
    root = _build_tree(candidates, content_end, book_title)

    flat: list[tuple[CurriculumNode, list[str]]] = []
    _flatten_with_paths(root, [], flat)

    questions = _extract_questions(page_models, flat)
    glossary = _extract_glossary(page_models)

    return CurriculumResult(root=root, questions=questions, glossary=glossary)
