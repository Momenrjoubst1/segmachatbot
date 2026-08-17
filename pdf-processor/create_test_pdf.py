"""
Create a test PDF with 2 pages about Cellular Respiration
"""
import fitz  # PyMuPDF
import os

def create_test_pdf():
    doc = fitz.open()
    
    # Page 1: Title + Introduction
    page1 = doc.new_page(width=595, height=842)  # A4 size
    
    # Title
    title_point = fitz.Point(72, 72)
    page1.insert_text(title_point, "Cellular Respiration", fontsize=24, fontname="helv")
    
    # Subtitle
    subtitle_point = fitz.Point(72, 110)
    page1.insert_text(subtitle_point, "The Process of Energy Production in Cells", fontsize=14, fontname="helv")
    
    # Introduction text
    intro_text = """
Cellular respiration is the process by which cells convert glucose and oxygen 
into energy (ATP), carbon dioxide, and water. This fundamental process occurs 
in all living organisms and is essential for life.

The overall equation for cellular respiration is:

C6H12O6 + 6O2 → 6CO2 + 6H2O + ATP (energy)

This process occurs in three main stages:
1. Glycolysis (in the cytoplasm)
2. Krebs Cycle (in the mitochondrial matrix)
3. Electron Transport Chain (in the inner mitochondrial membrane)
"""
    
    text_point = fitz.Point(72, 160)
    page1.insert_text(text_point, intro_text, fontsize=11, fontname="helv")
    
    # Page 2: Detailed explanation with image placeholder
    page2 = doc.new_page(width=595, height=842)
    
    # Title
    title2_point = fitz.Point(72, 72)
    page2.insert_text(title2_point, "Glycolysis: The First Stage", fontsize=20, fontname="helv")
    
    # Draw a simple diagram (rectangle representing a cell)
    rect = fitz.Rect(72, 120, 250, 250)
    page2.draw_rect(rect, color=(0, 0, 0), fill=(0.9, 0.9, 1))
    
    # Add text inside the rectangle
    page2.insert_text(fitz.Point(80, 150), "Cell", fontsize=12, fontname="helv")
    page2.insert_text(fitz.Point(80, 170), "Cytoplasm", fontsize=10, fontname="helv")
    page2.insert_text(fitz.Point(80, 190), "Glucose → Pyruvate", fontsize=9, fontname="helv")
    
    # Explanation text
    explanation = """
Glycolysis is the first stage of cellular respiration. It occurs in the 
cytoplasm of the cell and does not require oxygen (anaerobic process).

Key points about glycolysis:
- glucose (6 carbons) is broken down into 2 pyruvate molecules (3 carbons)
- Net production: 2 ATP and 2 NADH
- Occurs in the cytoplasm
- Does not require oxygen

The process involves 10 enzymatic reactions, which can be divided into two phases:
1. Energy Investment Phase (steps 1-5): Uses 2 ATP
2. Energy Payoff Phase (steps 6-10): Produces 4 ATP and 2 NADH
"""
    
    text_point2 = fitz.Point(270, 120)
    page2.insert_text(text_point2, explanation, fontsize=10, fontname="helv")
    
    # Save the PDF
    output_path = os.path.join(os.path.dirname(__file__), "test_textbook.pdf")
    doc.save(output_path)
    doc.close()
    
    print(f"[OK] Test PDF created: {output_path}")
    print(f"[OK] Pages: 2")
    print(f"[OK] Topic: Cellular Respiration")
    print(f"[OK] Image: Simple cell diagram")
    
    return output_path

if __name__ == "__main__":
    create_test_pdf()
