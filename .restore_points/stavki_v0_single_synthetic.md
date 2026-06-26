# Restore Point: Single Synthetic Item (no stavki parsing)

**Date:** 2026-06-26  
**Commit baseline:** d0c2921 (current HEAD)

## What this state is

`extract_line_items` always returns one row = invoice total.  
All stavki-parsing code deleted. Two-row journal: one debit + 2200 credit.  
This is the STABLE, WORKING baseline.

## Key code state in pipeline/heuristic.py

```python
def extract_line_items(total: Optional[Decimal]) -> List[Dict]:
    """Single synthetic line item from the invoice total."""
    gross = total or Decimal('0')
    return [{
        'description': 'Услуги / Services',
        'quantity': Decimal('1'),
        'unit_price': gross,
        'line_total': gross,
        'vat_rate': None,
    }]
```

`extract_from_text` financial section:
```python
total = Decimal("0")
try:
    financials = extract_financial_totals(full_text, lines)
    total = financials.get("total") or Decimal("0")
except Exception as exc:
    logger.warning("financial totals extraction failed: %s", exc)

line_items = extract_line_items(total if total > 0 else None)
```

## Deleted (compared to earlier versions)
- `_ROW_NUM_RE`, `_ITEM_AMT_SCAN_RE`, `_ITEM_HEADER_ROW_RE`, `_ITEM_TOTALS_ROW_RE`
- `_parse_item_amt()`
- `_parse_table_row()`
- `_extract_line_items_from_pdf_tables()`
- `_try_parse_line_items()`

## To restore
Revert `pipeline/heuristic.py` to this state — `extract_line_items` takes only `total`,
returns one dict, and `extract_from_text` only extracts totals.
