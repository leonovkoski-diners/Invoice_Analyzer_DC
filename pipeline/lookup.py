"""
Komitent and Konten Plan lookup tables.
Loaded once at startup from XLS files in data/.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Macedonian Cyrillic → Latin transliteration (for cross-script fuzzy matching)
# ---------------------------------------------------------------------------
_MK_TRANSLIT = [
    # Multi-character substitutions first (order matters)
    ("Ш", "Sh"), ("Ч", "Ch"), ("Ж", "Zh"), ("Џ", "Dzh"), ("Ц", "Ts"),
    ("ш", "sh"), ("ч", "ch"), ("ж", "zh"), ("џ", "dzh"), ("ц", "ts"),
    # Single characters
    ("А", "A"), ("Б", "B"), ("В", "V"), ("Г", "G"), ("Д", "D"),
    ("Ѓ", "Gj"), ("Е", "E"), ("З", "Z"), ("Ѕ", "Dz"), ("И", "I"),
    ("Ј", "J"), ("К", "K"), ("Л", "L"), ("Љ", "Lj"), ("М", "M"),
    ("Н", "N"), ("Њ", "Nj"), ("О", "O"), ("П", "P"), ("Р", "R"),
    ("С", "S"), ("Т", "T"), ("Ќ", "Kj"), ("У", "U"), ("Ф", "F"),
    ("Х", "H"), ("а", "a"), ("б", "b"), ("в", "v"), ("г", "g"),
    ("д", "d"), ("ѓ", "gj"), ("е", "e"), ("з", "z"), ("ѕ", "dz"),
    ("и", "i"), ("ј", "j"), ("к", "k"), ("л", "l"), ("љ", "lj"),
    ("м", "m"), ("н", "n"), ("њ", "nj"), ("о", "o"), ("п", "p"),
    ("р", "r"), ("с", "s"), ("т", "t"), ("ќ", "kj"), ("у", "u"),
    ("ф", "f"), ("х", "h"),
]


def _transliterate_mk(text: str) -> str:
    """Transliterate Macedonian Cyrillic to Latin for fuzzy matching."""
    for cyr, lat in _MK_TRANSLIT:
        text = text.replace(cyr, lat)
    return text


# Suffixes to strip before fuzzy matching so they don't dominate the score
_SUFFIX_STRIP_RE = re.compile(
    r"\b(D?OO|DOOEL|dooел|АД|AD|EAD|ЕОД|EOD|SSD|КД|DOO\s+SKOPJE"
    r"|Skopje|Скопје|Skopjе|eksport|import|ekspor|импорт|извоз|увоз"
    r"|ekspres|ekspres|во земјата)\b",
    re.IGNORECASE,
)


def _normalize_for_match(text: str) -> str:
    """Transliterate Cyrillic → Latin, strip legal form suffixes, collapse spaces."""
    text = _transliterate_mk(text)          # Cyrillic → Latin first
    text = _SUFFIX_STRIP_RE.sub(" ", text)  # then strip Latin suffixes
    return " ".join(text.split())


# Vendor name aliases: (regex to detect vendor, canonical substring to find in registry).
# Checked before fuzzy matching — exact registry hit, no score threshold.
_VENDOR_ALIASES: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"\bca.?sys\b", re.IGNORECASE), "kasis"),
]

_DATA_DIR = Path(__file__).parent.parent / "data"
_KOMITENTI_PATH = _DATA_DIR / "Коминтенти.xls"
_KONTEN_PLAN_PATH = _DATA_DIR / "Контен план.xls"


# ---------------------------------------------------------------------------
# Komitent fuzzy lookup
# ---------------------------------------------------------------------------

class KomitentLookup:
    """Fuzzy vendor name matching against the komitent registry (Коминтенти.xls)."""

    def __init__(self, path: Path = _KOMITENTI_PATH) -> None:
        self._entries:    List[Tuple[str, str]] = []  # (id, name)
        self._names:      List[str] = []              # original names (for display)
        self._norm_names: List[str] = []              # normalized names (for matching)
        # fingerprint_tokens: normalized token → index of the ONE komitent it uniquely identifies.
        # Built at load time. Only tokens that appear in exactly one komitent name are kept.
        self._fingerprint_tokens: Dict[str, int] = {}
        self._load(path)

    def _load(self, path: Path) -> None:
        try:
            import xlrd  # type: ignore
            wb = xlrd.open_workbook(str(path))
            sh = wb.sheet_by_index(0)
            for r in range(1, sh.nrows):  # row 0 = header
                raw_id = sh.cell_value(r, 0)
                # xlrd reads numeric cells as floats; convert to int string
                if sh.cell_type(r, 0) == xlrd.XL_CELL_NUMBER:
                    komitent_id = str(int(raw_id))
                else:
                    komitent_id = str(raw_id).strip()
                name = str(sh.cell_value(r, 1)).strip()
                if komitent_id and name:
                    self._entries.append((komitent_id, name))
                    self._names.append(name)
                    self._norm_names.append(_normalize_for_match(name))
            logger.info("KomitentLookup: loaded %d entries from %s", len(self._entries), path.name)
            self._build_fingerprint_index()
        except Exception as exc:
            logger.warning("KomitentLookup: could not load %s: %s", path, exc)

    def _build_fingerprint_index(self) -> None:
        """Build reverse index of tokens that uniquely identify one komitent."""
        from collections import defaultdict
        tok_map: Dict[str, list] = defaultdict(list)
        for i, norm in enumerate(self._norm_names):
            for tok in norm.split():
                if len(tok) >= 4:
                    tok_map[tok.lower()].append(i)
        self._fingerprint_tokens = {
            tok: idxs[0]
            for tok, idxs in tok_map.items()
            if len(idxs) == 1
        }
        logger.debug("KomitentLookup: %d fingerprint tokens from %d entries", len(self._fingerprint_tokens), len(self._entries))

    def scan_text(self, full_text: str) -> Optional[Dict]:
        """
        Reverse-scan: find a komitent whose name tokens appear in the full OCR text.

        Unlike match(), which takes an already-extracted vendor string and fuzzy-matches
        it, this scans the entire document for any fingerprint token — a word that uniquely
        identifies exactly one komitent. If the OCR text contains "AKTON" and only one
        komitent in the registry has that token, we know the vendor is that komitent.

        Returns a match dict (same shape as match()) or None.
        """
        if not full_text or not self._fingerprint_tokens:
            return None
        try:
            norm_text = _normalize_for_match(full_text).lower()

            # Count how many fingerprint tokens from each komitent appear in the OCR text
            hits: Dict[int, int] = {}
            for tok, idx in self._fingerprint_tokens.items():
                if tok in norm_text:
                    hits[idx] = hits.get(idx, 0) + 1

            if not hits:
                return None

            best_idx = max(hits, key=lambda i: hits[i])
            logger.debug(
                "KomitentLookup.scan_text: best=%r hits=%d",
                self._names[best_idx], hits[best_idx],
            )
            return {
                "id": self._entries[best_idx][0],
                "name": self._names[best_idx],
                "score": 90.0,
                "low_confidence": False,
            }
        except Exception as exc:
            logger.warning("KomitentLookup.scan_text failed: %s", exc)
            return None

    def lookup_by_id(self, sifra: str) -> Optional[Dict]:
        """Exact lookup by komitent ID (sifra). Returns {id, name} or None."""
        target = sifra.strip()
        for entry_id, entry_name in self._entries:
            if entry_id == target:
                return {"id": entry_id, "name": entry_name}
        return None

    def match(self, vendor_name: str, threshold: int = 60) -> Optional[Dict]:
        """
        Fuzzy-match vendor_name against the komitent list.
        Also tries a Cyrillic→Latin transliteration of the query so that OCR
        in Cyrillic can match Latin-script entries in the registry.
        Returns {id, name, score, low_confidence} if score >= 45, else None.
        low_confidence=True when score is 45–59 (amber in the UI).
        """
        if not vendor_name or not self._names:
            return None
        try:
            from rapidfuzz import process, fuzz, utils  # type: ignore

            # Alias check — direct registry lookup, bypasses fuzzy matching entirely
            for alias_pat, canonical in _VENDOR_ALIASES:
                if alias_pat.search(vendor_name):
                    for i, norm in enumerate(self._norm_names):
                        if canonical.lower() in norm.lower():
                            logger.debug("KomitentLookup: alias %r → %r", vendor_name, self._names[i])
                            return {"id": self._entries[i][0], "name": self._names[i], "score": 100.0, "low_confidence": False}
                    break  # alias matched but no registry entry — fall through to fuzzy

            LOW_CONF_FLOOR = 45

            # Normalize the query (Cyrillic → Latin, strip legal suffixes)
            norm_query = _normalize_for_match(vendor_name)
            proc = utils.default_process

            logger.debug("KomitentLookup: matching %r (normalized: %r)", vendor_name, norm_query)

            # Pass 1: unique-token substrate — find a token that uniquely identifies ONE
            # komitent. This is the most reliable path and avoids WRatio false positives
            # caused by accidental English-word collisions (e.g. "ТРАДЕ"→"TRADE" matching
            # "Long Trade"). Tokens sorted longest-first, then alphabetically for stability.
            tokens = sorted(
                {t for t in norm_query.split() if len(t) >= 4},
                key=lambda t: (-len(t), t.lower()),
            )
            for token in tokens:
                token_lower = token.lower()
                matches = [i for i, n in enumerate(self._norm_names) if token_lower in n.lower()]
                if len(matches) == 1:
                    # Unique match — return it directly
                    idx = matches[0]
                    logger.debug("KomitentLookup: unique token %r → %r", token, self._names[idx])
                    return {"id": self._entries[idx][0], "name": self._names[idx], "score": 90.0, "low_confidence": False}
                elif 2 <= len(matches) <= 4:
                    # A few candidates — pick the best via WRatio among them
                    cands = [self._norm_names[i] for i in matches]
                    r = process.extractOne(norm_query, cands, scorer=fuzz.WRatio, processor=proc, score_cutoff=threshold)
                    if r:
                        _, score, rel_idx = r
                        idx = matches[rel_idx]
                        logger.debug("KomitentLookup: token %r best=%r score=%.1f", token, self._names[idx], score)
                        return {"id": self._entries[idx][0], "name": self._names[idx], "score": round(score, 1), "low_confidence": score < threshold}

            # Pass 2: full-string WRatio fallback — when no token uniquely identifies an
            # entry. Only accept a clear winner (≥5 points ahead of runner-up).
            top2 = process.extract(
                norm_query, self._norm_names,
                scorer=fuzz.WRatio,
                processor=proc,
                limit=2,
                score_cutoff=LOW_CONF_FLOOR,
            )
            if top2:
                if len(top2) == 1 or top2[0][1] >= top2[1][1] + 5:
                    _matched_norm, score, idx = top2[0]
                    logger.debug("KomitentLookup: WRatio best=%r score=%.1f", self._names[idx], score)
                    return {
                        "id": self._entries[idx][0],
                        "name": self._names[idx],
                        "score": round(score, 1),
                        "low_confidence": score < threshold,
                    }

            logger.debug("KomitentLookup: no match for %r", norm_query)
            return None
        except Exception as exc:
            logger.warning("KomitentLookup.match failed: %s", exc)
            return None


# ---------------------------------------------------------------------------
# Keyword → expense konto mapping (derived from Контен план descriptions)
# ---------------------------------------------------------------------------

# Each entry: (konto_code, keywords_list)
# Checked in order; first match wins.
_KONTO_KEYWORD_RULES: List[Tuple[str, List[str]]] = [
    # Electricity — 4030 ELEKTRI^NA ENERGIJA
    ("4030", ["gemak", "evn", "elektr", "struja", "струја", "kwh", "kw/h",
              "осветлув", "осветување", "дистрибуц", "distribuc", "електр", "energie"]),
    # Heating / district heat — 4031 TOPLINSKA ENERGIJA
    ("4031", ["toplin", "toplif", "toplana", "grejanje", "греење", "heating"]),
    # Fuel — 4032 GORIVO ZA MOTORNI VOZILA
    ("4032", ["gorivo", "nafta", "benzin", "dizel", "petrol", "fuel", "гориво", "нафта", "бензин"]),
    # Water / utilities — 4150 SNABDUVAWE SO VODA
    ("4150", ["komunalec", "vodovod", "voda ", " voda", "water", "водовод", "вода", "канализ"]),
    # Office materials — 4010 POTRO[EN KANCELARISKI MATERIJAL
    ("4010", ["kancelariski", "kancelar", "канцелар", "hartija", "paper", "toner", "тонер"]),
    # Cleaning materials — 4011
    ("4011", ["cistko", "chistko", "^istko", "cleanin", "чистко", "чистење"]),
    # Postal — 4110 PO[TENSKI USLUGI
    ("4110", ["po[tenski", "postensk", "пошт", "makedonska po[ta", "ptt"]),
    # Telephone — 4111 TELEFONSKI USLUGI
    ("4111", ["telefonski", "telekomunikac", "a1 mak", "one mak", "телефон", "telefon",
              "мобил", "mobil", "makedonski telekomunikacii"]),
    # Internet — 4112 INTERNET USLUGI
    ("4112", ["internet", "wifi", "broadband", "fiber", "adsl", "интернет"]),
    # Maintenance — 4130 USLUGI ZA TEKOVNO INVESTICIONO ODR@UVAWE
    ("4130", ["odr@uvawe", "odrzuvanje", "одржув", "поправк", "popravk", "tekovno", "investiciono",
              "maintenance", "servis"]),
    # Rent / lease — 4140 NAEMNINI ZA DELOVNI PROSTORII
    ("4140", ["naemnin", "kirija", "кирија", "закуп", "zakup", "renta", "najem", "leasing", "lizing", "наем"]),
    # Insurance — 4450 PREMII ZA OSIGURUVAWE
    ("4450", ["osigur", "polisa", "triglav", "uniqa", "grawe", "insurance", "осигур", "полиса"]),
    # Advertising — 4170 REKLAMIRAWE I PROPAGANDA
    ("4170", ["reklam", "marketing", "oglas", "реклам", "маркет", "огласув", "propaganda"]),
    # Notary — 44905
    ("44905", ["notarski", "нотар", "notary"]),
    # Legal / lawyer — 449051
    ("449051", ["advokat", "правни", "pravni", "legal", "lawyer", "адвокат"]),
    # IT services — 44907
    ("44907", ["software", "softver", "licenc", "лиценц", "cloud", "hosting",
               "saas", "erp", "it uslugi", "it service", "лиценза"]),
    # Consulting / accounting — 44902
    ("44902", ["konsultant", "sovetodav", "smetkovod", "revizija", "reviz", "audit",
               "консалт", "ревиз", "консултант"]),
    # Banking — 4460 BANKARSKI USLUGI
    ("4460", ["bankarski", "banking", "banka", "bank ", "provizija", "камата", "kamata",
              "commission", "банка", "провизија"]),
    # Transport / taxi — 4109
    ("4109", ["prevoz", "transport", "dostava", "logistik", "freight", "cargo",
              "delivery", "kurirsk", "куриерск", "достава", "превоз", "такси", "taxi"]),
    # Travel — 44000
    ("44000", ["hotel", "avion", "airlin", "letov", "dnevnic", "travel", "patuvanj",
               "хотел", "патувањ", "smestu", "сместув"]),
]

DEFAULT_EXPENSE_KONTO = "4499"  # OSTANATI TRO[OCI NA RABOTEWETO


# ---------------------------------------------------------------------------
# Konten Plan lookup
# ---------------------------------------------------------------------------

class KontenPlanLookup:
    """Loads the Konten Plan and provides konto suggestion by keyword."""

    def __init__(self, path: Path = _KONTEN_PLAN_PATH) -> None:
        self.accounts: Dict[str, str] = {}  # code → description
        self._load(path)

    def _load(self, path: Path) -> None:
        try:
            import xlrd  # type: ignore
            wb = xlrd.open_workbook(str(path))
            sh = wb.sheet_by_index(0)
            for r in range(1, sh.nrows):
                code = str(sh.cell_value(r, 0)).strip()
                desc = str(sh.cell_value(r, 1)).strip()
                if code and desc:
                    self.accounts[code] = desc
            logger.info("KontenPlanLookup: loaded %d accounts from %s", len(self.accounts), path.name)
        except Exception as exc:
            logger.warning("KontenPlanLookup: could not load %s: %s", path, exc)

    def suggest_konto(self, text: str) -> str:
        """Return the best expense konto code for the given OCR text. Never None."""
        if not text:
            return DEFAULT_EXPENSE_KONTO
        lower = text.lower()
        for konto, keywords in _KONTO_KEYWORD_RULES:
            for kw in keywords:
                if kw.lower() in lower:
                    return konto
        return DEFAULT_EXPENSE_KONTO

    def describe(self, konto: str) -> Optional[str]:
        """Return the description for a konto code."""
        return self.accounts.get(konto)


# ---------------------------------------------------------------------------
# Module-level singletons (initialized lazily)
# ---------------------------------------------------------------------------

_komitent_lookup: Optional[KomitentLookup] = None
_konten_plan_lookup: Optional[KontenPlanLookup] = None
_konto_learner = None  # type: ignore[var-annotated]


def get_komitent_lookup() -> KomitentLookup:
    global _komitent_lookup
    if _komitent_lookup is None:
        _komitent_lookup = KomitentLookup()
    return _komitent_lookup


def get_konten_plan_lookup() -> KontenPlanLookup:
    global _konten_plan_lookup
    if _konten_plan_lookup is None:
        _konten_plan_lookup = KontenPlanLookup()
    return _konten_plan_lookup


def get_konto_learner():
    """Return the singleton KontoLearner, initialised with the konten plan accounts."""
    global _konto_learner
    if _konto_learner is None:
        from pipeline.konto_learner import KontoLearner
        konten_plan = get_konten_plan_lookup()
        _konto_learner = KontoLearner(konten_plan.accounts)
    return _konto_learner


def init_lookups() -> None:
    """Pre-warm komitent and konten plan tables. Call at app startup.
    KontoLearner is intentionally left lazy — the sentence-transformers model
    (~470 MB) is loaded on the first extract request, not at startup.
    """
    get_komitent_lookup()
    get_konten_plan_lookup()
