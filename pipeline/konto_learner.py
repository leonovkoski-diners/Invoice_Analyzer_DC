"""
Embedding-based Konto suggestion with learning from human corrections.

Uses sentence-transformers (paraphrase-multilingual-MiniLM-L12-v2) running
entirely locally — no external API calls, no internet required after the
first model download (~470 MB, cached in ~/.cache/huggingface/).

Flow
----
suggest():
  1. Embed the focused OCR text.
  2. Compare against all saved corrections (cosine similarity).
     If best match >= CORRECTION_THRESHOLD  →  use that correction's konto.
  3. Compare against pre-embedded konto descriptions from the chart of accounts.
     If best match >= EMBEDDING_THRESHOLD   →  use that konto.
  4. Fall back to caller-supplied keyword function (the old rule-based method).

learn():
  Embed the focused OCR text and persist (embedding, konto) so future invoices
  of the same type are recognised. Near-duplicates (>=DEDUP_THRESHOLD) update
  the existing record instead of creating a new one.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
CORRECTIONS_PATH = Path(__file__).parent.parent / "data" / "konto_corrections.json"

CORRECTION_THRESHOLD = 0.82   # cosine sim to trust a learned correction
EMBEDDING_THRESHOLD  = 0.35   # cosine sim to trust a konto description match
DEDUP_THRESHOLD      = 0.95   # cosine sim above which we update instead of append

_DESCRIPTION_KEYWORDS = [
    "услуг", "service", "опис", "предмет", "назив", "description",
    "производ", "product", "наслов", "title",
]


class KontoLearner:
    """
    Embedding-based Konto suggestion that improves over time.
    The sentence-transformers model loads lazily on first use.
    """

    def __init__(self, konten_plan: Dict[str, str]) -> None:
        self._konten_plan = konten_plan  # code → description (from KontenPlanLookup)
        self._model = None
        self._konto_codes: List[str] = []
        self._konto_embeddings: Optional[np.ndarray] = None
        self._corrections: List[dict] = []
        self._correction_embeddings: Optional[np.ndarray] = None
        self._load_corrections()

    # ------------------------------------------------------------------
    # Model access (lazy)
    # ------------------------------------------------------------------

    def _get_model(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            logger.info("KontoLearner: loading model %s (first use)…", MODEL_NAME)
            self._model = SentenceTransformer(MODEL_NAME)
            logger.info("KontoLearner: model ready.")
        return self._model

    def _embed(self, text: str) -> np.ndarray:
        return self._get_model().encode(text, normalize_embeddings=True).astype(np.float32)

    def _embed_batch(self, texts: List[str]) -> np.ndarray:
        return self._get_model().encode(texts, normalize_embeddings=True).astype(np.float32)

    # ------------------------------------------------------------------
    # Konto description embeddings (built once, on first suggest call)
    # ------------------------------------------------------------------

    def _build_konto_embeddings(self) -> None:
        # Restrict to expense accounts (4xxx) — we never want to suggest
        # balance-sheet codes (1xxx, 2xxx) for invoice expense lines.
        expense = {k: v for k, v in self._konten_plan.items() if k.startswith("4")}
        if not expense:
            expense = self._konten_plan
        codes = list(expense.keys())
        descs = [expense[c] for c in codes]
        logger.info("KontoLearner: embedding %d konto descriptions…", len(codes))
        self._konto_codes = codes
        self._konto_embeddings = self._embed_batch(descs)
        logger.info("KontoLearner: konto embeddings ready.")

    # ------------------------------------------------------------------
    # Corrections persistence
    # ------------------------------------------------------------------

    def _load_corrections(self) -> None:
        if not CORRECTIONS_PATH.exists():
            return
        try:
            data = json.loads(CORRECTIONS_PATH.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                return
            self._corrections = data
            if data:
                self._correction_embeddings = np.array(
                    [c["embedding"] for c in data], dtype=np.float32
                )
            logger.info("KontoLearner: loaded %d corrections.", len(data))
        except Exception as exc:
            logger.warning("KontoLearner: could not load corrections: %s", exc)

    def _save_corrections(self) -> None:
        try:
            CORRECTIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
            CORRECTIONS_PATH.write_text(
                json.dumps(self._corrections, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as exc:
            logger.warning("KontoLearner: could not save corrections: %s", exc)

    # ------------------------------------------------------------------
    # Text focus — concentrate semantic signal for embedding
    # ------------------------------------------------------------------

    def _focus_text(self, ocr_text: str) -> str:
        """
        Returns a focused string (<=500 chars) for embedding.
        Takes the header area (usually vendor + doc type) and any lines
        that mention service/product description keywords.
        """
        header = ocr_text[:350]
        desc_lines = [
            ln.strip()
            for ln in ocr_text.splitlines()
            if any(kw in ln.lower() for kw in _DESCRIPTION_KEYWORDS)
        ]
        extra = " ".join(desc_lines[:4])
        return f"{header} {extra}".strip()[:500]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def suggest(
        self,
        ocr_text: str,
        keyword_fallback: Optional[Callable[[str], str]] = None,
    ) -> Tuple[str, str, float]:
        """
        Return (konto_code, method, confidence).

        method values:
          'learned_correction' — matched a saved human correction
          'embedding_match'    — matched a konto description by embedding
          'keyword'            — fell back to the keyword rule list
          'default'            — 4499, nothing matched
        """
        if not ocr_text:
            konto = keyword_fallback(ocr_text) if keyword_fallback else "4499"
            return (konto, "keyword" if keyword_fallback else "default", 0.0)

        text = self._focus_text(ocr_text)

        try:
            emb = self._embed(text)

            # 1. Learned corrections (highest priority)
            if self._correction_embeddings is not None and self._corrections:
                sims = self._correction_embeddings @ emb
                best_idx = int(np.argmax(sims))
                best_sim = float(sims[best_idx])
                if best_sim >= CORRECTION_THRESHOLD:
                    konto = self._corrections[best_idx]["konto"]
                    logger.info(
                        "KontoLearner: correction match konto=%s sim=%.3f", konto, best_sim
                    )
                    return (konto, "learned_correction", round(best_sim, 3))

            # 2. Embedding match against konto descriptions
            if self._konto_embeddings is None:
                self._build_konto_embeddings()

            if self._konto_embeddings is not None and self._konto_codes:
                sims = self._konto_embeddings @ emb
                best_idx = int(np.argmax(sims))
                best_sim = float(sims[best_idx])
                if best_sim >= EMBEDDING_THRESHOLD:
                    konto = self._konto_codes[best_idx]
                    logger.info(
                        "KontoLearner: embedding match konto=%s sim=%.3f", konto, best_sim
                    )
                    return (konto, "embedding_match", round(best_sim, 3))

        except Exception as exc:
            logger.warning("KontoLearner.suggest failed: %s", exc)

        # 3. Keyword fallback
        if keyword_fallback:
            konto = keyword_fallback(ocr_text)
            return (konto, "keyword", 0.0)

        return ("4499", "default", 0.0)

    def learn(
        self,
        ocr_text: str,
        konto: str,
        komitent_id: Optional[str] = None,
    ) -> None:
        """
        Record a human-confirmed konto for this invoice's OCR pattern.
        Near-duplicates (similarity >= DEDUP_THRESHOLD) update the existing
        entry instead of appending a new one.
        """
        if not ocr_text or not konto:
            return
        text = self._focus_text(ocr_text)
        try:
            emb = self._embed(text)

            # Update existing entry if near-duplicate
            if self._correction_embeddings is not None and self._corrections:
                sims = self._correction_embeddings @ emb
                best_idx = int(np.argmax(sims))
                if float(sims[best_idx]) >= DEDUP_THRESHOLD:
                    self._corrections[best_idx] = {
                        "embedding": emb.tolist(),
                        "konto": konto,
                        "komitent_id": komitent_id,
                        "preview": ocr_text[:120],
                    }
                    self._correction_embeddings[best_idx] = emb
                    self._save_corrections()
                    logger.info(
                        "KontoLearner: updated correction idx=%d konto=%s", best_idx, konto
                    )
                    return

            # New entry
            entry = {
                "embedding": emb.tolist(),
                "konto": konto,
                "komitent_id": komitent_id,
                "preview": ocr_text[:120],
            }
            self._corrections.append(entry)
            if self._correction_embeddings is None:
                self._correction_embeddings = emb.reshape(1, -1)
            else:
                self._correction_embeddings = np.vstack(
                    [self._correction_embeddings, emb]
                )
            self._save_corrections()
            logger.info("KontoLearner: saved new correction konto=%s", konto)

        except Exception as exc:
            logger.warning("KontoLearner.learn failed: %s", exc)

    def correction_count(self) -> int:
        return len(self._corrections)
