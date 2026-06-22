"""
Invoice Analyzer — Post-Processor Unit Tests
=============================================
These tests are NON-OPTIONAL. The post-processor must pass all of them
before the application is considered production-ready.

Run with:
    python -m pytest tests/test_post_processor.py -v
"""

from decimal import Decimal

import pytest

from pipeline.post_processor import (
    DISCREPANCY_THRESHOLD,
    normalize_date,
    verify_line_items,
    verify_subtotal,
    verify_tax,
    verify_total,
    post_process,
)
from pipeline.schema import InvoiceRecord, LineItem


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_record(**overrides) -> InvoiceRecord:
    """Build a valid InvoiceRecord for testing."""
    defaults = {
        "vendor_name": "Acme Supplies DOOEL",
        "vendor_vat_id": "MK4030006208",
        "invoice_number": "INV-2025-001",
        "invoice_date": "26/05/2025",
        "due_date": "25/06/2025",
        "currency": "MKD",
        "line_items": [
            LineItem(
                description="Office Supplies",
                quantity=Decimal("10"),
                unit_price=Decimal("50.00"),
                line_total=Decimal("500.00"),
            )
        ],
        "subtotal": Decimal("500.00"),
        "tax_rate": Decimal("18.0"),
        "tax_amount": Decimal("90.00"),
        "total": Decimal("590.00"),
        "payment_reference": "PP30-2025-001",
    }
    defaults.update(overrides)
    return InvoiceRecord(**defaults)


# ---------------------------------------------------------------------------
# Date normalization
# ---------------------------------------------------------------------------

class TestNormalizeDate:

    def test_eu_slash_format(self):
        result, flags = normalize_date("26/05/2025", "invoice_date")
        assert result == "2025-05-26"
        assert not flags

    def test_eu_dot_format(self):
        result, flags = normalize_date("26.05.2025", "invoice_date")
        assert result == "2025-05-26"
        assert not flags

    def test_iso_format(self):
        result, flags = normalize_date("2025-05-26", "invoice_date")
        assert result == "2025-05-26"
        assert not flags

    def test_us_format_flagged(self):
        result, flags = normalize_date("05/26/2025", "invoice_date")
        assert result == "2025-05-26"
        assert any("AMBIGUOUS" in f for f in flags), "US format should be flagged"

    def test_none_returns_none(self):
        result, flags = normalize_date(None, "due_date")
        assert result is None
        assert not flags

    def test_empty_string_returns_none(self):
        result, flags = normalize_date("", "due_date")
        assert result is None
        assert not flags

    def test_unparseable_flagged(self):
        result, flags = normalize_date("not-a-date", "invoice_date")
        assert any("UNPARSEABLE" in f for f in flags)

    def test_suspect_year_flagged(self):
        # "26/05/25" might parse as year 25 — should be flagged
        result, flags = normalize_date("26/05/0025", "invoice_date")
        assert any("SUSPECT" in f for f in flags)

    def test_long_month_name(self):
        result, flags = normalize_date("26 May 2025", "invoice_date")
        assert result == "2025-05-26"
        assert not flags


# ---------------------------------------------------------------------------
# Line item verification
# ---------------------------------------------------------------------------

class TestVerifyLineItems:

    def test_correct_line_items_pass(self):
        items = [
            LineItem(description="A", quantity=Decimal("2"), unit_price=Decimal("10.00"), line_total=Decimal("20.00")),
            LineItem(description="B", quantity=Decimal("3"), unit_price=Decimal("5.00"), line_total=Decimal("15.00")),
        ]
        corrected, flags = verify_line_items(items)
        assert not flags
        assert corrected[0].line_total == Decimal("20.00")

    def test_hallucinated_line_total_corrected(self):
        items = [
            LineItem(description="Widget", quantity=Decimal("4"), unit_price=Decimal("25.00"), line_total=Decimal("150.00")),  # Wrong! Should be 100.00
        ]
        corrected, flags = verify_line_items(items)
        assert any("LINE_MATH_ERROR" in f for f in flags)
        assert corrected[0].line_total == Decimal("100.00")  # Python-calculated value

    def test_rounding_tolerance(self):
        # Delta is exactly 0.01 — on the boundary, should be flagged and corrected
        items = [
            LineItem(description="A", quantity=Decimal("3"), unit_price=Decimal("0.33"), line_total=Decimal("1.00")),  # 3 × 0.33 = 0.99, delta = 0.01
        ]
        corrected, flags = verify_line_items(items)
        # Delta == threshold (0.01) triggers correction — threshold is the max allowed, not exclusive
        assert any("LINE_MATH_ERROR" in f for f in flags)
        assert corrected[0].line_total == Decimal("0.99")  # Corrected to Python value

    def test_multiple_items_independent(self):
        items = [
            LineItem(description="A", quantity=Decimal("2"), unit_price=Decimal("10.00"), line_total=Decimal("20.00")),
            LineItem(description="B", quantity=Decimal("3"), unit_price=Decimal("10.00"), line_total=Decimal("99.00")),  # Wrong!
        ]
        corrected, flags = verify_line_items(items)
        assert len(flags) == 1  # Only one error
        assert corrected[0].line_total == Decimal("20.00")  # Unchanged
        assert corrected[1].line_total == Decimal("30.00")  # Corrected


