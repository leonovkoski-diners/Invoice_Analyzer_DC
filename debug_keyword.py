"""Quick diagnostic: run OCR on a real invoice and test keyword matching."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from pipeline.templates import _keyword_to_regex, _analyze_single_keyword
from pipeline.ocr import extract_text_from_file

if len(sys.argv) < 2:
    print("Usage: python debug_keyword.py <invoice.pdf>")
    sys.exit(1)

pdf_path = sys.argv[1]
print(f"Running OCR on: {pdf_path}")
ocr = extract_text_from_file(pdf_path)
full_text = ocr["full_text"]

print("\n--- Full OCR text ---")
print(full_text)
print("\n--- End OCR text ---\n")

# Find and dump chars around ВКУПНО / BKYПHO / any variant
print("--- Lines containing total keywords ---")
for line in full_text.splitlines():
    lower = line.lower()
    if any(x in lower for x in ['купно', 'kyпho', 'bkyп', 'vkupno', 'наплата', 'naplata', 'se:', 'сe:', 'се:']):
        print(f"  LINE: {repr(line)}")
        for i, ch in enumerate(line):
            print(f"    [{i}] U+{ord(ch):04X}  {repr(ch)}")

print("\n--- Keyword test ---")
KEYWORDS = ["ВКУПНО СЕ:", "BKYПHO CE:", "ВКУПНО CE:", "BKYПHO СЕ:"]
for kw in KEYWORDS:
    rx = _keyword_to_regex(kw)
    result = _analyze_single_keyword(kw, full_text)
    print(f"KW {repr(kw):30s} => {result['value'] if result else 'NOT FOUND'}")
