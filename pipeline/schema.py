"""
Invoice Analyzer — Data Schema (Minimal)
=========================================
The InvoiceRecord is the canonical contract between the OCR extraction layer
and the export layer. Only the fields that matter for accounting are here.
The AI model never has the final word on arithmetic.
"""

from __future__ import annotations

from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator
import re


class LineItem(BaseModel):
    """A single payable line on the invoice — always carries the GROSS amount."""

    description: str = Field(..., description="Product or service description")
    quantity: Decimal = Field(..., description="Quantity")
    unit_price: Decimal = Field(..., description="Gross unit price (including VAT)")
    line_total: Decimal = Field(..., description="Gross line total (including VAT)")
    vat_rate: Optional[Decimal] = Field(None, description="VAT rate if known; None means line_total is already the gross payable amount")

    @field_validator("quantity", "unit_price", "line_total", mode="before")
    @classmethod
    def coerce_decimal(cls, v):
        """Accept strings like '1.234,56' or '1,234.56' and convert to Decimal."""
        if isinstance(v, str):
            v = v.strip().replace(" ", "")
            if re.match(r"^\d+,\d{3}$", v):
                v = v.replace(",", "")
            elif re.match(r"^\d{1,3}(\.\d{3})*(,\d+)?$", v):
                v = v.replace(".", "").replace(",", ".")
            else:
                v = v.replace(",", "")
            if not v or v in (".", "-", "+"):
                return Decimal("0")
        try:
            return Decimal(str(v))
        except Exception:
            return Decimal("0")


class InvoiceRecord(BaseModel):
    """
    The canonical invoice object — minimal fields only.
    Created by the OCR extraction layer, verified by post_processor.py.
    """

    # ── Vendor ──────────────────────────────────────────────────────────────
    vendor_name: str = Field(..., description="Supplier / vendor company name")

    # ── Invoice identity ────────────────────────────────────────────────────
    invoice_number: str = Field(..., description="Invoice number / reference")
    invoice_date: str = Field(
        ..., description="Invoice date — raw string, normalized by post-processor"
    )

    # ── Financials ──────────────────────────────────────────────────────────
    line_items: List[LineItem] = Field(..., min_length=1)
    total: Decimal = Field(..., description="Gross total — the final amount to pay")

    # ── Komitent ─────────────────────────────────────────────────────────────
    komitent_id: Optional[str] = Field(None, description="Matched komitent ID from the registry")
    komitent_name: Optional[str] = Field(None, description="Matched komitent name from the registry")
    komitent_low_confidence: bool = Field(False, description="True when komitent match score is 45–59% (show amber in UI)")

    # ── Internal audit ──────────────────────────────────────────────────────
    _validation_flags: List[str] = []

    @field_validator("total", mode="before")
    @classmethod
    def coerce_decimal(cls, v):
        if isinstance(v, str):
            v = v.strip().replace(" ", "")
            if re.match(r"^\d+,\d{3}$", v):
                v = v.replace(",", "")
            elif re.match(r"^\d{1,3}(\.\d{3})*(,\d+)?$", v):
                v = v.replace(".", "").replace(",", ".")
            else:
                v = v.replace(",", "")
            if not v or v in (".", "-", "+"):
                return Decimal("0")
        try:
            return Decimal(str(v))
        except Exception:
            return Decimal("0")

    @field_validator("vendor_name")
    @classmethod
    def normalize_vendor_name(cls, v: str) -> str:
        return v.strip()

    @field_validator("invoice_number")
    @classmethod
    def normalize_invoice_number(cls, v: str) -> str:
        return v.strip()

    model_config = {
        "populate_by_name": True,
    }
