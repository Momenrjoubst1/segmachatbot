from __future__ import annotations

import json
import os
import sys
import tempfile

import fitz


def create_sample_pdf(path: str) -> None:
    doc = fitz.open()

    # Page 1: Cover page
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 200), "Biology: The Unity of Life", fontsize=28, fontname="helv")
    page.insert_text((72, 260), "Chapter 6: Cellular Respiration", fontsize=20, fontname="helv")
    page.insert_text((72, 320), "A Comprehensive Guide", fontsize=14, fontname="helv")

    # Page 2: Table of contents
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "Table of Contents", fontsize=22, fontname="helv")
    toc_lines = [
        "6.1  Overview of Cellular Respiration ............ 3",
        "6.2  Glycolysis ................................... 4",
        "6.3  The Krebs Cycle ............................. 5",
        "6.4  Electron Transport Chain .................... 6",
    ]
    y = 120
    for line in toc_lines:
        page.insert_text((72, y), line, fontsize=12, fontname="helv")
        y += 24

    # Page 3: Chapter 6.1 text
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "6.1 Overview of Cellular Respiration", fontsize=18, fontname="helv")
    body = (
        "Cellular respiration is the process by which cells break down glucose "
        "and other organic molecules to produce ATP, the universal energy currency "
        "of the cell. This metabolic pathway occurs in three main stages: glycolysis, "
        "the Krebs cycle, and the electron transport chain."
    )
    page.insert_textbox((72, 110, 540, 400), body, fontsize=11, fontname="helv")

    # Page 4: Chapter 6.2 with figure
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "6.2 Glycolysis", fontsize=18, fontname="helv")
    glycolysis_text = (
        "Glycolysis is the first stage of cellular respiration, occurring in the "
        "cytoplasm of the cell. It involves the breakdown of one molecule of glucose "
        "into two molecules of pyruvate. This process requires an initial investment "
        "of 2 ATP molecules but produces 4 ATP molecules, for a net gain of 2 ATP."
    )
    page.insert_textbox((72, 110, 540, 350), glycolysis_text, fontsize=11, fontname="helv")
    # Insert actual embedded image
    img_doc = fitz.open()
    img_page = img_doc.new_page(width=200, height=150)
    img_page.draw_rect(fitz.Rect(10, 10, 190, 140), color=(0, 0, 0.8), fill=(0.7, 0.85, 1.0))
    img_page.insert_text((50, 80), "Glycolysis Pathway", fontsize=12, fontname="helv")
    img_bytes = img_page.get_pixmap().tobytes("png")
    img_doc.close()
    page.insert_image(fitz.Rect(150, 380, 450, 550), stream=img_bytes)
    page.insert_text((150, 570), "Figure 6.1: The Glycolysis Pathway", fontsize=10, fontname="helv")

    # Page 5: Chapter 6.3
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "6.3 The Krebs Cycle", fontsize=18, fontname="helv")
    krebs_text = (
        "The Krebs cycle takes place in the mitochondrial matrix. Each turn of the "
        "cycle produces 3 NADH, 1 FADH2, 1 GTP, and releases 2 CO2 molecules. "
        "Since each glucose molecule produces 2 pyruvate molecules, the cycle turns "
        "twice per glucose. The Krebs cycle is shown in Figure 6.2."
    )
    page.insert_textbox((72, 110, 540, 350), krebs_text, fontsize=11, fontname="helv")
    # Another embedded image
    img_doc2 = fitz.open()
    img_page2 = img_doc2.new_page(width=200, height=200)
    img_page2.draw_rect(fitz.Rect(10, 10, 190, 190), color=(0, 0.5, 0), fill=(0.85, 1.0, 0.85))
    img_page2.insert_text((40, 100), "Krebs Cycle", fontsize=12, fontname="helv")
    img_bytes2 = img_page2.get_pixmap().tobytes("png")
    img_doc2.close()
    page.insert_image(fitz.Rect(150, 380, 450, 580), stream=img_bytes2)
    page.insert_text((150, 600), "Figure 6.2: The Krebs Cycle Diagram", fontsize=10, fontname="helv")

    doc.save(path)
    doc.close()


