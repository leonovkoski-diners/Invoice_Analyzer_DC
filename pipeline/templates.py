"""
Invoice Analyzer — Vendor Template System
==========================================
Templates provide 100% deterministic field extraction for recurring vendors.
Each template encodes:
  - keywords: strings that identify this vendor in the OCR text
  - patterns: per-field regex patterns specific to this vendor's layout

Templates are stored as JSON in templates/vendors.json and managed via
the /api/templates REST endpoints. The heuristic extractor is used as a
fallback for any field whose template pattern is absent or fails to match.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional

from pipeline.heuristic import (
    parse_amount,
    extract_vendor_name,
    extract_invoice_number,
    extract_dates,
    extract_line_items,
)

logger = logging.getLogger(__name__)

TEMPLATES_FILE = Path(__file__).resolve().parents[1] / "templates" / "vendors.json"

# ---------------------------------------------------------------------------
# YOUR COMPANY'S VAT / EDB NUMBER
# Set this to your own company's EDB so it is never picked up as a vendor VAT.
# Digits only (МК/MK prefix is stripped automatically).
# ---------------------------------------------------------------------------
_OWN_COMPANY_VAT: str = "4030992100592"


# ---------------------------------------------------------------------------
# Built-in default templates
# ---------------------------------------------------------------------------

def _default_templates() -> List[Dict]:
    return []


# ---------------------------------------------------------------------------
# CRUD helpers
# ---------------------------------------------------------------------------

def load_templates() -> List[Dict]:
    """Load templates from disk. Creates defaults if file missing."""
    if not TEMPLATES_FILE.exists():
        defaults = _default_templates()
        save_templates(defaults)
        return defaults
    try:
        with open(TEMPLATES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load templates: {e}")
        return _default_templates()


def save_templates(templates: List[Dict]) -> None:
    """Persist templates to disk."""
    TEMPLATES_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(TEMPLATES_FILE, "w", encoding="utf-8") as f:
        json.dump(templates, f, ensure_ascii=False, indent=2)
    logger.info(f"Saved {len(templates)} templates")


def get_template_by_id(template_id: str) -> Optional[Dict]:
    return next((t for t in load_templates() if t["id"] == template_id), None)


def upsert_template(template: Dict) -> Dict:
    """Create or update a template. Generates an ID if missing."""
    if not template.get("id"):
        template["id"] = str(uuid.uuid4())[:8]
    templates = load_templates()
    idx = next((i for i, t in enumerate(templates) if t["id"] == template["id"]), None)
    if idx is not None:
        templates[idx] = template
    else:
        templates.append(template)
    save_templates(templates)
    return template


def delete_template(template_id: str) -> bool:
    templates = load_templates()
    new_list = [t for t in templates if t["id"] != template_id]
    if len(new_list) == len(templates):
        return False
    save_templates(new_list)
    return True


# ---------------------------------------------------------------------------
# VAT / EDB number extraction
# ---------------------------------------------------------------------------

# Labels that precede the vendor's tax identification number on Macedonian invoices.
# Listed longest-first so more specific labels are tried before shorter ones.
_EDB_LABEL_KWS = [
    'Единствен даночен број',
    'ДДВ број',
    'даночен број',
    'Даночен број',
    'ЕДБ',
]


def _normalize_vat(vat: str) -> str:
    """Strip whitespace and optional МК/MK prefix, uppercase — gives digits-only for comparison."""
    v = vat.replace(' ', '').upper()
    if v.startswith('МК') or v.startswith('MK'):
        v = v[2:]
    return v


def extract_vat_number(ocr_text: str) -> Optional[str]:
    """Extract the vendor's EDB (13-digit tax ID) from OCR text.

    Tries label-anchored extraction first (Cyrillic/Latin lookalike-tolerant),
    then falls back to any standalone 13-digit run if no label was found.
    Returns digits-only (МК/MK prefix stripped).
    """
    text_norm = unicodedata.normalize('NFC', ocr_text)
    own_vat = _normalize_vat(_OWN_COMPANY_VAT) if _OWN_COMPANY_VAT.strip() else None

    for kw in _EDB_LABEL_KWS:
        try:
            pattern = _keyword_to_regex(kw) + r'\s*[:\-]?\s*((?:[МMМм][КKкк])?\s*\d{10,15})'
            for m in re.finditer(pattern, text_norm, re.IGNORECASE):
                normalized = _normalize_vat(m.group(1))
                if not re.fullmatch(r'\d{10,15}', normalized):
                    continue
                if own_vat and normalized == own_vat:
                    logger.debug("Skipping own-company VAT '%s' found via label '%s'", normalized, kw)
                    continue
                logger.info("VAT extracted via label '%s': %s", kw, normalized)
                return normalized
        except re.error:
            pass

    # Fallback: any standalone 13-digit number — iterate all occurrences, skip own VAT
    for m in re.finditer(r'(?<!\d)(\d{13})(?!\d)', text_norm):
        normalized = m.group(1)
        if own_vat and normalized == own_vat:
            logger.debug("Skipping own-company VAT '%s' found via 13-digit fallback", normalized)
            continue
        logger.info("VAT extracted via 13-digit fallback: %s", normalized)
        return normalized

    return None


# ---------------------------------------------------------------------------
# Template matching
# ---------------------------------------------------------------------------

def find_matching_template(full_text: str) -> Optional[Dict]:
    """Return the template whose vat_number matches the EDB extracted from OCR text.
    Falls back to keyword-based matching if no VAT is found or no template matched by VAT."""
    text_norm = unicodedata.normalize('NFC', full_text)

    # Primary: VAT-based matching
    vat = extract_vat_number(full_text)
    if vat:
        vat_norm = _normalize_vat(vat)
        for template in load_templates():
            tmpl_vat = _normalize_vat(template.get('vat_number') or '')
            if tmpl_vat and tmpl_vat == vat_norm:
                logger.info("Template matched by VAT '%s': '%s' (%s)",
                            vat_norm, template['display_name'], template['id'])
                return template
        logger.info("VAT '%s' found but no template matched — trying keyword fallback", vat_norm)
    else:
        logger.info("No VAT/EDB number extracted — trying keyword fallback")

    # Fallback: keyword-based matching (all keywords must be present in the OCR text)
    for template in load_templates():
        kws_raw = template.get('keywords') or []
        if isinstance(kws_raw, str):
            kws = [k.strip() for k in kws_raw.split(',') if k.strip()]
        else:
            kws = [k.strip() for k in kws_raw if k.strip()]
        if not kws:
            continue
        try:
            matched = all(
                re.search(_keyword_to_regex(unicodedata.normalize('NFC', kw)), text_norm, re.IGNORECASE)
                for kw in kws
            )
            if matched:
                logger.info("Template matched by keywords: '%s' (%s)", template['display_name'], template['id'])
                return template
        except re.error:
            pass

    logger.info("No matching template found — using heuristic extractor")
    return None


# ---------------------------------------------------------------------------
# Template-based field extraction
# ---------------------------------------------------------------------------

def _regex_extract(pattern_str: Optional[str], text: str) -> Optional[str]:
    """Apply a template regex and return the first capture group or full match."""
    if not pattern_str:
        return None
    try:
        m = re.search(pattern_str, text, re.IGNORECASE | re.DOTALL)
        if m:
            return (m.group(1) if m.lastindex else m.group(0)).strip()
    except re.error as e:
        logger.warning(f"Template regex error ({pattern_str!r}): {e}")
    return None


def apply_template(template: Dict, full_text: str, lines: List[str]) -> Dict[str, Any]:
    """
    Extract invoice fields using a vendor-specific template.
    Falls back to heuristic for any field the template misses.
    Each extraction step is individually guarded so one failure never crashes the whole invoice.
    """
    patterns = template.get("patterns", {})
    defaults = template.get("defaults", {})

    # Vendor name — template default takes priority over extraction
    vendor_name = None
    if defaults.get("vendor_name"):
        vendor_name = defaults["vendor_name"]
        logger.info("vendor_name from template default: '%s'", vendor_name)
    else:
        try:
            vendor_name = _regex_extract(patterns.get("vendor_name"), full_text)
            if not vendor_name:
                vendor_name = extract_vendor_name(lines, full_text)
        except Exception as exc:
            logger.warning("vendor_name extraction failed in template: %s", exc)

    # Invoice number
    invoice_number = "N/A"
    try:
        invoice_number = (
            _regex_extract(patterns.get("invoice_number"), full_text)
            or extract_invoice_number(lines, full_text)
            or "N/A"
        )
    except Exception as exc:
        logger.warning("invoice_number extraction failed in template: %s", exc)

    # Invoice date
    invoice_date = ""
    try:
        invoice_date = _regex_extract(patterns.get("invoice_date"), full_text) or ""
        if not invoice_date:
            invoice_date, _ = extract_dates(lines, full_text)
            invoice_date = invoice_date or ""
    except Exception as exc:
        logger.warning("invoice_date extraction failed in template: %s", exc)

    # Total — template regex first, keyword hint second, heuristic last
    total: Optional[Decimal] = None
    keyword_hints = template.get("keyword_hints", {})
    try:
        total_str = _regex_extract(patterns.get("total"), full_text)
        if not total_str and keyword_hints.get("total"):
            kw_norm = unicodedata.normalize('NFC', keyword_hints["total"].strip())
            ocr_norm = unicodedata.normalize('NFC', full_text)
            # Try 1: lookalike-aware regex
            m = re.search(_keyword_to_regex(kw_norm) + r'\s*([\d.,]+)', ocr_norm, re.IGNORECASE)
            if not m:
                # Try 2: literal match (handles case where keyword chars exactly match OCR)
                m = re.search(re.escape(kw_norm) + r'\s*([\d.,]+)', ocr_norm, re.IGNORECASE)
            if not m:
                # Try 3: scan each line for the keyword string, grab first number on that line
                kw_lower = kw_norm.lower()
                for line in ocr_norm.splitlines():
                    if kw_lower in line.lower():
                        after = line[line.lower().index(kw_lower) + len(kw_norm):]
                        nm = re.search(r'([\d][.,\d]+)', after)
                        if nm:
                            m = nm
                        break
            if m:
                total_str = m.group(1)
                logger.info("total via keyword hint '%s': %s", keyword_hints["total"], total_str)
            else:
                logger.warning("keyword hint '%s' not found in OCR text", keyword_hints["total"])
        total = parse_amount(total_str) if total_str else None
    except Exception as exc:
        logger.warning("total pattern extraction failed in template: %s", exc)

    if not total:
        try:
            from pipeline.heuristic import extract_financial_totals
            financials = extract_financial_totals(full_text, lines)
            total = financials.get("total")
        except Exception as exc:
            logger.warning("financial totals fallback failed in template: %s", exc)

    total = total or Decimal("0")

    # Single gross line item built from total
    line_items = extract_line_items(total if total > 0 else None)

    # Komitent lookup
    final_vendor_name = vendor_name or template["display_name"]
    komitent_id: Optional[str] = None
    komitent_name: Optional[str] = None
    komitent_low_confidence: bool = False
    try:
        from pipeline.lookup import get_komitent_lookup
        match = get_komitent_lookup().match(final_vendor_name)
        if match:
            komitent_id   = match["id"]
            komitent_name = match["name"]
            komitent_low_confidence = match.get("low_confidence", False)
    except Exception as _exc:
        logger.debug("Komitent lookup skipped: %s", _exc)

    # Template defaults override lookup results — user confirmed these values
    if defaults.get("komitent_name"):
        komitent_name = defaults["komitent_name"]
        komitent_low_confidence = False
        logger.info("komitent_name from template default: '%s'", komitent_name)
    if defaults.get("komitent_sifra"):
        komitent_id = defaults["komitent_sifra"]
        komitent_low_confidence = False
        logger.info("komitent_sifra from template default: '%s'", komitent_id)

    result: Dict[str, Any] = {
        "vendor_name": final_vendor_name,
        "invoice_number": invoice_number,
        "invoice_date": invoice_date,
        "line_items": line_items,
        "total": total,
        "komitent_id": komitent_id,
        "komitent_name": komitent_name,
        "komitent_low_confidence": komitent_low_confidence,
    }

    logger.info(
        "Template extraction (%s): vendor='%s', inv_no='%s', total=%s",
        template["display_name"], result["vendor_name"],
        result["invoice_number"], result["total"],
    )
    return result


# ---------------------------------------------------------------------------
# Auto-generate template patterns from a successfully-reviewed invoice
# ---------------------------------------------------------------------------

def _find_anchor(ocr_text: str, value_str: str, max_len: int = 50) -> Optional[str]:
    """Return the label text immediately before value_str on its OCR line."""
    idx = ocr_text.find(value_str)
    if idx < 0:
        return None
    line_start = ocr_text.rfind("\n", 0, idx)
    line_start = line_start + 1 if line_start >= 0 else 0
    before = ocr_text[line_start:idx].rstrip()
    anchor = before[-max_len:].strip()
    return anchor if len(anchor) >= 2 else None


def _amount_variants(amount: float) -> List[str]:
    """Generate OCR-style string variants for an amount."""
    if not amount or amount == 0:
        return []
    d = int(amount)
    frac = round((amount - d) * 100)
    variants: List[str] = []
    if d >= 1000:
        t, r = divmod(d, 1000)
        variants += [f"{t}.{r:03d},{frac:02d}", f"{t},{r:03d}.{frac:02d}"]
    variants += [f"{d},{frac:02d}", f"{d}.{frac:02d}"]
    if frac == 0:
        variants.append(str(d))
    return variants


def _date_variants(iso_date: str) -> List[str]:
    """Generate OCR-style date string variants from an ISO date."""
    if not iso_date or len(iso_date) < 8:
        return []
    try:
        parts = iso_date.split("-")
        year, month, day = parts[0], parts[1], parts[2]
        m, d = int(month), int(day)
        return [
            f"{d:02d}.{m:02d}.{year}",
            f"{d}.{m}.{year}",
            f"{d:02d}/{m:02d}/{year}",
            f"{d:02d},{m:02d},{year}",
        ]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Smart keyword-to-regex analyzer
# ---------------------------------------------------------------------------

_ANALYZE_DATE_RE   = re.compile(r'^\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}$')
_ANALYZE_VAT_RE    = re.compile(r'^(?:MK|МК)\d{13}$', re.IGNORECASE)
_ANALYZE_INV_NO_RE = re.compile(r'\d[/\-]\d')
_ANALYZE_AMOUNT_RE = re.compile(r'^\d[\d.,]*$')

# Maps each char to ALL additional chars it might be confused with in OCR output.
# Value is a string of extra chars to include in the character class alongside the key.
# With re.IGNORECASE the class automatically covers case variants too.
_LOOKALIKE_CLASSES: Dict[str, str] = {
    # Uppercase Cyrillic → Latin lookalikes
    'А': 'A',   'В': 'B',   'С': 'C',   'Е': 'E',   'Н': 'H',
    'К': 'K',   'М': 'M',   'О': 'O',   'Р': 'P',   'Т': 'T',   'Х': 'X',
    'У': 'Uy',  # EasyOCR may render as uppercase U or lowercase y
    'П': 'nP',  # EasyOCR renders as lowercase n; uppercase P also seen in some fonts
    'Д': 'D',   # EasyOCR may confuse Д with Latin D
    # Lowercase Cyrillic → Latin lookalikes
    'а': 'a',   'е': 'e',   'о': 'o',   'р': 'p',   'с': 'c',   'х': 'x',
    'у': 'y',   'п': 'n',
    'к': 'k',   # lowercase к ↔ k
    'н': 'hn',  # lowercase н ↔ h or n
    # Latin → Cyrillic (reverse, so pasted OCR text also works as keyword)
    'A': 'А',   'B': 'В',   'C': 'С',   'E': 'Е',   'H': 'Н',
    'K': 'К',   'M': 'М',   'O': 'О',   'P': 'Р',   'T': 'Т',   'X': 'Х',
    'U': 'Уy',  'y': 'УU',  'n': 'Пп',  'D': 'Д',
    'a': 'а',   'e': 'е',   'o': 'о',   'p': 'р',   'c': 'с',   'x': 'х',
    'k': 'к',   'h': 'н',
}


def _keyword_to_regex(kw: str) -> str:
    """Convert a keyword to a regex that matches Cyrillic/Latin lookalikes interchangeably.
    Spaces before punctuation become \\s* (OCR often omits that space).
    Other spaces become \\s+ (tolerates multiple spaces from OCR segment joining)."""
    parts = []
    for i, ch in enumerate(kw):
        if ch == ' ':
            next_ch = kw[i + 1] if i + 1 < len(kw) else ''
            parts.append(r'\s*' if next_ch in ':;-.,)' else r'\s+')
            continue
        extra = _LOOKALIKE_CLASSES.get(ch, '')
        if extra:
            all_chars = ch + extra
            parts.append('[' + ''.join(re.escape(c) for c in all_chars) + ']')
        else:
            parts.append(re.escape(ch))
    return ''.join(parts)


def _analyze_single_keyword(kw: str, ocr_text: str) -> Optional[Dict[str, Any]]:
    """
    Find `kw` in `ocr_text`, walk the tokens that follow, skip initial label
    words until a classifiable value is found, and return the generated regex.
    Returns None if the keyword is not found or no value follows.
    """
    kw = unicodedata.normalize('NFC', kw.strip())
    ocr_text = unicodedata.normalize('NFC', ocr_text)
    try:
        m = re.search(_keyword_to_regex(kw), ocr_text, re.IGNORECASE)
    except re.error:
        return None
    if not m:
        return None

    after_raw = ocr_text[m.end():]
    newline_pos = after_raw.find('\n')
    same_line = (after_raw[:newline_pos] if newline_pos >= 0 else after_raw).strip()

    # If the remainder of the keyword's line is blank, try the next non-empty line
    if not same_line or re.fullmatch(r'[\s.:\-]*', same_line):
        if newline_pos >= 0:
            rest = after_raw[newline_pos:].lstrip('\r\n')
            next_nl = rest.find('\n')
            candidate = (rest[:next_nl] if next_nl >= 0 else rest).strip()
            if candidate and len(candidate) < 100:
                same_line = candidate

    if not same_line:
        return None

    # Walk up to 5 tokens: skip non-value label words, stop at first classifiable value
    tokens = same_line.split()
    intermediate: List[str] = []
    value_type: Optional[str] = None
    capture_group: Optional[str] = None
    extracted_value: Optional[str] = None

    for token in tokens[:5]:
        clean = token.strip('.,;:')
        if _ANALYZE_VAT_RE.match(clean):
            value_type, capture_group, extracted_value = 'vat_id', r'((?:MK|МК)\d{13})', clean
            break
        elif _ANALYZE_DATE_RE.match(clean):
            value_type, capture_group, extracted_value = 'date', r'(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})', clean
            break
        elif _ANALYZE_INV_NO_RE.search(clean):
            value_type, capture_group, extracted_value = 'invoice_number', r'([A-Za-z0-9\/\-\.]{1,30})', clean
            break
        elif _ANALYZE_AMOUNT_RE.match(clean):
            try:
                amt = parse_amount(clean)
                if amt and amt > Decimal('100'):
                    value_type, capture_group, extracted_value = 'amount', r'([\d\.,]+)', clean
                    break
            except Exception:
                pass
            intermediate.append(token)
        else:
            intermediate.append(token)

    if not value_type:
        # Fall back to text classification
        if same_line:
            value_type = 'text'
            capture_group = r'(.+)'
            extracted_value = same_line[:60].rstrip()
            intermediate = []
        else:
            return None

    # Build regex: keyword (+intermediate label words) + separator + capture group
    # Use _keyword_to_regex so the saved pattern also handles Cyrillic/Latin lookalikes
    kw_parts = kw.split()
    escaped_kw = r'\s+'.join(_keyword_to_regex(p) for p in kw_parts)
    if intermediate:
        escaped_inter = r'\s+'.join(re.escape(t) for t in intermediate)
        pattern = escaped_kw + r'\s+' + escaped_inter + r'\s*[:\-]?\s*' + capture_group
    else:
        pattern = escaped_kw + r'\s*[:\-]?\s*' + capture_group

    return {
        'pattern': pattern,
        'value': extracted_value,
        'type': value_type,
        'confidence': 'ok' if value_type != 'text' else 'uncertain',
        'keyword_used': kw,
    }


def analyze_keyword_for_field(keywords_raw: str, ocr_text: str) -> Dict[str, Any]:
    """
    Given comma-separated keywords and OCR text, try each keyword independently,
    classify the value each keyword precedes, and return the highest-confidence
    result together with the generated regex pattern.

    Return shape: {pattern, value, type, confidence, keyword_used}
    Type values: 'invoice_number' | 'date' | 'amount' | 'vat_id' | 'text'
    """
    _EMPTY: Dict[str, Any] = {
        'pattern': None, 'value': None, 'type': None,
        'confidence': 'uncertain', 'keyword_used': None,
    }
    if not keywords_raw or not ocr_text:
        return _EMPTY

    keywords_raw = unicodedata.normalize('NFC', keywords_raw)
    ocr_text = unicodedata.normalize('NFC', ocr_text)
    keywords = [k.strip() for k in keywords_raw.split(',') if k.strip()]
    if not keywords:
        return _EMPTY

    results = [r for r in (_analyze_single_keyword(kw, ocr_text) for kw in keywords) if r]
    if not results:
        # Return debug info so the frontend can show what regex was tried
        debug_patterns = {kw: _keyword_to_regex(kw) for kw in keywords}
        return {**_EMPTY, 'debug_patterns': debug_patterns}

    _priority = {'vat_id': 5, 'date': 4, 'invoice_number': 3, 'amount': 2, 'text': 1}
    return max(results, key=lambda r: _priority.get(r['type'], 0))


# ---------------------------------------------------------------------------

def generate_template_patterns(ocr_text: str, extracted: dict) -> Dict[str, Any]:
    """
    Auto-generate vendor-specific regex patterns by finding each extracted value
    in the OCR text and recording the label/context that precedes it.
    Called when a user saves a reviewed invoice as a template.
    """
    patterns: Dict[str, Any] = {}

    # Invoice number
    inv_no = extracted.get("invoice_number")
    if inv_no and inv_no not in ("N/A", "—", ""):
        anchor = _find_anchor(ocr_text, str(inv_no))
        if anchor:
            patterns["invoice_number"] = (
                re.escape(anchor)
                + r"\s*[:\-]?\s*([A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9][A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9/\-\.]{1,30})"
            )

    # Total
    total = extracted.get("total")
    if total and float(total) > 0:
        for v in _amount_variants(float(total)):
            anchor = _find_anchor(ocr_text, v)
            if anchor and len(anchor) >= 3:
                patterns["total"] = (
                    re.escape(anchor)
                    + r"\s*[:\-]?\s*(?:MKD|MKД|ден\.?)?\s*([\d.,]+)"
                )
                break

    # Subtotal
    subtotal = extracted.get("subtotal")
    if subtotal and float(subtotal) > 0 and subtotal != total:
        for v in _amount_variants(float(subtotal)):
            anchor = _find_anchor(ocr_text, v)
            if anchor and len(anchor) >= 3:
                patterns["subtotal"] = (
                    re.escape(anchor)
                    + r"\s*[:\-]?\s*([\d.,]+)"
                )
                break

    # Invoice date
    inv_date = extracted.get("invoice_date")
    if inv_date:
        for v in _date_variants(str(inv_date)):
            anchor = _find_anchor(ocr_text, v)
            if anchor and len(anchor) >= 2:
                patterns["invoice_date"] = (
                    re.escape(anchor)
                    + r"\s*[:\-]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})"
                )
                break

    # Due date
    due_date = extracted.get("due_date")
    if due_date:
        for v in _date_variants(str(due_date)):
            anchor = _find_anchor(ocr_text, v)
            if anchor and len(anchor) >= 2 and anchor != patterns.get("invoice_date", "")[:20]:
                patterns["due_date"] = (
                    re.escape(anchor)
                    + r"\s*[:\-]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})"
                )
                break

    return patterns
