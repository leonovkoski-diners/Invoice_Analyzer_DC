"""Quick debug: show raw OCR lines and what extract_line_items does with them."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from pipeline.ocr import extract_text_from_file
from pipeline.heuristic import extract_line_items, extract_financial_totals, parse_amount, _TOTALS_MARKERS, _LINE_VAT_RE, _AMOUNT_END_RE, _PURE_NUMERIC_RE

PDF = r"C:\Users\leon\Downloads\INVOICE_ANALYZER_FILES\Фактура.pdf"

print("=== OCR ===")
ocr = extract_text_from_file(PDF)
lines = []
for page in ocr["pages"]:
    lines.extend(page["lines"])

print(f"Total lines: {len(lines)}")
for i, l in enumerate(lines):
    print(f"  [{i:3d}] {repr(l)}")

print("\n=== FINANCIAL TOTALS ===")
fin = extract_financial_totals(ocr["full_text"])
for k, v in fin.items():
    print(f"  {k}: {v}")

print("\n=== LINE ITEM EXTRACTION (verbose) ===")
# Find totals boundary
totals_idx = len(lines)
for i, line in enumerate(lines):
    if any(marker in line for marker in _TOTALS_MARKERS):
        print(f"  totals_idx={i} (line: {repr(line)})")
        totals_idx = i
        break

# Find header boundary
header_idx = 0
_HEADER_MARKERS = ["Опис", "Назив", "Description", "Ред бр", "Ред.бр", "Производ", "Услуга", "Артикал"]
for i, line in enumerate(lines[:totals_idx]):
    if any(marker in line for marker in _HEADER_MARKERS):
        print(f"  header_idx={i+1} (line: {repr(line)})")
        header_idx = i + 1
        break

print(f"\n  candidate_lines [{header_idx}:{totals_idx}]:")
for line in lines[header_idx:totals_idx]:
    line = line.strip()
    if not line or len(line) < 4:
        print(f"    SKIP(short): {repr(line)}")
        continue
    if _PURE_NUMERIC_RE.match(line):
        print(f"    SKIP(numeric): {repr(line)}")
        continue

    m_vat = _LINE_VAT_RE.match(line)
    if m_vat:
        net = parse_amount(m_vat.group(2))
        print(f"    VAT_MATCH: desc={repr(m_vat.group(1))} net_str={repr(m_vat.group(2))} net={net} vat%={m_vat.group(3)} vat_amt={repr(m_vat.group(4))} total={repr(m_vat.group(5))}")
        continue

    m = _AMOUNT_END_RE.search(line)
    if m:
        amt = parse_amount(m.group(1))
        desc = line[:m.start()].strip()
        print(f"    END_MATCH: desc={repr(desc)} amt_str={repr(m.group(1))} amt={amt}")
    else:
        print(f"    NO_MATCH: {repr(line)}")