# ---------------------------------------------------------------------------
# Subtotal verification
# ---------------------------------------------------------------------------

class TestVerifySubtotal:

    def test_correct_subtotal_passes(self):
        items = [
            LineItem(description="A", quantity=Decimal("2"), unit_price=Decimal("10.00"), line_total=Decimal("20.00")),
        ]
        subtotal, flags = verify_subtotal(items, Decimal("20.00"))
        assert subtotal == Decimal("20.00")
        assert not flags

    def test_wrong_subtotal_corrected(self):
        items = [
            LineItem(description="A", quantity=Decimal("2"), unit_price=Decimal("10.00"), line_total=Decimal("20.00")),
        ]
        subtotal, flags = verify_subtotal(items, Decimal("25.00"))  # Wrong
        assert any("SUBTOTAL_MISMATCH" in f for f in flags)
        assert subtotal == Decimal("20.00")  # Python-calculated

    def test_multi_item_subtotal(self):
        items = [
            LineItem(description="A", quantity=Decimal("2"), unit_price=Decimal("10.00"), line_total=Decimal("20.00")),
            LineItem(description="B", quantity=Decimal("1"), unit_price=Decimal("15.00"), line_total=Decimal("15.00")),
        ]
        subtotal, flags = verify_subtotal(items, Decimal("35.00"))
        assert subtotal == Decimal("35.00")
        assert not flags


# ---------------------------------------------------------------------------
# Tax verification
# ---------------------------------------------------------------------------

class TestVerifyTax:

    def test_correct_tax_passes(self):
        tax, flags = verify_tax(Decimal("100.00"), Decimal("18.0"), Decimal("18.00"))
        assert tax == Decimal("18.00")
        assert not flags

    def test_wrong_tax_corrected(self):
        tax, flags = verify_tax(Decimal("100.00"), Decimal("18.0"), Decimal("20.00"))  # Wrong
        assert any("TAX_MISMATCH" in f for f in flags)
        assert tax == Decimal("18.00")

    def test_no_tax_returns_none(self):
        tax, flags = verify_tax(Decimal("100.00"), None, None)
        assert tax is None
        assert not flags

    def test_missing_tax_amount_calculated(self):
        tax, flags = verify_tax(Decimal("100.00"), Decimal("18.0"), None)
        assert any("TAX_AMOUNT_MISSING" in f for f in flags)
        assert tax == Decimal("18.00")

    def test_missing_tax_rate_flagged(self):
        tax, flags = verify_tax(Decimal("100.00"), None, Decimal("18.00"))
        assert any("TAX_RATE_MISSING" in f for f in flags)

    def test_zero_tax_invoice(self):
        tax, flags = verify_tax(Decimal("100.00"), Decimal("0.0"), Decimal("0.00"))
        assert tax == Decimal("0.00")
        assert not flags


# ---------------------------------------------------------------------------
# Total verification — payment-critical
# ---------------------------------------------------------------------------

class TestVerifyTotal:

    def test_correct_total_passes(self):
        total, flags = verify_total(Decimal("100.00"), Decimal("18.00"), Decimal("118.00"))
        assert total == Decimal("118.00")
        assert not flags

    def test_wrong_total_corrected_and_high_severity(self):
        total, flags = verify_total(Decimal("100.00"), Decimal("18.00"), Decimal("120.00"))
        assert any("HIGH SEVERITY" in f for f in flags)
        assert total == Decimal("118.00")

    def test_total_without_tax(self):
        total, flags = verify_total(Decimal("100.00"), None, Decimal("100.00"))
        assert total == Decimal("100.00")
        assert not flags

    def test_total_penny_rounding(self):
        total, flags = verify_total(Decimal("99.99"), Decimal("18.00"), Decimal("117.99"))
        assert total == Decimal("117.99")
        assert not flags


# ---------------------------------------------------------------------------
# Full pipeline post-processing
# ---------------------------------------------------------------------------

class TestPostProcess:

    def test_clean_record_no_flags(self):
        record = make_record()
        verified, flags = post_process(record)
        assert not flags
        assert verified.total == Decimal("590.00")

    def test_hallucinated_total_caught(self):
        record = make_record(total=Decimal("999.00"))  # Wrong total
        verified, flags = post_process(record)
        assert any("HIGH SEVERITY" in f for f in flags)
        assert verified.total == Decimal("590.00")  # Corrected

    def test_date_normalized(self):
        record = make_record(invoice_date="26.05.2025")
        verified, flags = post_process(record)
        assert verified.invoice_date == "2025-05-26"

    def test_processing_flags_attached(self):
        record = make_record(total=Decimal("600.00"))
        verified, flags = post_process(record)
        assert len(verified._validation_flags) > 0
        assert flags == verified._validation_flags

    def test_multiple_errors_all_caught(self):
        record = make_record(
            total=Decimal("999.00"),       # Wrong total
            invoice_date="not-a-date",     # Bad date
        )
        verified, flags = post_process(record)
        assert len(flags) >= 2
        flag_types = " ".join(flags)
        assert "HIGH SEVERITY" in flag_types
        assert "UNPARSEABLE" in flag_types


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
