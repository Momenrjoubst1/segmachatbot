from __future__ import annotations

from .models import PageExtraction, StructureNode


def build_structure_tree(pages: list[PageExtraction]) -> StructureNode:
    all_blocks: list[tuple[int, float, str]] = []
    for page in pages:
        for block in page.text_blocks:
            all_blocks.append((page.page_number, block.font_size, block.text))

    if not all_blocks:
        return StructureNode(level="root", title="Root", page_start=1, page_end=1, children=[])

    font_sizes = sorted(set(s for _, s, _ in all_blocks), reverse=True)
    size_to_level: dict[float, str] = {}
    for i, size in enumerate(font_sizes[:4]):
        if i == 0:
            size_to_level[size] = "chapter"
        elif i == 1:
            size_to_level[size] = "section"
        elif i == 2:
            size_to_level[size] = "subsection"
        else:
            size_to_level[size] = "content"

    for size in font_sizes:
        if size not in size_to_level:
            size_to_level[size] = "content"

    root = StructureNode(level="root", title="Root", page_start=1, page_end=pages[-1].page_number if pages else 1, children=[])
    stack: list[StructureNode] = [root]

    for page_num, font_size, text in all_blocks:
        level = size_to_level.get(font_size, "content")
        if level == "content":
            continue

        node = StructureNode(level=level, title=text, page_start=page_num, page_end=page_num, children=[])

        while len(stack) > 1:
            parent = stack[-1]
            if _level_rank(level) > _level_rank(parent.level):
                parent.children.append(node)
                stack.append(node)
                break
            else:
                stack.pop()
        else:
            stack[-1].children.append(node)
            stack.append(node)

    _compute_page_ranges(root)
    return root


def _level_rank(level: str) -> int:
    return {"root": 0, "chapter": 1, "section": 2, "subsection": 3, "content": 4}.get(level, 5)


def _compute_page_ranges(node: StructureNode) -> None:
    if node.children:
        for child in node.children:
            _compute_page_ranges(child)
        node.page_start = node.children[0].page_start
        node.page_end = node.children[-1].page_end
