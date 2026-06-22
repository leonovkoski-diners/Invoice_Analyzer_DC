# Invoice Analyzer — Claude Code Reference

## Project Overview
Internal invoice processing dashboard for automating accounts payable workflow.
Invoices arrive physically (scanned) or digitally. The system extracts data using
a local VLM (Qwen3-VL-2B-Instruct via llama-cpp-python), validates it deterministically,
and exports to Zonel Helix-K via .xlsx import.

## Stack
- **Frontend:** React + Vite + Tailwind CSS + React Router + Recharts
- **Backend:** FastAPI (Python 3.11+)
- **ML Pipeline:** llama-cpp-python (Qwen3-VL-2B-Instruct Q4_K_M + mmproj projector, fully local)
- **Database:** Supabase (self-hosted)
- **Export:** openpyxl → Helix-K .xlsx import format

## Project Structure
invoice_analyzer_DC/

├── pipeline/

│   ├── schema.py          # Pydantic InvoiceRecord + LineItem data contract

│   ├── extractor.py       # VLM engine, PDF→image, multi-page merge

│   ├── post_processor.py  # Deterministic math/date verification (critical)

│   └── pipeline.py        # Orchestrator

├── exports/

│   └── helix_export.py    # Helix-K .xlsx export engine

├── tests/

│   └── test_post_processor.py  # 31 passing unit tests

└── app/              # React + Vite app (Claude Design prototype)

## ML Pipeline — Critical Rules
- The AI model NEVER has the final word on arithmetic
- post_processor.py independently recalculates ALL math
- Any discrepancy > €0.01 is flagged before export
- temperature=0 on all VLM inference — no randomness
- No data ever leaves the local machine — fully air-gapped

## Helix-K Export Column Order (do not change)
Supplier Name → VAT ID → Invoice Ref → Invoice Date (DD/MM/YYYY) →
Due Date → Currency → Net Amount → VAT Rate (%) → VAT Amount →
Gross Amount → Payment Reference → _Validation Flags (audit column)

## Invoice Detail View
Renders only fields actually extracted by the model — no fixed field list.
Grouped by category: Vendor / Invoice / Amounts / Line Items / Payment.
Each group maps directly to Helix-K import columns.
Amber highlight on validation warnings, red on HIGH SEVERITY flags.

## Payment Schedule
Invoices are paid every Friday. The payment schedule view shows all
approved invoices grouped by the next Friday payment run.

## Key Rules for Claude Code
- Never skip the post_processor.py verification step before export
- All monetary values use Python Decimal — never float
- Dates are normalized to ISO 8601 internally, converted to DD/MM/YYYY only on Helix export
- Run pytest tests/test_post_processor.py before any pipeline changes
- Frontend talks to backend via FastAPI REST API
- No external API calls at runtime — everything runs on one server