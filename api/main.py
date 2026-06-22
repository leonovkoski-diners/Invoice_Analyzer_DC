"""
Invoice Analyzer — FastAPI Extraction Service (OCR Edition)
============================================================
Thin HTTP layer over the local OCR pipeline. The frontend uploads a document
here; this service runs OCR (EasyOCR) + template/heuristic extraction +
deterministic post-processing and returns the verified InvoiceRecord.

Design constraints:
- Everything runs locally. No document data leaves the machine.
- The service never fabricates data.

No model files required. EasyOCR downloads its language models (~300 MB)
automatically on first use and caches them in ~/EasyOCR.

Run (from the repo root):
    pip install -r requirements.txt
    uvicorn api.main:app --port 8000
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from pipeline.pipeline import InvoicePipeline
from pipeline.schema import InvoiceRecord
from pipeline.templates import delete_template, load_templates, upsert_template

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Single shared pipeline instance (stateless — no model weights to load)
# ---------------------------------------------------------------------------

_pipeline = InvoicePipeline()


# ---------------------------------------------------------------------------
# Startup: warm up EasyOCR reader so the first request is fast
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Warming up EasyOCR reader (downloads mk+en models if needed)...")
    try:
        from pipeline.ocr import get_reader
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, get_reader)
        logger.info("EasyOCR reader ready.")
    except Exception as exc:
        logger.warning(f"EasyOCR warmup failed (will retry on first request): {exc}")

    logger.info("Loading Komitent and Konten Plan lookup tables...")
    try:
        from pipeline.lookup import init_lookups
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, init_lookups)
        logger.info("Lookup tables ready.")
    except Exception as exc:
        logger.warning(f"Lookup table init failed (will retry on first use): {exc}")

    yield
    logger.info("Service shutting down.")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Invoice Analyzer Extraction API", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------

def _num(v: Optional[Decimal]) -> Optional[float]:
    return None if v is None else float(v)


def serialize_record(record: InvoiceRecord) -> dict[str, Any]:
    return {
        "vendor_name": record.vendor_name,
        "invoice_number": record.invoice_number,
        "invoice_date": record.invoice_date,
        "line_items": [
            {
                "description": li.description,
                "quantity": _num(li.quantity),
                "unit_price": _num(li.unit_price),
                "line_total": _num(li.line_total),
                "vat_rate": _num(li.vat_rate),
            }
            for li in record.line_items
        ],
        "total": _num(record.total),
        "komitent_id": record.komitent_id,
        "komitent_name": record.komitent_name,
        "komitent_low_confidence": record.komitent_low_confidence,
    }


# ---------------------------------------------------------------------------
# Routes — health
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict[str, Any]:
    """Report whether the OCR engine and templates are ready."""
    from pipeline.ocr import _reader as ocr_reader
    templates = load_templates()
    return {
        "ok": True,
        "ready": True,
        "engine": "local_ocr",
        "ocr_engine": "easyocr",
        "ocr_ready": ocr_reader is not None,
        "template_count": len(templates),
    }


# ---------------------------------------------------------------------------
# Routes — extraction
# ---------------------------------------------------------------------------

@app.post("/api/extract")
async def extract(file: UploadFile = File(...)) -> JSONResponse:
    """
    Run the local OCR pipeline on an uploaded document and return the verified
    record + validation flags. Returns 422 if extraction fails.
    """
    suffix = Path(file.filename or "upload").suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _pipeline.process, tmp_path)

        if not result.success:
            return JSONResponse(
                status_code=422,
                content={
                    "error": "extraction_failed",
                    "message": result.error or "Extraction failed.",
                    "flags": result.flags,
                },
            )

        # Build extraction_method label
        if result.template_used:
            tmpl = next((t for t in load_templates() if t["id"] == result.template_used), None)
            method_label = f"template:{result.template_used}"
            template_name = tmpl["display_name"] if tmpl else result.template_used
        else:
            method_label = "heuristic_ocr"
            template_name = None

        return JSONResponse(
            content={
                "record": serialize_record(result.record),
                "flags": result.flags,
                "page_count": result.page_count,
                "processing_time_seconds": round(result.processing_time_seconds, 2),
                "extraction_method": method_label,
                "template_used": result.template_used,
                "template_name": template_name,
                "ocr_text": result.ocr_text,
                "file_name": file.filename,
            }
        )
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Routes — OCR text only (for template creation debug)
# ---------------------------------------------------------------------------

@app.post("/api/ocr-text")
async def ocr_text_only(file: UploadFile = File(...)) -> JSONResponse:
    """
    Run OCR and return raw text. No field extraction.
    Used by the Template Manager to help write regex patterns.
    """
    from pipeline.ocr import extract_text_from_file

    suffix = Path(file.filename or "upload").suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        loop = asyncio.get_event_loop()
        ocr_result = await loop.run_in_executor(None, extract_text_from_file, tmp_path)
        return JSONResponse(content={
            "full_text": ocr_result["full_text"],
            "page_count": ocr_result["page_count"],
        })
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Routes — vendor templates CRUD
# ---------------------------------------------------------------------------

@app.get("/api/templates")
def list_templates_route() -> dict[str, Any]:
    return {"templates": load_templates()}


@app.post("/api/templates")
def create_or_update_template(body: dict = Body(...)) -> dict[str, Any]:
    if not body.get("display_name"):
        raise HTTPException(status_code=422, detail="display_name is required")
    saved = upsert_template(body)
    return {"template": saved}


@app.delete("/api/templates/{template_id}")
def remove_template(template_id: str) -> dict[str, Any]:
    deleted = delete_template(template_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")
    return {"deleted": True, "id": template_id}


@app.post("/api/templates/analyze-keyword")
def analyze_keyword_route(body: dict = Body(...)) -> dict[str, Any]:
    """
    Analyze a keyword (or comma-separated list of keywords) against OCR text.
    Finds the value that follows each keyword, classifies its type, and returns
    a generated regex pattern. Used by the template editor for real-time smart
    pattern building.
    """
    import traceback
    from pipeline.templates import analyze_keyword_for_field, _keyword_to_regex
    kw = body.get("keywords", "")
    ocr = body.get("ocr_text", "")
    print(f"\n[analyze-keyword] kw={repr(kw)}")
    print(f"[analyze-keyword] kw chars: {[(i, hex(ord(c)), repr(c)) for i, c in enumerate(kw)]}")
    try:
        rx = _keyword_to_regex(kw.split(',')[0].strip()) if kw else ''
        print(f"[analyze-keyword] regex={rx!r}")
    except Exception as e:
        print(f"[analyze-keyword] regex ERROR: {e}")
        traceback.print_exc()
    try:
        result = analyze_keyword_for_field(kw, ocr)
        print(f"[analyze-keyword] result={result}")
        return result
    except Exception as e:
        print(f"[analyze-keyword] EXCEPTION: {e}")
        traceback.print_exc()
        raise


@app.post("/api/templates/save-from-invoice")
def save_template_from_invoice(body: dict = Body(...)) -> dict[str, Any]:
    """
    Auto-generate a vendor template from a successfully reviewed invoice.
    The frontend sends the OCR text + current field values; this endpoint
    finds anchor context around each value and stores vendor-specific patterns.
    """
    from pipeline.templates import generate_template_patterns

    display_name = (body.get("display_name") or "").strip()
    if not display_name:
        raise HTTPException(status_code=422, detail="display_name is required")

    keywords = body.get("keywords") or [display_name]
    ocr_text = body.get("ocr_text") or ""
    extracted = body.get("extracted") or {}

    patterns = generate_template_patterns(ocr_text, extracted)

    template = {
        "display_name": display_name,
        "keywords": [k for k in keywords if k and len(k.strip()) > 1],
        "currency": "MKD",
        "source": "user_saved",
        "patterns": patterns,
    }
    saved = upsert_template(template)
    logger.info(f"User saved template '{display_name}' with {len(patterns)} auto-generated patterns")
    return {"template": saved}
