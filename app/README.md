# Invoice Analyzer — Frontend

React + Vite dashboard for the local-VLM invoice processing pipeline. Implements the
Claude Design prototype (`Invoice Analyzer.dc.html`) against the project's infrastructure
described in [CLAUDE.md](./CLAUDE.md).

## Stack

- **React 19 + Vite** — SPA
- **React Router** — routing across the four views
- **Tailwind CSS v4** (`@tailwindcss/vite`) — design tokens in [src/index.css](src/index.css)
- **Recharts** — KPI sparklines and the 14-day volume chart

## Views

| Route | View | Notes |
| --- | --- | --- |
| `/` | Dashboard | 4 KPI cards w/ sparklines, volume chart, recent + needs-attention panels |
| `/invoices` | Invoice list | Search (vendor/number), status pills + date filters, status badges |
| `/invoices/:id` | Invoice detail | Dynamic fields grouped by category, validation-flag panel, independent line-item/total math re-verification |
| `/payments` | Payment run | Approved invoices due for the Friday run, multi-currency totals |

Upload modal (drag-drop → simulated on-device VLM extraction) and toast notifications
are global, rendered from the app shell.

## Design fidelity

The dense, exact px-level styling from the prototype is preserved with inline `style`
objects; Tailwind supplies the design tokens (navy `#1A1A6E`, paper surfaces, Inter /
Lora / JetBrains Mono fonts) and base layer. Money is formatted per-currency and never
rounded except in the explicit "≈ EUR" cross-currency aggregates; dates are stored ISO
8601 and only formatted for display — matching the pipeline contract in CLAUDE.md.

The invoice detail view **independently recomputes** the line-item sum and document
total (tolerance €0.01) rather than trusting the reported figures, and the
**Approve & Export** action is blocked while unresolved HIGH SEVERITY flags exist.

Seed data in [src/data/seed.js](src/data/seed.js) stands in for the FastAPI pipeline so
the UI runs offline; state (uploads, exports) is in-session and resets on reload.

## Real extraction (no hardcoded data)

Uploads are analyzed by the **local VLM pipeline** over a FastAPI service — the
frontend never fabricates extracted data. The flow:

1. The upload modal POSTs the file to `POST /api/extract` ([api/main.py](../api/main.py)).
2. The service runs `extractor → post_processor` and returns the verified
   `InvoiceRecord` + validation flags.
3. The UI builds the invoice from that response and derives a balanced
   double-entry journal ([src/lib/journal.js](src/lib/journal.js)).

If the model weights aren't installed, `/api/extract` returns **503** and the
upload modal shows an honest "engine unavailable" message — it does **not** make
up data.

### Run the backend (from the repo root)

```bash
pip install -r requirements.txt
uvicorn api.main:app --port 8000
```

**Model:** the engine uses a llama.cpp-supported **vision** GGUF plus its
**mmproj** projector. Currently running **Qwen3-VL-2B-Instruct**:

```
models/
  Qwen3VL-2B-Instruct-Q4_K_M.gguf      # the model
  mmproj-Qwen3VL-2B-Instruct-F16.gguf  # the vision projector (required)
```

(Llama 3.2 Vision / `mllama` is *not* supported by llama.cpp and won't load.)
The service auto-discovers both files — it skips unsupported architectures and
pairs the projector to the model by name. Env overrides:

- `INVOICE_MODEL_PATH` / `INVOICE_MMPROJ_PATH` — bypass discovery.
- `INVOICE_N_CTX` (default 8192) — context window (headroom for image tokens).
- `INVOICE_N_GPU_LAYERS` (default `-1` = offload all) — GPU layers; set `0` to
  force CPU. **Using the GPU requires a GPU-enabled llama-cpp-python build.** For
  an Intel/AMD *integrated* GPU that means the **Vulkan** backend:
  `pip install llama-cpp-python --force-reinstall --no-cache-dir` with
  `CMAKE_ARGS="-DGGML_VULKAN=on"` (and the Vulkan SDK installed). On the default
  CPU-only wheel this setting is a harmless no-op and inference stays on the CPU.

PDF input needs **poppler** — the extractor auto-detects it under `C:\poppler` /
`Program Files`, or set `POPPLER_PATH`.

`GET /api/health` reports `ready` (model supported **and** projector present),
`model_arch`, and what's missing. The upload dialog shows this status live, and
`/api/extract` returns a clear 503 (never fabricated data) when the engine isn't
ready. The frontend reads the API base from `VITE_API_BASE` (default
`http://localhost:8000`).

## Review screen

The invoice detail view is the review workspace: an **editable double-entry
journal (Кniženje)** with live balanced check and group-by-konto, the extracted
fields as cards, an independent amounts re-verification (tolerance €0.01),
**Approve / Reject** with a booking date and a pending-queue Previous/Next, and
the source document side-by-side. The dashboard adds **financial analytics**
(net expenses, VAT, active vendors, journal health, plus monthly-trend,
top-vendor and currency charts) computed live from the invoice set.

## Scripts

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
npm run lint
```