def validate_output(result: dict) -> list[str]:
    errors: list[str] = []

    if "total_pages" not in result:
        errors.append("Missing 'total_pages'")
    if "pages" not in result or not isinstance(result["pages"], list):
        errors.append("Missing or invalid 'pages'")
        return errors
    if "structure_tree" not in result:
        errors.append("Missing 'structure_tree'")
    if "figures" not in result or not isinstance(result["figures"], list):
        errors.append("Missing or invalid 'figures'")
    if "chunks" not in result or not isinstance(result["chunks"], list):
        errors.append("Missing or invalid 'chunks'")

    tree = result.get("structure_tree", {})
    if tree.get("level") != "root":
        errors.append(f"structure_tree root level is '{tree.get('level')}', expected 'root'")
    if not tree.get("children"):
        errors.append("structure_tree has no children (no headings detected)")

    for fig in result.get("figures", []):
        for key in ("figure_id", "page_number", "caption", "image_base64", "bounding_box"):
            if key not in fig:
                errors.append(f"Figure missing '{key}'")
        if len(fig.get("image_base64", "")) < 100:
            errors.append(f"Figure {fig.get('figure_id')}: image_base64 too short")

    for chunk in result.get("chunks", []):
        for key in ("page_number", "structure_path", "content"):
            if key not in chunk:
                errors.append(f"Chunk missing '{key}'")

    return errors


def main():
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        pdf_path = tmp.name

    try:
        print("Creating sample PDF with embedded images...")
        create_sample_pdf(pdf_path)
        print(f"Sample PDF created: {pdf_path}")

        print("\nTesting full pipeline (Stages 1-4)...")
        from app.extraction import extract_page
        from app.classification import classify_page
        from app.structure import build_structure_tree
        from app.figures import pair_figures
        from app.models import ProcessedPage

        doc = fitz.open(pdf_path)
        pages = []
        for i in range(len(doc)):
            page = doc[i]
            extraction = extract_page(page, i + 1)
            classification = classify_page(extraction, is_first_page=(i == 0))
            pages.append(
                ProcessedPage(extraction=extraction, classification=classification)
            )
        doc.close()
        doc = None

        extractions = [p.extraction for p in pages]
        structure_tree = build_structure_tree(extractions)
        figures = pair_figures(extractions)

        # Build chunks
        def resolve_path(tree_node, page_number):
            parts = []
            node = tree_node
            while node.children:
                child = None
                for c in node.children:
                    if c.page_start <= page_number <= c.page_end:
                        child = c
                        break
                if child is None:
                    break
                parts.append(child.title)
                node = child
            return " > ".join(parts)

        chunks = []
        SKIP_TYPES = {"toc", "index", "cover", "blank"}
        for p in pages:
            pn = p.extraction.page_number
            # Skip pages that shouldn't be chunked
            if p.classification.page_type in SKIP_TYPES:
                continue
            path = resolve_path(structure_tree, pn)
            # Merge adjacent blocks (same logic as main.py)
            from app.models import BBox
            merged = p.extraction.text_blocks[:]
            all_texts = [block.text.strip() for block in merged if len(block.text.strip()) >= 20]
            if all_texts:
                full_text = " ".join(all_texts)
                chunks.append({"page_number": pn, "structure_path": path, "content": full_text})

        result = {
            "total_pages": len(pages),
            "pages": [p.model_dump() for p in pages],
            "structure_tree": structure_tree.model_dump(),
            "figures": [f.model_dump() for f in figures],
            "chunks": chunks,
        }

        print(f"\nExtracted {result['total_pages']} pages")
        print(f"Figures found: {len(result['figures'])}")
        print(f"Chunks created: {len(result['chunks'])}")

        print("\n--- Structure Tree ---")
        print(json.dumps(result["structure_tree"], indent=2, ensure_ascii=False)[:2000])

        print("\n--- Figures ---")
        for fig in result["figures"]:
            print(f"  {fig['figure_id']}: p.{fig['page_number']} — {fig['caption'][:60]}")

        print("\n--- Chunks (first 5) ---")
        for chunk in result["chunks"][:5]:
            print(f"  p.{chunk['page_number']} [{chunk['structure_path'][:50]}] — {chunk['content'][:60]}...")

        print("\n--- Page Classifications ---")
        for p in result["pages"]:
            cls = p["classification"]
            ext = p["extraction"]
            print(
                f"  Page {cls['page_number']}: {cls['page_type']:12s} | "
                f"{len(ext['text_blocks']):2d} text blocks | "
                f"{len(ext['images']):2d} images"
            )

        print("\n--- Validation ---")
        errors = validate_output(result)
        if errors:
            print(f"FAILED with {len(errors)} errors:")
            for e in errors:
                print(f"  - {e}")
            sys.exit(1)
        else:
            print("ALL CHECKS PASSED")

    finally:
        import time
        time.sleep(0.1)
        if os.path.exists(pdf_path):
            try:
                os.unlink(pdf_path)
            except PermissionError:
                pass


if __name__ == "__main__":
    main()
