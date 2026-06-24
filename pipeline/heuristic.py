"""
Invoice Analyzer — Universal Heuristic Field Extractor
=======================================================
Extracts invoice fields from raw OCR text using deterministic regex patterns
optimised for Macedonian (mk-MK) invoices in Cyrillic and Latin script.

This is the fallback extractor when no vendor template matches. Unlike the
old VLM-based extractor it never hallucinates — it returns None / empty for
fields it cannot find rather than inventing values.

Number formats handled:
  European: 1.234,56 → Decimal("1234.56")
  Standard: 1,234.56 → Decimal("1234.56")
  Plain:    1234.56  → Decimal("1234.56")
"""
from __future__ import annotations

import logging
import re
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Number parsing
# ---------------------------------------------------------------------------

def parse_amount(text: str) -> Optional[Decimal]:
    """Parse a number string in European or standard format to Decimal."""
    if not text:
        return None
    text = str(text).strip().replace("\xa0", "").replace(" ", "")
    # "d+,ddd" — comma followed by exactly 3 digits, no further separators:
    # treat as a comma-thousands separator (93,548 = 93548), not as a decimal.
    # Must come before the European format check which would parse it as 93.548.
    if re.match(r"^\d+,\d{3}$", text):
        text = text.replace(",", "")
    # European: 1.234,56  (thousands=dot, decimal=comma)
    elif re.match(r"^\d{1,3}(\.\d{3})*(,\d+)?$", text):
        text = text.replace(".", "").replace(",", ".")
    # OCR reads thousands dot as comma: "6,381,65" → 6381.65
    # Pattern d,ddd,dd has 1-3 digits, comma, 3 digits, comma, 1-2 digits.
    elif re.match(r"^\d{1,3},\d{3},\d{1,2}$", text):
        text = text.replace(",", "", 1).replace(",", ".")
    # OCR reads decimal comma as dot: "1.148.70" → 1148.70
    # Pattern d.ddd.dd has 1-3 digits, dot, 3 digits, dot, 1-2 digits.
    elif re.match(r"^\d{1,3}\.\d{3}\.\d{1,2}$", text):
        text = text.replace(".", "", 1)
    # OCR drops the thousands dot: "6381,65" instead of "6.381,65".
    # ≥4 digits before comma + 1–2 decimal digits = decimal comma in MKD context.
    elif re.match(r"^\d{4,},\d{1,2}$", text):
        text = text.replace(",", ".")
    else:
        # Remove commas used as thousands separators (e.g. 1,234.56)
        text = text.replace(",", "")
    # Strip trailing dots
    text = text.rstrip(".")
    try:
        return Decimal(text)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Vendor name extraction
# ---------------------------------------------------------------------------

_COMPANY_SUFFIXES = [
    "ДОО", "ДООЕЛ", "АД", "АКЦИОНЕРСКО ДРУШТВО",
    "DOO", "DOOEL", "AD", "EOOD", "ЕОД", "СД", "ООД",
    "Ltd", "LLC", "Corp", "Inc", "GmbH",
    "Communications", "Consulting", "Solutions", "Services",
    "Systems", "Technologies", "Technology", "Networks", "Group",
]

_VENDOR_LABEL_RE = re.compile(
    r"(?:Добавувач|Издавач|Назив на фирма|Испорачувач|Продавач|Фактурант|Назив"
    r"|Подносители?\s+на\s+фактура)\s*[:\s]+(.+)",
    re.IGNORECASE,
)
# Label that stands alone on its own line above the vendor name (e.g. Čukić invoices)
_VENDOR_FOOTER_LABEL_RE = re.compile(
    r"^(?:Подносители?\s+на\s+фактура|Потпишувач|Фактурант)\s*[:\-]?\s*$",
    re.IGNORECASE,
)

_SUFFIX_RE = re.compile(
    r"(.{3,70})\b(" + "|".join(re.escape(s) for s in _COMPANY_SUFFIXES) + r")\b(.{0,30})",
    re.IGNORECASE,
)

# Lines that identify the buyer side — never treat these as the vendor
_BUYER_LABEL_RE = re.compile(
    r"^(?:До\s*:|Купувач\s*:|Испорачано\s+на\s*:|Bill\s+to\s*:|Наручувач\s*:|Клиент\s*:|Примач\s*:|Комитент\s*:?)",
    re.IGNORECASE,
)
_BUYER_NAME_RE = re.compile(
    r"(?:Динерс\s*Клуб|DINERS\s*CLUB|Ф\.?\s*Д\.?\s*ДИНЕРС|Dinners?\s*Club|ДИНЕРС\s*КЛУБ|ДИНЕРСКЛУБ)",
    re.IGNORECASE,
)
# Vendor alias: any CaSys / КаСис variant → canonical vendor name "KaSis"
_CASYS_RE = re.compile(r"\bca.?sys\b|\bКа\s*Сис\b", re.IGNORECASE)
# Lines that look like table column headers — never use as vendor name
_TABLE_HEADER_RE = re.compile(
    r"(?:Количина|Кол\.\s*м|Единица|Ед\.\s*мерка|Назив на производ|Шифра|Тарифа"
    r"|Р\s*[\-\.]\s*бр|П\s*[\-\.]\s*бр|Попуст|Рабат|Даночна\s*основа|Вид на услуга"
    r"|Опис\s+на\s+услу|Услуга\s+/\s+Производ|Цена\s+без|Цена\s+со"
    r"|Број\s+на\s+фактура|Бр\.?\s+фактура|Датум\s+на\s+издавање)",
    re.IGNORECASE,
)


