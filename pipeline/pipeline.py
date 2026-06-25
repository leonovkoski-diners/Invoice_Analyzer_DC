"""
Invoice Analyzer — Pipeline Orchestrator (OCR Edition)
=======================================================
The VLM (Qwen3VL / llama-cpp-python) has been replaced with a deterministic
local OCR pipeline. No model files, no GPU, instant startup.

Processing stages:
  1. EasyOCR extraction  — image/PDF → structured text
  2. Template matching   — known vendor? use its exact regex patterns
  3. Field extraction    — template or universal heuristic extractor
  4. Schema validation   — Pydantic InvoiceRecord
  5. Arithmetic check    — deterministic post_processor (unchanged)
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, List, Optional

from pipeline.ocr import extract_text_from_file
from pipeline.templates import find_matching_template, apply_template
from pipeline.heuristic import extract_from_text, structure_ocr_text
from pipeline.post_processor import post_process
from pipeline.schema import InvoiceRecord

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------

@dataclass
class ProcessingResult:
    """Returned by InvoicePipeline.process()"""

    record: Optional[InvoiceRecord] = None
    flags: List[str] = field(default_factory=list)
    error: Optional[str] = None
    processing_time_seconds: float = 0.0
    source_file: str = ""
    page_count: int = 0
    template_used: Optional[str] = None  # template ID if a vendor template matched
    ocr_text: str = ""                   # raw OCR text (for UI debug drawer)

    @property
    def success(self) -> bool:
        return self.record is not None and self.error is None

    @property
    def has_warnings(self) -> bool:
        return len(self.flags) > 0

    @property
    def has_errors(self) -> bool:
        return any("HIGH SEVERITY" in f for f in self.flags)

    @property
    def flag_summary(self) -> str:
        if not self.flags:
            return "✓ All checks passed"
        lines = [f"⚠ {len(self.flags)} validation flag(s):"]
        for f in self.flags:
            prefix = "🔴" if "HIGH SEVERITY" in f else "🟡"
            lines.append(f"  {prefix} {f}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

class InvoicePipeline:
    """
    OCR-based invoice processing pipeline. No model loading required.
    EasyOCR is initialized lazily on first use.
    """

    def __init__(self, progress_callback: Optional[Callable[[str, int], None]] = None):
        self._progress = progress_callback or (lambda stage, pct: None)

    def _emit(self, stage: str, pct: int) -> None:
        logger.info(f"[{pct:3d}%] {stage}")
        self._progress(stage, pct)

    def process(self, file_path: str | Path) -> ProcessingResult:
        """
        Process a single invoice file end-to-end.
        Returns a ProcessingResult — always returns, never raises.
        """
        file_path = Path(file_path)
        result = ProcessingResult(source_file=str(file_path))
        start = time.time()

        try:
            # ── Stage 1: OCR ─────────────────────────────────────────────
            self._emit("Running OCR extraction...", 15)
            ocr_result = extract_text_from_file(file_path)
            result.page_count = ocr_result["page_count"]

            full_text = ocr_result["full_text"]
            lines = []
            for page in ocr_result["pages"]:
                lines.extend(page["lines"])

            structured_lines = structure_ocr_text(lines)
            result.ocr_text = "\n".join(structured_lines)

            # ── Stage 2: Template matching ────────────────────────────────
            self._emit("Matching vendor template...", 40)
            template = find_matching_template(full_text)

            # ── Stage 3: Field extraction ─────────────────────────────────
            self._emit("Extracting invoice fields...", 60)
            if template:
                result.template_used = template["id"]
                extracted = apply_template(template, full_text, lines)
            else:
                extracted = extract_from_text(ocr_result, file_path=str(file_path))

            # ── Stage 4: Schema validation ────────────────────────────────
            self._emit("Validating schema...", 75)
            try:
                record = InvoiceRecord(**extracted)
            except Exception as e:
                result.error = f"Schema validation failed: {e}"
                result.flags.append(f"SCHEMA_ERROR: {e}")
                logger.error(f"Schema parsing failed: {e}")
                result.processing_time_seconds = time.time() - start
                return result

            # ── Stage 5: Arithmetic verification ─────────────────────────
            self._emit("Verifying arithmetic and dates...", 88)
            verified_record, flags = post_process(record)
            result.record = verified_record
            result.flags = flags

            # ── Done ──────────────────────────────────────────────────────
            elapsed = time.time() - start
            result.processing_time_seconds = elapsed
            tmpl_note = f" (template: {result.template_used})" if result.template_used else " (heuristic)"
            self._emit(f"Complete in {elapsed:.1f}s{tmpl_note}", 100)

            if result.has_errors:
                logger.warning(f"Complete with HIGH SEVERITY flags: {file_path.name}")
            elif result.has_warnings:
                logger.info(f"Complete with warnings: {file_path.name}")
            else:
                logger.info(f"Complete — clean: {file_path.name}")

        except FileNotFoundError as e:
            result.error = str(e)
            logger.error(f"File not found: {e}")
        except ValueError as e:
            result.error = f"Extraction error: {e}"
            logger.error(f"Extraction failed: {e}")
        except Exception as e:
            result.error = f"Unexpected error: {type(e).__name__}: {e}"
            logger.exception(f"Unexpected error processing {file_path}")

        result.processing_time_seconds = time.time() - start
        return result
