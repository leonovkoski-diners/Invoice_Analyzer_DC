// Client for the local FastAPI extraction service.
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

export async function getHealth() {
  const res = await fetch(`${API_BASE}/api/health`, { method: 'GET' })
  if (!res.ok) throw new Error(`Health check failed (${res.status})`)
  return res.json()
}

// Upload a document for full extraction. Returns the extraction response or throws.
export async function extractDocument(file) {
  const form = new FormData()
  form.append('file', file)

  let res
  try {
    res = await fetch(`${API_BASE}/api/extract`, { method: 'POST', body: form })
  } catch {
    throw new Error(
      `Could not reach the extraction service at ${API_BASE}. Start it with: uvicorn api.main:app --port 8000`,
    )
  }

  let payload
  try {
    payload = await res.json()
  } catch {
    payload = null
  }

  if (!res.ok) {
    const msg = (payload && payload.message) || `Extraction failed (HTTP ${res.status}).`
    throw new Error(msg)
  }
  return payload
}

// Upload a document and return only the raw OCR text (for template creation).
export async function getOcrText(file) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/api/ocr-text`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`OCR text extraction failed (HTTP ${res.status})`)
  return res.json()
}

// ---------------------------------------------------------------------------
// Vendor Template API
// ---------------------------------------------------------------------------

export async function getTemplates() {
  const res = await fetch(`${API_BASE}/api/templates`)
  if (!res.ok) throw new Error(`Failed to load templates (${res.status})`)
  return res.json() // { templates: [...] }
}

export async function saveTemplate(template) {
  const res = await fetch(`${API_BASE}/api/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Save failed (${res.status})`)
  }
  return res.json() // { template: {...} }
}

export async function saveTemplateFromInvoice({ display_name, keywords, ocr_text, extracted }) {
  const res = await fetch(`${API_BASE}/api/templates/save-from-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name, keywords, ocr_text, extracted }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Save failed (${res.status})`)
  }
  return res.json()
}

// Analyze a keyword (or comma-separated keywords) against OCR text and return
// the auto-generated regex pattern with type/confidence metadata.
export async function analyzeKeyword(keywords, ocrText) {
  const res = await fetch(`${API_BASE}/api/templates/analyze-keyword`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords, ocr_text: ocrText }),
  })
  if (!res.ok) throw new Error(`Keyword analysis failed (${res.status})`)
  return res.json() // { pattern, value, type, confidence, keyword_used }
}

// Set or clear a single template default value.
// field: 'vendor_name' | 'komitent_name' | 'komitent_sifra'
// value: string to set, null to clear
export async function setTemplateDefault(templateId, field, value) {
  const res = await fetch(`${API_BASE}/api/templates/${encodeURIComponent(templateId)}/defaults`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field, value: value ?? null }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to save default (${res.status})`)
  }
  return res.json() // { template: {...} }
}

export async function deleteTemplate(id) {
  const res = await fetch(`${API_BASE}/api/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Delete failed (${res.status})`)
  }
  return res.json()
}