def extract_vendor_name(lines: List[str], full_text: str) -> str:
    """
    Detect the issuing vendor's company name.

    Priority:
    0. Vendor alias (CaSys/КаСис variants → "KaSis") — checked before any other logic
    1. Explicit label ("Добавувач: ..." / "Издавач: ...")
    2. Cross-line: "Подносители на фактура" label → next line is vendor
    3. Company suffix (ДОО, АД, etc.) in the top 25% of lines, not the buyer
    4. First meaningful non-numeric, non-buyer, non-table-header line in the first 10 lines
    Vendor is ALWAYS in the header zone — never extracted from table rows or body text.
    """
    if _CASYS_RE.search(full_text):
        return "KaSis"

    for line in lines:
        m = _VENDOR_LABEL_RE.search(line)
        if m:
            candidate = m.group(1).strip()
            if (len(candidate) > 3
                    and not re.match(r"^[\d\s.,:/\-]+$", candidate)
                    and not _TABLE_HEADER_RE.search(candidate)):
                return candidate

    # Cross-line: label like "Подносители на фактура" on its own line → vendor name on next
    for i, line in enumerate(lines):
        if _VENDOR_FOOTER_LABEL_RE.match(line.strip()):
            for j in range(i + 1, min(i + 3, len(lines))):
                candidate = lines[j].strip()
                if (candidate and len(candidate) > 5
                        and not _BUYER_NAME_RE.search(candidate)
                        and not _TABLE_HEADER_RE.search(candidate)
                        and not re.match(r"^[\d\s,./:\-]+$", candidate)):
                    return candidate

    # Restrict suffix search to top 25% of lines (header zone only)
    header_zone = lines[:max(12, len(lines) // 4)]
    for i, line in enumerate(header_zone):
        if _BUYER_LABEL_RE.match(line.strip()) or _BUYER_NAME_RE.search(line):
            continue
        if _TABLE_HEADER_RE.search(line):
            continue
        m = _SUFFIX_RE.search(line)
        if m:
            candidate = m.group(0).strip()
            prefix = m.group(1).strip()
            prepended = False
            # If the prefix before the suffix is short, the company name may start
            # on the previous line (e.g. "AKTON" on line N, "communications" on line N+1).
            # Threshold < 5: "МАК АД" (prefix="МАК", 3 chars) triggers prepend attempt.
            if len(prefix) < 5 and i > 0:
                prev = header_zone[i - 1].strip()
                if (prev
                        and not _BUYER_LABEL_RE.match(prev)
                        and not _BUYER_NAME_RE.search(prev)
                        and not re.match(r"^[\d\s\.,:/\-]+$", prev)
                        and not re.search(r"\b(19|20)\d{2}\b", prev)
                        and not _TABLE_HEADER_RE.search(prev)
                        and not re.search(r"\b(?:ул|ul|бул|bul|лок|lok)\.|\bбр\.\s*\d|\bbr\.\s*\d", prev, re.IGNORECASE)):
                    candidate = prev + " " + candidate
                    prepended = True
            # Skip candidates whose prefix is too short and no valid previous line found
            if len(prefix) < 4 and not prepended:
                continue
            if (len(candidate) > 5
                    and not re.match(r"^[\d\s,./:\-]+$", candidate)
                    and not _BUYER_NAME_RE.search(candidate)
                    and not _TABLE_HEADER_RE.search(candidate)):
                return candidate

    for line in lines[:10]:
        line = line.strip()
        if _BUYER_LABEL_RE.match(line) or _BUYER_NAME_RE.search(line):
            continue
        if _TABLE_HEADER_RE.search(line):
            continue
        # Skip address lines (street / PO box — never a company name)
        if re.search(r"\b(?:ул|ul|бул|bul|лок|lok)\.|\bбр\.\s*\d|\bbr\.\s*\d|\bп\.фах\b", line, re.IGNORECASE):
            continue
        if len(line) >= 3 and not re.match(r"^[\d\s\.,:/\-]+$", line):
            if not re.match(r"^(?:Фактура|Invoice|Датум|Date|Бр\.|ДДВ|VAT|До\s*:|Купувач|Примач)\b", line, re.IGNORECASE):
                # Skip lines that contain a year — likely a date line, not a company name
                if not re.search(r"\b(19|20)\d{2}\b", line):
                    return line

    return "Unknown vendor"


# ---------------------------------------------------------------------------
# VAT ID extraction
# ---------------------------------------------------------------------------

_VAT_PRIMARY_RE = re.compile(r"(?:МК|MK)\s*(\d{13})", re.IGNORECASE)
_VAT_LABEL_RE = re.compile(
    r"(?:ЕДБ|Даночен број|EDB|Бр\. на регистрација на ДДВ|ДДВ бр|VAT ID)\s*[:\-]?\s*(?:МК|MK)?\s*(\d{13})",
    re.IGNORECASE,
)
_VAT_AREA_RE = re.compile(
    r"(?:ЕДБ|Даночен|регистрација|EDB|VAT).{0,60}",
    re.IGNORECASE | re.DOTALL,
)


def extract_vat_id(full_text: str) -> Optional[str]:
    """Extract the Macedonian VAT ID (МК + 13 digits) or null."""
    m = _VAT_PRIMARY_RE.search(full_text)
    if m:
        return f"МК{m.group(1)}"

    m = _VAT_LABEL_RE.search(full_text)
    if m:
        digits = m.group(1)
        return f"МК{digits}"

    area_m = _VAT_AREA_RE.search(full_text)
    if area_m:
        digits_m = re.search(r"\d{13}", area_m.group())
        if digits_m:
            return f"МК{digits_m.group()}"

    return None


# ---------------------------------------------------------------------------
# Invoice number extraction
# ---------------------------------------------------------------------------

_INVOICE_NO_PATTERNS = [
    # "Фактура број:" / "Фактура бр:" / OCR artifact "Фактура 6р:"
    re.compile(
        r"(?:Фактура|Faktura|Invoice)\s+"
        r"(?:број|бр\.?|6р\.?)\s*[:\-]?\s*"
        r"([A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9][A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9/\-\.]{1,30})",
        re.IGNORECASE,
    ),
    # "Фактура №..." / "ФАКТУРА №..."
    re.compile(
        r"(?:Фактура|Faktura|Invoice)\s*[№#]\s*"
        r"([A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9][A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9/\-\.]{1,30})",
        re.IGNORECASE,
    ),
    # "Фактура:" / "Faktura:" — colon/dash required so bare "ФАКТУРА" heading won't match
    re.compile(
        r"(?:Фактура|Faktura|Invoice)\s*[:\-]\s*"
        r"([A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9][A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9/\-\.]{1,30})",
        re.IGNORECASE,
    ),
    # "Испратница:" / "Испратница број:" (delivery note acting as invoice)
    re.compile(
        r"(?:Испратница|Ispratnica)\s*(?:број|бр\.?)?\s*[:\-]?\s*"
        r"([A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9][A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9/\-\.]{1,30})",
        re.IGNORECASE,
    ),
    # "Број фактура:" / "Број на фактура:"
    re.compile(
        r"(?:Број|Broj)\s+(?:на\s+)?(?:фактура|faktura)\s*[:\-]?\s*"
        r"([A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9][A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9/\-\.]{1,30})",
        re.IGNORECASE,
    ),
    # "Бр. на фактура:" / "Бр. фактура:"
    re.compile(
        r"(?:Бр\.?|бр\.?)\s+на\s+(?:фактура|faktura)\s*[:\-]?\s*"
        r"([A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9][A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9/\-\.]{1,30})",
        re.IGNORECASE,
    ),
    # "INV-XXXX" format (Latin-script invoices)
    re.compile(
        r"\bINV[:\-]\s*([A-Za-z0-9][A-Za-z0-9/\-\.]{1,30})",
        re.IGNORECASE,
    ),
    # "ИФФ XXXX/XX" format
    re.compile(
        r"\bИФФ\s*(\d{3,}/\d+)",
        re.IGNORECASE,
    ),
    # "Фактура 25-302-00418" — bare number directly after Фактура with no intermediate label.
    # First captured char must be a digit so address words ("ФАКТУРА Скопје...") never match.
    # Must be last so labeled patterns (Фактура број:, Фактура №) take priority.
    re.compile(
        r"(?:Фактура|Faktura|Invoice)\s+(\d[A-Za-z0-9/\-]{2,30})(?=[\s]|$)",
        re.IGNORECASE,
    ),
]

# Two-phase invoice number: locate the "Фактура" heading line, then search the
# following lines for "број:VALUE" (requires colon/dash separator to exclude
# "бр.34/1-3" street abbreviations) or "Број VALUE" (full word, no abbreviation).
# This handles Zonel (ФАКТУРА heading → address line → број: 25110054)
# and Nikob (0504 / Фактура → next line: Број 24-3000031935).
_FAKTURA_HEADING_RE = re.compile(r"(?:^|\b)(?:Фактура|Faktura|Invoice)\b", re.IGNORECASE)
# "Број на фактура" label — used for cross-line extraction (label + value on different lines)
_BROJ_NA_FAKTURA_RE = re.compile(r"[Бб]рој\s+на\s+фактура", re.IGNORECASE)
_BROJ_AFTER_RE = re.compile(
    r"(?:број\s*[:\-]|Број\s+)([A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9][A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9/\-\.]{1,30})",
    re.IGNORECASE,
)
_STANDALONE_BROJ_RE = re.compile(
    r"(?<![A-Za-zА-Яа-яЃ-ЏЀ-ӿ])Број\s*[:\-]?\s*\-*\s*"
    r"([A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9][A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9/\-\.]{1,30})",
    re.IGNORECASE,
)
# Candidates that look like VAT IDs (МК/MK + 8+ digit-like chars) are never invoice numbers
_VAT_ID_LIKE_RE = re.compile(r"^(?:МК|MK|Mk)[0-9OoОо]{5,}", re.IGNORECASE)
# Candidates that look like calendar dates (D.M.YYYY, DD/MM/YYYY, etc.) are never invoice numbers
_DATE_LIKE_RE = re.compile(r"^\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}$")
# Last-resort: bare бр.\d+ pattern (for typewriter/poor-OCR invoices like Gorska)
_BRN_FALLBACK_RE = re.compile(
    r"(?:бр|Бр)\.?\s*(\d+\s*/\s*\d+(?:\s*/\s*\d+)?|\d+\s*[\-]\s*\d+)",
    re.IGNORECASE,
)
# KaSis invoice number format: NN/YYYY (e.g. 270/2025, 2229/2025) — 2-5 digits, then /20XX
_CASYS_INV_RE = re.compile(r"\b(\d{2,5}/20\d{2})\b")


def _valid_inv_no(val: str) -> bool:
    """Return True if val looks like a real invoice number (not a VAT ID, date, or too short)."""
    if not val:
        return False
    val = val.strip().rstrip('-').rstrip('.')
    if len(val) < 3 and "/" not in val:
        return False
    if _VAT_ID_LIKE_RE.match(val):
        return False
    # Reject DD.MM.YYYY / DD/MM/YYYY date strings (e.g. "7.11.2025" from "ФАКТУРА 7.11.2025")
    if _DATE_LIKE_RE.match(val):
        return False
    return True


def extract_invoice_number(lines: List[str], full_text: str) -> str:
    # Phase 1: label-driven same-line patterns (all four canonical label forms)
    for pat in _INVOICE_NO_PATTERNS:
        m = pat.search(full_text)
        if m:
            val = m.group(1).strip().rstrip('-').rstrip('.')
            if _valid_inv_no(val):
                return val

    # Phase 2: "Фактура" as a heading → scan next 15 lines for "број:/Број X"
    # Handles cases where Фактура and број are on different lines (e.g. Zonel)
    for i, line in enumerate(lines):
        if _FAKTURA_HEADING_RE.search(line):
            window = lines[i:i + 15]
            for j, wline in enumerate(window):
                m = _BROJ_AFTER_RE.search(wline)
                if m:
                    val = m.group(1).strip().rstrip('-').rstrip('.')
                    if _valid_inv_no(val):
                        return val
                # Cross-line: "број:" alone on a line, value on the very next line
                elif re.search(r"(?:број|Број)\s*[:\-]\s*$", wline.strip()) and j + 1 < len(window):
                    nxt = window[j + 1].strip()
                    vm = re.match(r"([A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9][A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9/\-\.]{1,30})", nxt)
                    if vm:
                        val = vm.group(1).strip().rstrip('-').rstrip('.')
                        if _valid_inv_no(val):
                            return val
                # Bare NN/NN or NN/NN-NN alone on a line after the ФАКТУРА heading.
                # Anchored to the full stripped line so address fragments ("ул. 34/1-3")
                # are ignored — only a line whose ENTIRE content is the number matches.
                # j>0 skips the heading line itself.
                if j > 0:
                    bm = re.match(r"^(\d{2,}/\d+(?:-\d+)?)$", wline.strip())
                    if bm and _valid_inv_no(bm.group(1)):
                        return bm.group(1)
            break

    # Phase 2b: "Број на фактура" label → value on same or next line
    # Handles CaSys-style where label and number are on adjacent OCR lines
    for i, line in enumerate(lines):
        if _BROJ_NA_FAKTURA_RE.search(line):
            after = _BROJ_NA_FAKTURA_RE.sub("", line).strip().lstrip(":- \t")
            if after:
                vm = re.match(r"([A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9][A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9/\-\.]{1,30})", after)
                if vm and _valid_inv_no(vm.group(1)):
                    return vm.group(1).rstrip('-').rstrip('.')
            for j in range(i + 1, min(i + 3, len(lines))):
                nxt = lines[j].strip()
                if not nxt:
                    continue
                if re.search(r"(?:Датум|Date|Datum)\b", nxt, re.IGNORECASE):
                    break
                vm = re.match(r"([A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9][A-Za-zА-Яа-яЃ-ЏЀ-ӿ0-9/\-\.]{1,30})", nxt)
                if vm and _valid_inv_no(vm.group(1)):
                    return vm.group(1).rstrip('-').rstrip('.')
                break
            break

    # Phase 3: standalone "Број" full word (not "Бр." abbreviation) anywhere in doc
    m = _STANDALONE_BROJ_RE.search(full_text)
    if m:
        val = m.group(1).strip().rstrip('-').rstrip('.')
        if _valid_inv_no(val):
            return val

    # Phase 4: last-resort бр.X/Y or бр.X-Y (handles poor-OCR invoices)
    m = _BRN_FALLBACK_RE.search(full_text)
    if m:
        val = m.group(1).strip().replace(" ", "")
        if _valid_inv_no(val):
            return val

    # Phase 5: KaSis-specific header-zone scan for NN/YYYY (e.g. 270/2025, 2229/2025).
    # Only fires when a CaSys/КаСис variant is detected anywhere in the document.
    if _CASYS_RE.search(full_text):
        for line in (lines[:40] if lines else []):
            m = _CASYS_INV_RE.search(line)
            if m:
                val = m.group(1).strip()
                if _valid_inv_no(val):
                    return val

    return "N/A"


# ---------------------------------------------------------------------------
# Date extraction
# ---------------------------------------------------------------------------

_DATE_SEP = r"[./\-,]"  # OCR sometimes reads dot as comma: "31.10,22"

_DUE_DATE_RE = re.compile(
    r"(?:Доспева на|Датум на доспевање|Датум на валута"
    r"|Рок за пла[кќй]ање|Рок на пла[кќй]ање|Рок на плакање"
    r"|Валута|Due\s*date|Платливо до|Плаќање до)\s*[:\-]?\s*"
    r"(\d{1,2}" + _DATE_SEP + r"\d{1,2}" + _DATE_SEP + r"\d{2,4})г?",
    re.IGNORECASE,
)
# "Рок за плаќање: 30 дена, до 14.Nov.2025" — date comes after "до"
_DUE_DATE_DO_RE = re.compile(
    r"(?:Рок за пла[кќй]ање|Рок на пла[кќй]ање)[^.\n]{0,60}\bдо\s+"
    r"(\d{1,2}[./\-]\w+[./\-]\d{2,4})",
    re.IGNORECASE,
)

_INVOICE_DATE_RE = [
    # Specific labels — safe to search full text (no ^ anchor needed)
    re.compile(
        r"Датум на издавање\s*[:\-]?\s*"
        r"(\d{1,2}" + _DATE_SEP + r"\d{1,2}" + _DATE_SEP + r"\d{2,4})г?",
        re.IGNORECASE,
    ),
    re.compile(
        r"Датум на фактура\s*[:\-]?\s*"
        r"(\d{1,2}" + _DATE_SEP + r"\d{1,2}" + _DATE_SEP + r"\d{2,4})г?",
        re.IGNORECASE,
    ),
    re.compile(
        r"Датум на промет\s*[:\-]?\s*"
        r"(\d{1,2}" + _DATE_SEP + r"\d{1,2}" + _DATE_SEP + r"\d{2,4})г?",
        re.IGNORECASE,
    ),
]
# Generic labels that could also appear in contract body text — restricted to header zone
_INVOICE_DATE_HEADER_RE = [
    re.compile(
        r"(?:Датум|Date|Datum)\s*[:\-]?\s*"
        r"(\d{1,2}" + _DATE_SEP + r"\d{1,2}" + _DATE_SEP + r"\d{2,4})г?",
        re.IGNORECASE,
    ),
]

# Last-resort: any standalone date in DD.MM.YYYY format (handles "Скопје, 27.03.2024г")
_STANDALONE_DATE_RE = re.compile(
    r"\b(\d{1,2}[./\-]\d{1,2}[./\-]\d{4})г?(?=[\s,;:.\)]|$)",
)


def extract_dates(lines: List[str], full_text: str) -> Tuple[Optional[str], Optional[str]]:
    """Return (invoice_date, due_date) as raw strings."""
    due_date: Optional[str] = None
    invoice_date: Optional[str] = None

    m = _DUE_DATE_RE.search(full_text)
    if m:
        due_date = m.group(1).strip()
    if due_date is None:
        m = _DUE_DATE_DO_RE.search(full_text)
        if m:
            due_date = m.group(1).strip()

    for pat in _INVOICE_DATE_RE:
        m = pat.search(full_text)
        if m:
            candidate = m.group(1).strip()
            if candidate != due_date:
                invoice_date = candidate
                break

    # Cross-line "Датум на издавање": label on its own line, date on the next line.
    # Placed before generic fallback so this specific label always wins.
    if invoice_date is None and lines:
        for i, line in enumerate(lines[:-1]):
            if re.search(r"Датум\s+на\s+издавање\s*[:\-]?\s*$", line.strip(), re.IGNORECASE):
                nxt = lines[i + 1].strip()
                dm = re.match(r"(\d{1,2}[./,\-]\d{1,2}[./,\-]\d{2,4})", nxt)
                if dm:
                    candidate = dm.group(1)
                    if candidate != due_date:
                        invoice_date = candidate
                        break

    # Cross-line bare "Датум" in header zone: label at end of its line, date on the next.
    # Handles Stjuart-style where "Датум:" is on its own line in the header.
    if invoice_date is None and lines:
        for i, line in enumerate(lines[:39]):
            if re.search(r"\bДатум\s*[:\-]?\s*$", line.strip(), re.IGNORECASE):
                nxt = lines[i + 1].strip()
                dm = re.match(r"(\d{1,2}[./,\-]\d{1,2}[./,\-]\d{2,4})", nxt)
                if dm:
                    candidate = dm.group(1)
                    if candidate != due_date:
                        invoice_date = candidate
                        break

    # Generic "Датум" label — only search the header zone so contract body dates don't win
    if invoice_date is None:
        header_text = "\n".join(lines[:40]) if lines else full_text
        for pat in _INVOICE_DATE_HEADER_RE:
            m = pat.search(header_text)
            if m:
                candidate = m.group(1).strip()
                if candidate != due_date:
                    invoice_date = candidate
                    break

    # If only one date found, treat it as invoice_date
    if invoice_date is None and due_date is not None:
        invoice_date = due_date
        due_date = None

    # Last resort: scan lines (reversed so bottom-of-page signing dates are preferred)
    # for any standalone DD.MM.YYYY date. Handles "Скопје, 27.03.2024г" in Čukić invoices.
    if invoice_date is None:
        for line in reversed(lines):
            m = _STANDALONE_DATE_RE.search(line)
            if m:
                candidate = m.group(1).strip()
                if candidate != due_date:
                    invoice_date = candidate
                    break

    return invoice_date, due_date


# ---------------------------------------------------------------------------
# Financial totals extraction — with cross-line support
# ---------------------------------------------------------------------------

_H = r"[^\S\r\n]*"  # horizontal whitespace only — prevents patterns from crossing lines

# Specific total labels: За наплата, Вкупно за плаќање, Вкупен износ, ВКУПНО СЕ, etc.
# Order matters: more specific (ВКУПНО СЕ / За наплата) must appear before the generic
# ВКУПНО which only captures the net subtotal row on Telit-style invoices.
_TOTAL_SPECIFIC_PAT = re.compile(
    r"(?:[ВB][КK][Уy][Пn][НH][ОO]\s+[СC][ЕE]"
    r"|Вкупно за пла[кќй]ање"
    r"|Вкупно за наплата\s+денари|Вкупно за наплата"
    r"|Вкупно со ДДВ|Цена со ДДВ"
    r"|За наплата\s+денари|За наплата"
    r"|За пла[кќй]ање|вкупно за платање"
    r"|Вкупен износ за пла[кќй]ање|Вкупен износ)"
    + _H + r"[:\-]?" + _H + r"(?:MKD|MKД|ден\.?)?" + _H + r"([\d.,]+)",
    re.IGNORECASE,
)
# Generic total labels: Вкупно, Total — only used as last resort
_TOTAL_GENERIC_PAT = re.compile(
    r"(?:Вкупно|Ukupno|Total|ВКУПНО)" + _H + r"[:\-]?" + _H + r"([\d.,]+)",
    re.IGNORECASE,
)
# Used for cross-line search: find lines containing these specific labels
_TOTAL_LABEL_RE = re.compile(
    r"(?:[ВB][КK][Уy][Пn][НH][ОO]\s+[СC][ЕE]"
    r"|Вкупно за пла[кќй]ање"
    r"|Вкупно за наплата\s+денари|Вкупно за наплата"
    r"|Вкупно со ДДВ|Цена со ДДВ"
    r"|За наплата\s+денари|За наплата"
    r"|За пла[кќй]ање|вкупно за платање"
    r"|Вкупен износ за пла[кќй]ање|Вкупен износ)",
    re.IGNORECASE,
)

_SUBTOTAL_INLINE_PAT = re.compile(
    r"(?:Основица|Нето износ|без ДДВ|Вредност без ДДВ|Износ без ДДВ|Вкупно без ДДВ"
    r"|Основа за ДДВ|Продажен износ без ДДВ|osnova|Subtotal)"
    + _H + r"[:\-]?" + _H + r"([\d.,]+)",
    re.IGNORECASE,
)
_SUBTOTAL_LABEL_RE = re.compile(
    r"(?:Основица|Нето износ|без ДДВ|Вредност без ДДВ|Износ без ДДВ|Вкупно без ДДВ"
    r"|Основа за ДДВ|Продажен износ без ДДВ)",
    re.IGNORECASE,
)

_TAX_RATE_PATTERNS = [
    re.compile(r"ДДВ" + _H + r"(\d{1,2})" + _H + r"%", re.IGNORECASE),
    re.compile(r"(\d{1,2})" + _H + r"%" + _H + r"ДДВ", re.IGNORECASE),
    re.compile(r"DDV" + _H + r"(\d{1,2})" + _H + r"%", re.IGNORECASE),
    re.compile(r"VAT" + _H + r"(\d{1,2})" + _H + r"%", re.IGNORECASE),
]

_TAX_AMOUNT_PATTERNS = [
    # "ДДВ+ 1.080,00" — explicit plus suffix used by Zonel; any numeric format
    re.compile(r"ДДВ\+" + _H + r"([\d.,]+)", re.IGNORECASE),
    # Generic ДДВ/DDV/VAT — require a decimal separator or 3+ digits so bare
    # rate integers like "18" (from a "% на ДДВ 18" column header) are not captured.
    re.compile(r"ДДВ" + _H + r"(?:\d{1,2}" + _H + r"%" + _H + r")?[+\-]?" + _H + r"((?:\d+[.,])+\d+|\d{3,})", re.IGNORECASE),
    re.compile(r"DDV" + _H + r"(?:\d{1,2}" + _H + r"%" + _H + r")?[+\-]?" + _H + r"((?:\d+[.,])+\d+|\d{3,})", re.IGNORECASE),
    re.compile(r"VAT" + _H + r"(?:\d{1,2}" + _H + r"%" + _H + r")?[+\-]?" + _H + r"((?:\d+[.,])+\d+|\d{3,})", re.IGNORECASE),
    # "Данок од 18%: 702,00" or "Данок на додадена вредност: 702,00"
    # Uses [^:\n] to skip past the "od 18%" part before finding the amount after ":"
    re.compile(r"Данок\b[^:\n]{0,35}[:\-]\s*((?:\d+[.,])+\d+|\d{3,})", re.IGNORECASE),
]

# Cross-line: find lines labeled as ДДВ/VAT and read amount from same or next line
_TAX_AMOUNT_LABEL_RE = re.compile(r"^(?:ДДВ[\+\-]?|DDV[\+\-]?|VAT[\+\-]?)\s*$", re.IGNORECASE)

_AMOUNT_END_RE = re.compile(r"([\d.,]+)\s*$")

# Lines that contain contact/phone info — never read an amount from these.
# Phone numbers, fax, email, website lines are irrelevant to invoice totals.
_PHONE_LINE_RE = re.compile(
    r"(?:\+\d{3}|\bтел\.?|\btel\.?|\bfax\.?|\bфакс\.?|\bмоб\.?|\bmob\.?"
    r"|\bT:\s*\+|\bF:\s*\+|@|www\.|\.com|\.mk|info@|e-mail)",
    re.IGNORECASE,
)

# Sanity cap: no MKD invoice total can realistically exceed 9,999,999.
# Values larger than this are bank accounts, phone numbers, or OCR artefacts.
_MAX_INVOICE_AMOUNT = Decimal("9999999")


def _is_valid_amount(val: Optional[Decimal]) -> bool:
    return val is not None and Decimal("0") < val <= _MAX_INVOICE_AMOUNT


def _amount_from_line_or_next(lines: List[str], idx: int) -> Optional[Decimal]:
    """
    Extract an amount from the end of lines[idx] or the start of the first
    non-empty line after it (handles label and value on adjacent lines).
    Skips lines that look like phone/contact info.
    """
    line = lines[idx]
    if not _PHONE_LINE_RE.search(line):
        m = _AMOUNT_END_RE.search(line)
        if m:
            val = parse_amount(m.group(1))
            if _is_valid_amount(val):
                return val

    for j in range(idx + 1, min(idx + 4, len(lines))):
        nxt = lines[j].strip()
        if not nxt:
            continue
        if _PHONE_LINE_RE.search(nxt):
            break
        m = re.match(r"^([\d.,]+)", nxt)
        if m:
            val = parse_amount(m.group(1))
            if _is_valid_amount(val):
                return val
        break  # only check the first non-empty line after the label

    return None


def extract_financial_totals(full_text: str, lines: List[str] = None) -> Dict[str, Optional[Decimal]]:
    result: Dict[str, Any] = {"subtotal": None, "tax_rate": None, "tax_amount": None, "total": None}

    # ── Total ─────────────────────────────────────────────────────────────────
    # Pass 1+2: collect ALL specific-label amounts (inline finditer + cross-line
    # scan) then take the maximum. The gross total is always the last and largest
    # value in any subtotal → VAT → gross sequence; max() selects it without
    # needing to know which specific label is the "right" one.
    specific_amounts: List[Decimal] = []
    for m in _TOTAL_SPECIFIC_PAT.finditer(full_text):
        val = parse_amount(m.group(1))
        if _is_valid_amount(val):
            specific_amounts.append(val)
    if lines:
        for i, line in enumerate(lines):
            if _TOTAL_LABEL_RE.search(line):
                val = _amount_from_line_or_next(lines, i)
                if val:
                    specific_amounts.append(val)
    if specific_amounts:
        result["total"] = max(specific_amounts)

    # Pass 3: generic label (Вкупно, Total) — last resort only if no specific
    # label matched. Take the max across all occurrences.
    if result["total"] is None:
        generic_amounts: List[Decimal] = []
        for m in _TOTAL_GENERIC_PAT.finditer(full_text):
            val = parse_amount(m.group(1))
            if _is_valid_amount(val):
                generic_amounts.append(val)
        if generic_amounts:
            result["total"] = max(generic_amounts)

    # Pass 4: "С зборови" / "Co зборови" (amount in words) — this label appears
    # immediately BELOW the numeric gross total on Stjuart-style invoices.
    # Scan up to 5 lines above it for a monetary amount > 100.
    if result["total"] is None and lines:
        for i, line in enumerate(lines):
            if re.search(r"[CС][oо]?\s+зборови\b", line, re.IGNORECASE):
                # Scan backward — line immediately above С зборови is the gross total.
                # Skip Рок за плаќање / Рок до / Плаќање до lines and phone/contact lines.
                for k in reversed(range(max(0, i - 5), i)):
                    if re.search(r"\bРок\b.{0,20}\bпла[кќй]ање\b|\bРок\s+до\b|\bПлаќање\s+до\b", lines[k], re.IGNORECASE):
                        continue
                    if _PHONE_LINE_RE.search(lines[k]):
                        continue
                    m2 = _AMOUNT_END_RE.search(lines[k])
                    if m2:
                        amt = parse_amount(m2.group(1))
                        if amt and Decimal("100") < amt <= _MAX_INVOICE_AMOUNT:
                            result["total"] = amt
                            break
                break

    # ── Subtotal ──────────────────────────────────────────────────────────────
    m = _SUBTOTAL_INLINE_PAT.search(full_text)
    if m:
        val = parse_amount(m.group(1))
        if val and val > 0:
            result["subtotal"] = val

    if result["subtotal"] is None and lines:
        for i, line in enumerate(lines):
            if _SUBTOTAL_LABEL_RE.search(line):
                val = _amount_from_line_or_next(lines, i)
                if val:
                    result["subtotal"] = val
                    break

    # ── Tax rate ──────────────────────────────────────────────────────────────
    for pat in _TAX_RATE_PATTERNS:
        m = pat.search(full_text)
        if m:
            try:
                result["tax_rate"] = Decimal(m.group(1))
                break
            except Exception:
                pass

    # ── Tax amount ────────────────────────────────────────────────────────────
    for pat in _TAX_AMOUNT_PATTERNS:
        m = pat.search(full_text)
        if m:
            amt = parse_amount(m.group(1))
            total = result.get("total")
            if amt and amt > 0 and (total is None or amt < total):
                result["tax_amount"] = amt
                break

    # Cross-line tax amount: label alone on its line, amount on the next
    if result["tax_amount"] is None and lines:
        for i, line in enumerate(lines):
            if _TAX_AMOUNT_LABEL_RE.match(line.strip()):
                val = _amount_from_line_or_next(lines, i)
                total = result.get("total")
                if val and val > 0 and (total is None or val < total):
                    result["tax_amount"] = val
                    break

    # ── Derive missing values ─────────────────────────────────────────────────
    if result["subtotal"] is None and result["total"] and result["tax_amount"]:
        result["subtotal"] = result["total"] - result["tax_amount"]
    if result["tax_amount"] is None and result["subtotal"] and result["tax_rate"]:
        result["tax_amount"] = round(result["subtotal"] * result["tax_rate"] / Decimal("100"), 2)
    # Last resort: derive tax_amount = total - subtotal when both are known.
    # Guard: diff must be < 50% of total — prevents assigning a near-zero subtotal
    # artefact from making the entire invoice amount look like tax.
    if result["tax_amount"] is None and result["total"] and result["subtotal"]:
        diff = result["total"] - result["subtotal"]
        if Decimal("0.01") < diff < result["total"] * Decimal("0.5"):
            result["tax_amount"] = diff

    # Sanity: tax_amount must be strictly less than total; if not, it was mis-extracted
    if result["total"] and result["tax_amount"] and result["tax_amount"] >= result["total"]:
        logger.warning(
            "tax_amount (%s) >= total (%s) — discarding spurious tax extraction",
            result["tax_amount"], result["total"],
        )
        result["tax_amount"] = None
        result["tax_rate"] = None

    return result


# ---------------------------------------------------------------------------
# Line item extraction — tries individual OCR rows, falls back to synthetic
# ---------------------------------------------------------------------------

# Lines that are totals / headers — skip when parsing for individual items
_SKIP_ITEM_LINE_RE = re.compile(
    r'\b(вкупно|ukupno|total|за наплата|za naplata|основа|osnova|ддв|ddv|vat|'
    r'данок|danok|попуст|popust|рабат|rabat|износ без|neto iznos|бруто|bruto|'
    r'подвкупно|podvkupno|опис|opis|количина|qty|единица|unit|датум|datum|'
    r'фактура|број|number|date|клиент|client|добавувач|купувач|'
    r'plateno|платено|сметка|smetka|жиро|edb|едб|даночен|матичен|pib)\b',
    re.IGNORECASE,
)
# Monetary amount at the end of a line: European comma-decimal format
# Matches e.g. "1.234,56"  "1 234,56"  "1234,56"  "234,56"
_ITEM_AMT_RE = re.compile(r'(\d{1,3}(?:[. ]\d{3})*,\d{2}|\d+,\d{2})\s*$')


def _try_parse_line_items(
    lines: List[str],
    total: Decimal,
    vat_rate: Optional[Decimal],
) -> Optional[List[Dict]]:
    """
    Try to extract individual line items from OCR lines.
    Returns a list of item dicts when reliable, None when parsing is uncertain.
    """
    candidates = []
    for raw in lines:
        line = raw.strip()
        if not line or len(line) < 6:
            continue
        if _SKIP_ITEM_LINE_RE.search(line):
            continue
        m = _ITEM_AMT_RE.search(line)
        if not m:
            continue
        amt_raw = m.group(1).replace(' ', '').replace('.', '').replace(',', '.')
        try:
            amount = Decimal(amt_raw)
        except Exception:
            continue
        if amount < Decimal('1') or amount > total * Decimal('1.05'):
            continue
        # Build description: everything before the amount, strip trailing digit tokens
        desc = line[:m.start()].strip()
        parts = desc.split()
        while parts and re.match(r'^[\d.,]+$', parts[-1]):
            parts.pop()
        desc = ' '.join(parts).strip(' ,.|:;')
        if len(desc) < 3:
            continue
        if not re.search(r'[A-Za-zЀ-ӿ]', desc):  # must contain letters
            continue
        candidates.append({'description': desc, 'amount': amount})

    if len(candidates) < 2:
        return None

    raw_sum = sum(c['amount'] for c in candidates)
    ratio = float(raw_sum / total)

    # Determine whether extracted amounts are gross (ratio≈1) or net (ratio≈1/1+vat)
    if 0.85 <= ratio <= 1.15:
        scale = Decimal('1')
    elif vat_rate and vat_rate > Decimal('0'):
        expected_net = float(Decimal('1') / (Decimal('1') + vat_rate / Decimal('100')))
        if abs(ratio - expected_net) <= 0.12:
            scale = Decimal('1') + vat_rate / Decimal('100')
        else:
            return None
    else:
        return None

    result = []
    for c in candidates:
        gross = (c['amount'] * scale).quantize(Decimal('0.01'))
        result.append({
            'description': c['description'],
            'quantity': Decimal('1'),
            'unit_price': gross,
            'line_total': gross,
            'vat_rate': None,
        })

    # Final check: gross sum must be within 15% of invoice total
    gross_sum = sum(r['line_total'] for r in result)
    if abs(float(gross_sum / total) - 1.0) > 0.15:
        return None

    return result


def extract_line_items(
    total: Optional[Decimal],
    ocr_lines: Optional[List[str]] = None,
    vat_rate: Optional[Decimal] = None,
) -> List[Dict]:
    """
    Extract line items. Tries to parse individual rows from OCR lines when
    available; falls back to a single synthetic item from the verified total.
    """
    if ocr_lines and total and total > Decimal('0'):
        parsed = _try_parse_line_items(ocr_lines, total, vat_rate)
        if parsed:
            return parsed
    gross = total or Decimal("0")
    return [{
        "description": "Услуги / Services",
        "quantity": Decimal("1"),
        "unit_price": gross,
        "line_total": gross,
        "vat_rate": None,
    }]


# ---------------------------------------------------------------------------
# Payment reference extraction — intentionally disabled
# ---------------------------------------------------------------------------

def extract_payment_reference(full_text: str) -> Optional[str]:
    # Bank account numbers are not extracted — always leave empty.
    return None


# ---------------------------------------------------------------------------
# Main extraction entry point
# ---------------------------------------------------------------------------

def extract_from_text(ocr_result: dict) -> Dict[str, Any]:
    """
    Extract structured invoice data from an OCR result dict.
    Returns a dict suitable for constructing an InvoiceRecord.
    """
    full_text = ocr_result["full_text"]
    lines: List[str] = []
    for page in ocr_result["pages"]:
        lines.extend(page["lines"])

    vendor_name = "Unknown vendor"
    try:
        vendor_name = extract_vendor_name(lines, full_text)
    except Exception as exc:
        logger.warning("vendor_name extraction failed: %s", exc)

    invoice_number = "N/A"
    try:
        invoice_number = extract_invoice_number(lines, full_text) or "N/A"
    except Exception as exc:
        logger.warning("invoice_number extraction failed: %s", exc)

    invoice_date = ""
    try:
        invoice_date, _ = extract_dates(lines, full_text)
        invoice_date = invoice_date or ""
    except Exception as exc:
        logger.warning("invoice_date extraction failed: %s", exc)

    total = Decimal("0")
    vat_rate: Optional[Decimal] = None
    try:
        financials = extract_financial_totals(full_text, lines)
        total = financials.get("total") or Decimal("0")
        vat_rate = financials.get("tax_rate")
    except Exception as exc:
        logger.warning("financial totals extraction failed: %s", exc)

    line_items = extract_line_items(total if total > 0 else None, ocr_lines=lines, vat_rate=vat_rate)

    # Komitent lookup
    # Pass 1: fuzzy-match the extracted vendor name against the registry (fast path).
    # Pass 2: if pass 1 misses or is low-confidence, reverse-scan the full OCR text for
    #         any komitent whose fingerprint tokens appear anywhere in the document.
    #         When pass 2 wins, vendor_name is updated to the registry name so the UI
    #         shows the canonical name rather than the raw (possibly noisy) OCR fragment.
    komitent_id: Optional[str] = None
    komitent_name: Optional[str] = None
    komitent_low_confidence: bool = False
    try:
        from pipeline.lookup import get_komitent_lookup
        kl = get_komitent_lookup()
        km = kl.match(vendor_name)
        if not km or km.get("low_confidence"):
            scan_km = kl.scan_text(full_text)
            # Reject if the scan matched the buyer (Diners Club appears in every invoice)
            if scan_km and not _BUYER_NAME_RE.search(scan_km["name"]):
                km = scan_km
                vendor_name = scan_km["name"]
        if km:
            komitent_id   = km["id"]
            komitent_name = km["name"]
            komitent_low_confidence = km.get("low_confidence", False)
    except Exception as _exc:
        logger.debug("Komitent lookup skipped: %s", _exc)

    result: Dict[str, Any] = {
        "vendor_name": vendor_name,
        "invoice_number": invoice_number,
        "invoice_date": invoice_date,
        "line_items": line_items,
        "total": total,
        "komitent_id": komitent_id,
        "komitent_name": komitent_name,
        "komitent_low_confidence": komitent_low_confidence,
    }

    logger.info(
        "Heuristic extraction: vendor='%s', inv_no='%s', total=%s",
        vendor_name, invoice_number, total,
    )
    return result
