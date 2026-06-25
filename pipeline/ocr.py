"""
Invoice Analyzer — EasyOCR Text Extraction Engine
==================================================
Replaces the VLM (Qwen3VL / llama-cpp-python) with a deterministic local OCR
pipeline:
  1. pdf2image: rasterize PDF pages to PIL Images
  2. EasyOCR: extract text using deep-learning OCR (Macedonian + English)
  3. Spatial grouping: reconstruct visual rows from bounding-box coordinates
     so that "струја  6381.65" on the same visual line is joined, not split

No LLM calls, no network requests, no GPU required.
EasyOCR downloads its language models (~300 MB) automatically on first use.
"""
from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy EasyOCR reader — initialized once and reused for all requests
# ---------------------------------------------------------------------------

_reader = None


def get_reader():
    """Return the shared EasyOCR reader, initializing it on first call."""
    global _reader
    if _reader is None:
        try:
            import easyocr
        except ImportError as e:
            raise ImportError(
                "easyocr is required. Install with: pip install easyocr\n"
                "The Macedonian language model (~300 MB) downloads automatically."
            ) from e
        logger.info("Initializing EasyOCR reader (bg + rs_cyrillic + en) — may download models on first run...")
        # Macedonian is not in EasyOCR's language list. Bulgarian (bg) covers ~95%
        # of the Macedonian Cyrillic alphabet; Serbian Cyrillic (rs_cyrillic) adds
        # the remaining Macedonian-specific characters (ѓ ѕ ј љ њ ќ џ).
        _reader = easyocr.Reader(["bg", "rs_cyrillic", "en"], gpu=False, verbose=False)
        logger.info("EasyOCR reader ready.")
    return _reader


# ---------------------------------------------------------------------------
# Poppler discovery (needed by pdf2image on Windows)
# ---------------------------------------------------------------------------

def find_poppler_path() -> Optional[str]:
    import glob as glob_mod

    exe = "pdfinfo.exe" if os.name == "nt" else "pdfinfo"

    def resolve(candidate: Path) -> Optional[str]:
        d = candidate if candidate.is_dir() else candidate.parent
        return str(d) if (d / exe).exists() else None

    bases: List[str] = []
    env = os.environ.get("POPPLER_PATH")
    if env:
        bases.append(env)
    if os.name == "nt":
        bases += [r"C:\poppler", r"C:\Program Files\poppler", r"C:\Program Files (x86)\poppler"]

    for base in bases:
        base_path = Path(base)
        for direct in (base_path, base_path / "bin", base_path / "Library" / "bin"):
            found = resolve(direct)
            if found:
                return found
        for hit in glob_mod.glob(str(base_path / "**" / exe), recursive=True):
            return str(Path(hit).parent)

    return None


# ---------------------------------------------------------------------------
# PDF → PIL images
# ---------------------------------------------------------------------------

def pdf_to_pil_images(pdf_path: str | Path, dpi: int = 500) -> list:
    """Rasterize a PDF to a list of PIL Images at the given DPI."""
    try:
        from pdf2image import convert_from_path
    except ImportError as e:
        raise ImportError("pdf2image required: pip install pdf2image") from e

    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"Invoice PDF not found: {pdf_path}")

    poppler_path = find_poppler_path()
    if poppler_path:
        logger.info(f"Using poppler at: {poppler_path}")
    else:
        logger.warning("poppler not auto-detected — relying on PATH")

    logger.info(f"Rasterizing PDF: {pdf_path.name} at {dpi} DPI...")
    pages = convert_from_path(str(pdf_path), dpi=dpi, poppler_path=poppler_path)
    logger.info(f"PDF rasterized: {len(pages)} page(s)")
    return pages


def image_to_pil(image_path: str | Path):
    """Load an image file as an RGB PIL Image."""
    from PIL import Image
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")
    img = Image.open(image_path)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img


# ---------------------------------------------------------------------------
# OCR a single PIL image
# ---------------------------------------------------------------------------

def _preprocess_for_ocr(pil_image):
    return pil_image.convert("L").convert("RGB")


