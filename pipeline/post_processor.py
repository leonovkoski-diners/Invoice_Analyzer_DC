"""
Invoice Analyzer — Deterministic Post-Processing Layer
=======================================================
This is the most important module in the system.

The OCR extraction layer's job is document comprehension. This module's job is
financial correctness. All arithmetic is independently recalculated here.
Any discrepancy is flagged before the record ever reaches the ERP.
A wrong total will be caught here. This module never trusts the extractor.
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import List, Optional, Tuple

from pipeline.schema import InvoiceRecord, LineItem


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Maximum tolerable discrepancy before flagging (0.01 MKD)
DISCREPANCY_THRESHOLD = Decimal("0.01")

# Date formats to attempt, in order of specificity
DATE_FORMATS = [
    "%d/%m/%Y",   # 26/05/2025  — most common in MK/EU
    "%d.%m.%Y",   # 26.05.2025  — common in MK
    "%d.%m.%y",   # 31.10.22   — two-digit year (MK invoices)
    "%d/%m/%y",   # 31/10/22   — two-digit year
    "%Y-%m-%d",   # 2025-05-26  — ISO 8601
    "%d-%m-%Y",   # 26-05-2025
    "%m/%d/%Y",   # 05/26/2025  — US format (rare, flagged)
    "%B %d, %Y",  # May 26, 2025
    "%d %B %Y",   # 26 May 2025
    "%d %b %Y",   # 26 May 2025 (abbreviated)
    "%b %d, %Y",  # May 26, 2025 (abbreviated)
    "%Y%m%d",     # 20250526    — compact ISO
    "%d.%b.%Y",   # 14.Nov.2025 — dot-separated with abbreviated month
    "%d.%b.%y",   # 14.Nov.25   — two-digit year variant
]

# US-format is ambiguous — always flag it for manual review
AMBIGUOUS_DATE_FORMATS = {"%m/%d/%Y"}


# ---------------------------------------------------------------------------
# Date normalization
# ---------------------------------------------------------------------------

def normalize_date(raw: Optional[str], field_name: str) -> Tuple[Optional[str], List[str]]:
    """
    Attempt to parse a raw date string using multiple format patterns.
    Returns (ISO 8601 string, list of warning flags).
    """
    flags: List[str] = []

    if raw is None:
        return None, flags

    raw = raw.strip()

    if not raw:
        return None, flags

    # Normalize OCR artifacts: replace comma used as date separator with dot
    # e.g. "31.10,22" → "31.10.22"
    import re as _re
    raw = _re.sub(r"(\d)[,](\d)", r"\1.\2", raw)

    for fmt in DATE_FORMATS:
        try:
            parsed = datetime.strptime(raw, fmt)
            # Sanity check: year should be reasonable
            if parsed.year < 2000 or parsed.year > 2100:
                flags.append(
                    f"DATE_SUSPECT: {field_name} parsed to year {parsed.year} "
                    f"from '{raw}' — please verify"
                )
            if fmt in AMBIGUOUS_DATE_FORMATS:
                flags.append(
                    f"DATE_AMBIGUOUS: {field_name} '{raw}' matched US date format "
                    f"(MM/DD/YYYY) — verify this is not DD/MM/YYYY"
                )
            return parsed.strftime("%Y-%m-%d"), flags
        except ValueError:
            continue

    # Could not parse
    flags.append(
        f"DATE_UNPARSEABLE: {field_name} '{raw}' could not be parsed — "
        f"manual entry required"
    )
    return raw, flags  # Return raw so accountant can see what the model extracted


# ---------------------------------------------------------------------------
# Arithmetic verification
# ---------------------------------------------------------------------------

def _round2(v: Decimal) -> Decimal:
    """Round to 2 decimal places using standard financial rounding."""
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def verify_line_items(line_items: List[LineItem]) -> Tuple[List[LineItem], List[str]]:
    """
    Independently recalculate each line total from qty × unit_price.
    Flag any discrepancy > 0.01 MKD. Correct the line_total to the Python value.
    """
    flags: List[str] = []
    corrected: List[LineItem] = []

    for i, item in enumerate(line_items, start=1):
        expected = _round2(item.quantity * item.unit_price)
        stated = _round2(item.line_total)
        delta = abs(expected - stated)

        if delta >= DISCREPANCY_THRESHOLD:
            flags.append(
                f"LINE_MATH_ERROR: Line {i} ('{item.description[:40]}') — "
                f"stated {stated}, Python recalculates {expected} "
                f"(delta {delta}). Corrected to Python value."
            )
            item = item.model_copy(update={"line_total": expected})

        corrected.append(item)

    return corrected, flags


def verify_total(
    line_items: List[LineItem],
    stated_total: Decimal,
) -> Tuple[Decimal, List[str]]:
    """
    Verify total = sum(line_item.line_total).
    Total is the payment-critical field — any mismatch is high severity.
    """
    flags: List[str] = []
    calculated = _round2(sum(item.line_total for item in line_items))
    stated = _round2(stated_total)
    delta = abs(calculated - stated)

    if delta > DISCREPANCY_THRESHOLD:
        flags.append(
            f"TOTAL_MISMATCH [HIGH SEVERITY]: stated {stated}, "
            f"sum of line items = {calculated} (delta {delta}). "
            f"This is the payment amount — REVIEW REQUIRED. "
            f"Using sum-of-lines value."
        )
        return calculated, flags

    return stated, flags


# ---------------------------------------------------------------------------
# Main post-processing entry point
# ---------------------------------------------------------------------------

def post_process(record: InvoiceRecord) -> Tuple[InvoiceRecord, List[str]]:
    """
    Run the deterministic post-processing pipeline on an InvoiceRecord.

    Returns:
        (corrected_record, all_validation_flags)

    The returned record contains Python-verified values throughout.
    Flags are human-readable descriptions of every discrepancy found.
    """
    all_flags: List[str] = []

    # 1. Normalize invoice date
    invoice_date, date_flags = normalize_date(record.invoice_date, "invoice_date")
    all_flags.extend(date_flags)

    # 2. Verify line item arithmetic (qty × unit_price = line_total)
    corrected_lines, line_flags = verify_line_items(record.line_items)
    all_flags.extend(line_flags)

    # 3. Verify total = sum of line totals (payment-critical)
    corrected_total, total_flags = verify_total(corrected_lines, record.total)
    all_flags.extend(total_flags)

    corrected = record.model_copy(
        update={
            "invoice_date": invoice_date or record.invoice_date,
            "line_items": corrected_lines,
            "total": corrected_total,
        }
    )

    corrected._validation_flags = all_flags

    return corrected, all_flags
