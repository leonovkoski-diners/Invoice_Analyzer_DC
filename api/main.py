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
from pipeline.templates import delete_template, load_templates, save_templates, upsert_template

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

    logger.info("KontoLearner will initialise on first extract request (lazy — model is ~470 MB).")

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
            template_defaults = tmpl.get("defaults", {}) if tmpl else {}
        else:
            method_label = "heuristic_ocr"
            template_name = None
            template_defaults = {}

        # Konto suggestion — embedding-based, with keyword rules as fallback.
        # Runs in executor because the sentence-transformers model is CPU-bound
        # and loads lazily on first call.
        suggested_konto = "4499"
        konto_method = "default"
        konto_confidence = 0.0
        try:
            from pipeline.lookup import get_konto_learner, get_konten_plan_lookup
            learner = get_konto_learner()
            keyword_fn = get_konten_plan_lookup().suggest_konto
            suggested_konto, konto_method, konto_confidence = await loop.run_in_executor(
                None, learner.suggest, result.ocr_text, keyword_fn
            )
        except Exception as exc:
            logger.warning("Konto suggestion failed (will use default 4499): %s", exc)

        return JSONResponse(
            content={
                "record": serialize_record(result.record),
                "flags": result.flags,
                "page_count": result.page_count,
                "processing_time_seconds": round(result.processing_time_seconds, 2),
                "extraction_method": method_label,
                "template_used": result.template_used,
                "template_name": template_name,
                "template_defaults": template_defaults,
                "ocr_text": result.ocr_text,
                "file_name": file.filename,
                "suggested_konto": suggested_konto,
                "konto_method": konto_method,
                "konto_confidence": round(konto_confidence, 3),
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
# Routes — komitent lookup
# ---------------------------------------------------------------------------

@app.get("/api/komitent/lookup")
def komitent_lookup_route(sifra: Optional[str] = None, name: Optional[str] = None) -> dict[str, Any]:
    """Lookup a komitent by exact sifra (ID) or fuzzy name.
    Returns { match: {id, name} } or { match: null }.
    """
    from pipeline.lookup import get_komitent_lookup
    lookup = get_komitent_lookup()
    if sifra and sifra.strip():
        result = lookup.lookup_by_id(sifra.strip())
        return {"match": result}
    if name and name.strip():
        result = lookup.match(name.strip())
        if result:
            return {"match": {"id": result["id"], "name": result["name"]}}
    return {"match": None}


# ---------------------------------------------------------------------------
# Routes — searchable lookup (konto plan + komitent list)
# ---------------------------------------------------------------------------

@app.get("/api/lookup/konto")
def konto_search_route(q: str = "") -> dict[str, Any]:
    """Search konto plan by code or description substring. Returns up to 8 matches."""
    if not q or len(q.strip()) < 2:
        return {"results": []}
    from pipeline.lookup import get_konten_plan_lookup
    lookup = get_konten_plan_lookup()
    return {"results": lookup.search(q.strip(), max_results=8)}


@app.get("/api/lookup/komitent")
def komitent_search_route(q: str = "") -> dict[str, Any]:
    """Search komitent list by name substring. Returns up to 8 matches."""
    if not q or len(q.strip()) < 2:
        return {"results": []}
    from pipeline.lookup import get_komitent_lookup
    lookup = get_komitent_lookup()
    return {"results": lookup.search(q.strip(), max_results=8)}


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


@app.post("/api/templates/{template_id}/defaults")
def set_template_default(template_id: str, body: dict = Body(...)) -> dict[str, Any]:
    """Set or clear default values for a vendor template field.

    Accepts two formats:
    - Single field: { "field": "vendor_name", "value": "..." }
    - Batch:        { "defaults": { "vendor_name": "...", "komitent_name": "..." } }
    """
    _ALLOWED = {"vendor_name", "komitent_name", "komitent_sifra"}

    templates = load_templates()
    idx = next((i for i, t in enumerate(templates) if t["id"] == template_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")
    tmpl = dict(templates[idx])
    d = dict(tmpl.get("defaults", {}))

    if "defaults" in body:
        # Batch mode
        updates = body["defaults"]
        if not isinstance(updates, dict):
            raise HTTPException(status_code=422, detail="defaults must be an object")
        invalid = set(updates.keys()) - _ALLOWED
        if invalid:
            raise HTTPException(status_code=422, detail=f"Unknown default fields: {sorted(invalid)}")
        for field, value in updates.items():
            if value:
                d[field] = value
            else:
                d.pop(field, None)
        logger.info("Template '%s': batch defaults updated: %r", template_id, d)
    else:
        # Single-field mode (used by pin/unpin in the review UI)
        field = body.get("field")
        value = body.get("value")
        if not field or field not in _ALLOWED:
            raise HTTPException(status_code=422, detail=f"field must be one of {sorted(_ALLOWED)}")
        if value:
            d[field] = value
        else:
            d.pop(field, None)
        logger.info("Template '%s': default '%s' = %r", template_id, field, value)

    if d:
        tmpl["defaults"] = d
    elif "defaults" in tmpl:
        del tmpl["defaults"]
    templates[idx] = tmpl
    save_templates(templates)
    return {"template": tmpl}


@app.post("/api/konto-correction")
async def save_konto_correction(body: dict = Body(...)) -> dict[str, Any]:
    """
    Record a human-confirmed konto for a given invoice's OCR text.
    Called automatically when an accountant approves an invoice — the final
    konto from the journal is sent here so the system learns from the correction.

    Body: { ocr_text: str, konto: str, komitent_id?: str }
    """
    ocr_text = (body.get("ocr_text") or "").strip()
    konto = (body.get("konto") or "").strip()
    komitent_id = body.get("komitent_id") or None

    if not ocr_text or not konto:
        raise HTTPException(status_code=422, detail="ocr_text and konto are required")

    try:
        from pipeline.lookup import get_konto_learner
        learner = get_konto_learner()
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, learner.learn, ocr_text, konto, komitent_id)
        return {
            "saved": True,
            "konto": konto,
            "total_corrections": learner.correction_count(),
        }
    except Exception as exc:
        logger.warning("konto-correction save failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/templates/save-from-invoice")
def save_template_from_invoice(body: dict = Body(...)) -> dict[str, Any]:
    """
    Auto-generate a vendor template from a successfully reviewed invoice.
    The frontend sends the OCR text + current field values; this endpoint
    extracts the vendor's EDB/VAT number from the OCR text and stores it as
    the template identifier, together with vendor-specific field patterns.
    """
    from pipeline.templates import generate_template_patterns, extract_vat_number

    display_name = (body.get("display_name") or "").strip()
    if not display_name:
        raise HTTPException(status_code=422, detail="display_name is required")

    ocr_text = body.get("ocr_text") or ""
    extracted = body.get("extracted") or {}
    raw_defaults = body.get("defaults") or {}
    keywords = [k.strip() for k in (body.get("keywords") or []) if str(k).strip()]

    vat_number = extract_vat_number(ocr_text)
    patterns = generate_template_patterns(ocr_text, extracted)

    _ALLOWED = {"vendor_name", "komitent_name", "komitent_sifra"}
    clean_defaults = {
        k: str(v).strip()
        for k, v in raw_defaults.items()
        if k in _ALLOWED and v and str(v).strip()
    }

    template: dict[str, Any] = {
        "display_name": display_name,
        "vat_number": vat_number or "",
        "keywords": keywords,
        "currency": "MKD",
        "source": "user_saved",
        "patterns": patterns,
    }
    if clean_defaults:
        template["defaults"] = clean_defaults

    saved = upsert_template(template)
    logger.info(
        "User saved template '%s' (VAT: %s) with %d patterns and defaults: %r",
        display_name, vat_number, len(patterns), clean_defaults,
    )
    return {"template": saved}