def ocr_pil_image(pil_image, page_num: int = 1) -> dict:
    """
    Run EasyOCR on a PIL Image and return structured per-page results.

    Bounding boxes are grouped into visual rows (segments within ROW_TOLERANCE
    pixels vertically are on the same line).  Within each row segments are
    sorted left-to-right and joined with a space, reconstructing the natural
    reading order that a table layout would have had.

    Returns:
        {
            "page": int,
            "text": str,          # full page text as newline-joined rows
            "lines": list[str],   # one entry per visual row
            "raw": list[(str, float)],  # (text, confidence) for all segments
        }
    """
    ROW_TOLERANCE = 18  # pixels — segments within this vertical distance → same row

    reader = get_reader()
    pil_image = _preprocess_for_ocr(pil_image)

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        pil_image.save(tmp.name, "PNG")
        tmp_path = tmp.name

    try:
        raw_results = reader.readtext(tmp_path, detail=1)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    # Filter low-confidence segments
    raw_results = [(bbox, text, conf) for bbox, text, conf in raw_results if conf > 0.25]

    # Sort primarily by vertical center, secondarily by horizontal left edge
    def sort_key(r):
        bbox = r[0]
        y_center = (bbox[0][1] + bbox[2][1]) / 2
        x_left = bbox[0][0]
        return (y_center, x_left)

    raw_results.sort(key=sort_key)

    # Group into visual rows
    rows: list[list] = []
    current_row: list = []
    last_y: Optional[float] = None

    for bbox, text, conf in raw_results:
        y_center = (bbox[0][1] + bbox[2][1]) / 2
        if last_y is None or abs(y_center - last_y) <= ROW_TOLERANCE:
            current_row.append((bbox, text, conf))
            # Update last_y to running average so long rows don't drift
            last_y = y_center if last_y is None else (last_y + y_center) / 2
        else:
            if current_row:
                rows.append(current_row)
            current_row = [(bbox, text, conf)]
            last_y = y_center

    if current_row:
        rows.append(current_row)

    # Build text lines
    lines: list[str] = []
    for row in rows:
        row.sort(key=lambda r: r[0][0][0])  # sort by x
        line_text = " ".join(seg[1] for seg in row).strip()
        if line_text:
            lines.append(line_text)

    full_text = "\n".join(lines)
    raw_flat = [(text, round(conf, 3)) for _, text, conf in raw_results]

    logger.info(f"Page {page_num}: OCR extracted {len(lines)} visual lines from {len(raw_results)} segments")
    return {
        "page": page_num,
        "text": full_text,
        "lines": lines,
        "raw": raw_flat,
    }


# ---------------------------------------------------------------------------
# Full file pipeline
# ---------------------------------------------------------------------------

def _extract_pdf_text_layer(file_path: Path) -> dict | None:
    """
    Try to extract text directly from the PDF embedded text layer via pdfplumber.
    Returns the same structure as EasyOCR results if extraction yields >= 100 chars,
    otherwise returns None so the caller falls back to EasyOCR.
    """
    try:
        import pdfplumber
    except ImportError:
        logger.warning("pdfplumber not installed — skipping PDF text layer extraction")
        return None

    try:
        with pdfplumber.open(str(file_path)) as pdf:
            pages = []
            for i, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                lines = [ln for ln in text.splitlines() if ln.strip()]
                pages.append({
                    "page": i,
                    "text": "\n".join(lines),
                    "lines": lines,
                    "raw": [],
                })

        total_chars = sum(len(p["text"].strip()) for p in pages)
        if total_chars < 100:
            logger.info(f"PDF text layer too short ({total_chars} chars) — falling back to EasyOCR")
            return None

        page_texts = []
        for p in pages:
            if len(pages) > 1:
                page_texts.append(f"--- Page {p['page']} ---\n{p['text']}")
            else:
                page_texts.append(p["text"])
        full_text = "\n\n".join(page_texts)

        logger.info(f"PDF text layer extracted: {len(pages)} page(s), {total_chars} chars")
        return {
            "pages": pages,
            "full_text": full_text,
            "page_count": len(pages),
            "extraction_method": "pdf_text_layer",
        }
    except Exception as exc:
        logger.warning(f"pdfplumber extraction failed: {exc} — falling back to EasyOCR")
        return None


def extract_text_from_file(file_path: str | Path) -> dict:
    """
    Extraction pipeline: file → per-page text → merged full text.

    For PDFs, attempts text layer extraction first (pdfplumber); falls back to
    EasyOCR only if the PDF has no embedded text or it is too short to be useful.
    Image files always use EasyOCR.

    Returns:
        {
            "pages": [{"page": int, "text": str, "lines": list, "raw": list}],
            "full_text": str,
            "page_count": int,
            "extraction_method": "pdf_text_layer" | "easyocr",
        }
    """
    file_path = Path(file_path)
    suffix = file_path.suffix.lower()
    dpi = int(os.environ.get("INVOICE_OCR_DPI", "500"))

    if suffix == ".pdf":
        text_layer = _extract_pdf_text_layer(file_path)
        if text_layer is not None:
            return text_layer
        pil_images = pdf_to_pil_images(file_path, dpi=dpi)
    elif suffix in {".png", ".jpg", ".jpeg", ".tiff", ".bmp"}:
        pil_images = [image_to_pil(file_path)]
    else:
        raise ValueError(f"Unsupported file type: {suffix}. Supported: PDF, PNG, JPG, JPEG, TIFF, BMP")

    pages = []
    for i, img in enumerate(pil_images, start=1):
        pages.append(ocr_pil_image(img, page_num=i))

    page_texts = []
    for p in pages:
        if len(pages) > 1:
            page_texts.append(f"--- Page {p['page']} ---\n{p['text']}")
        else:
            page_texts.append(p["text"])

    full_text = "\n\n".join(page_texts)
    logger.info(f"EasyOCR complete: {len(pages)} page(s), {len(full_text)} chars")

    return {
        "pages": pages,
        "full_text": full_text,
        "page_count": len(pages),
        "extraction_method": "easyocr",
    }
