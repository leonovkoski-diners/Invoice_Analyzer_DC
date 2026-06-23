import { useEffect, useRef, useState } from 'react'
import { getTemplates, saveTemplate, deleteTemplate, getOcrText, analyzeKeyword } from '../lib/api'

// ---------------------------------------------------------------------------
// Style constants (matches existing app design system)
// ---------------------------------------------------------------------------
const mono = { fontFamily: "'JetBrains Mono', monospace" }
const sectionLabel = { ...mono, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9A9AAC' }
const card = { background: '#fff', border: '1px solid #E8E8E2', borderRadius: 10, overflow: 'hidden' }

const PATTERN_FIELDS = [
  { key: 'vendor_name',       label: 'Назив на добавувачот' },
  { key: 'vendor_vat_id',     label: 'EDБ број' },
  { key: 'invoice_number',    label: 'Број на фактура' },
  { key: 'invoice_date',      label: 'Датум на фактура' },
  { key: 'due_date',          label: 'Рок на плаќање' },
  { key: 'subtotal',          label: 'Основа (нето)' },
  { key: 'tax_rate',          label: 'ДДВ стапка %' },
  { key: 'tax_amount',        label: 'Износ на ДДВ' },
  { key: 'total',             label: 'Вкупно (бруто)' },
  { key: 'payment_reference', label: 'Референца за плаќање' },
]

// Example keywords shown as placeholder text per field
const FIELD_PLACEHOLDER = {
  vendor_name:       'Фирма, ДОО',
  vendor_vat_id:     'МК, ЕДБ',
  invoice_number:    'ФАКТУРА, број',
  invoice_date:      'Датум',
  due_date:          'Рок, валута',
  subtotal:          'Основа, без ДДВ',
  tax_rate:          'ДДВ %',
  tax_amount:        'ДДВ износ',
  total:             'Вкупно, За наплата',
  payment_reference: 'Референца',
}

const TYPE_COLORS = {
  invoice_number: { bg: '#E8F0FF', text: '#1A1A6E' },
  date:           { bg: '#E8F5EE', text: '#0D5C44' },
  amount:         { bg: '#FFF5E8', text: '#7A4100' },
  vat_id:         { bg: '#F5E8FF', text: '#3D1C8E' },
  text:           { bg: '#F0F0EC', text: '#5A5A6E' },
}

// NFC-normalize + lowercase for local pre-check
function _nfc(s) { return s.normalize('NFC').toLowerCase() }

// Quick local search before hitting the API — returns 'exact', 'fuzzy', or null
function localKeywordSearch(kw, ocrText) {
  const kwN = _nfc(kw.trim())
  const ocrN = _nfc(ocrText)
  if (!kwN) return null
  if (ocrN.includes(kwN)) return 'exact'
  // fuzzy: all whitespace-separated words must appear within a 50-char window
  const words = kwN.split(/\s+/).filter(Boolean)
  if (words.length > 1) {
    for (let i = 0; i < ocrN.length - 1; i++) {
      const win = ocrN.slice(i, i + 50)
      if (words.every(w => win.includes(w))) return 'fuzzy'
    }
  }
  return null
}

// Show first N chars of a string as "U+XXXX" codepoints
function codepoints(str, n = 5) {
  return Array.from(str.trim().slice(0, n))
    .map(c => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ')
}

// ---------------------------------------------------------------------------
// Single field row: keyword input + live preview + Advanced toggle
// ---------------------------------------------------------------------------
function FieldKeywordRow({ fieldKey, label, ocrText, initialKeywords, initialPattern, onUpdate }) {
  const startAdvanced = !!initialPattern && !initialKeywords
  const [keywords,      setKeywords]      = useState(initialKeywords || '')
  const [preview,       setPreview]       = useState(null)
  const [analyzing,     setAnalyzing]     = useState(false)
  const [advanced,      setAdvanced]      = useState(startAdvanced)
  const [manualPattern, setManualPattern] = useState(initialPattern || '')
  const debounceRef  = useRef(null)
  const mountedRef   = useRef(true)
  const onUpdateRef  = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  useEffect(() => () => {
    mountedRef.current = false
    clearTimeout(debounceRef.current)
  }, [])

  // Re-analyze whenever keywords or OCR text change (auto mode only)
  useEffect(() => {
    if (advanced) return
    clearTimeout(debounceRef.current)
    if (!ocrText || !keywords.trim()) {
      setPreview(null)
      onUpdateRef.current(fieldKey, { pattern: null, keywords })
      return
    }
    // Save keyword hint immediately so it persists even if user saves before API responds
    onUpdateRef.current(fieldKey, { pattern: null, keywords })
    debounceRef.current = setTimeout(async () => {
      if (!mountedRef.current) return
      setAnalyzing(true)
      // NFC-normalize both strings before sending to backend
      const kwNorm  = keywords.normalize('NFC').trim()
      const ocrNorm = ocrText.normalize('NFC')
      const localHit = localKeywordSearch(kwNorm, ocrNorm)
      try {
        const res = await analyzeKeyword(kwNorm, ocrNorm)
        if (!mountedRef.current) return
        const p = res && res.value ? res : null
        setPreview(
          p ||
          (res?.debug_patterns ? { _debug: res.debug_patterns, _localHit: localHit, _kw: kwNorm } : null) ||
          (!localHit ? { _notFound: true, _kw: kwNorm } : null)
        )
        onUpdateRef.current(fieldKey, { pattern: p?.pattern || null, keywords })
      } catch {
        if (mountedRef.current) setPreview({ _notFound: true, _kw: kwNorm })
      } finally {
        if (mountedRef.current) setAnalyzing(false)
      }
    }, 500)
    return () => clearTimeout(debounceRef.current)
  }, [keywords, ocrText])  // eslint-disable-line react-hooks/exhaustive-deps

  function handleToggleAdvanced() {
    const next = !advanced
    setAdvanced(next)
    if (next) {
      // Entering advanced mode: seed with generated pattern if manual is empty
      const seed = !manualPattern && preview?.pattern ? preview.pattern : manualPattern
      if (seed !== manualPattern) setManualPattern(seed)
      onUpdateRef.current(fieldKey, { pattern: seed || null, keywords })
    } else {
      // Back to auto: use whatever the last analysis produced
      onUpdateRef.current(fieldKey, { pattern: preview?.pattern || null, keywords })
    }
  }

  function handleManualChange(val) {
    setManualPattern(val)
    onUpdateRef.current(fieldKey, { pattern: val || null, keywords })
  }

  function handleKeywordsChange(val) {
    setKeywords(val)
    // Effect handles debounced analysis + onUpdate
  }

  const tc = TYPE_COLORS[preview?.type] || TYPE_COLORS.text
  const isDisabled = !ocrText && !advanced

  return (
    <div style={{ padding: '10px 12px', background: '#FAFAF8', borderRadius: 8, border: '1px solid #EEEEE8' }}>
      {/* Row header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 11, color: '#6A6A7E', fontWeight: 500 }}>{label}</span>
        <button
          type="button"
          onClick={handleToggleAdvanced}
          style={{
            fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px',
            color: advanced ? '#1A1A6E' : '#A0A0B8', fontWeight: advanced ? 700 : 400,
            borderRadius: 3,
          }}
        >
          {advanced ? '▲ Напредно' : '▼ Напредно'}
        </button>
      </div>

      {/* Keyword input */}
      <input
        type="text"
        value={keywords}
        onChange={(e) => handleKeywordsChange(e.target.value)}
        placeholder={
          advanced
            ? `Клучни зборови (опционално)…`
            : ocrText
              ? `Клучни зборови… пр. "${FIELD_PLACEHOLDER[fieldKey] || label}"`
              : 'Прикачи фактура подолу за паметен режим…'
        }
        disabled={isDisabled}
        style={{
          width: '100%', boxSizing: 'border-box',
          border: '1px solid #E2E2DC', borderRadius: 6, padding: '6px 9px',
          fontSize: 12, color: '#16161F',
          background: isDisabled ? '#F4F4F2' : '#fff',
          outline: 'none', marginBottom: advanced ? 6 : 0,
        }}
      />

      {/* Live preview (auto mode only) */}
      {!advanced && (
        <div style={{ minHeight: 20, marginTop: 4 }}>
          {analyzing && (
            <span style={{ fontSize: 10.5, color: '#9A9AAC', fontStyle: 'italic' }}>Се анализира…</span>
          )}
          {!analyzing && preview && !preview._debug && !preview._notFound && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: preview.confidence === 'ok' ? '#0D5C44' : '#7A4100', lineHeight: 1 }}>
                {preview.confidence === 'ok' ? '✓' : '?'}
              </span>
              <span style={{ ...mono, fontSize: 9.5, padding: '1px 5px', borderRadius: 3, background: tc.bg, color: tc.text }}>
                {preview.type}
              </span>
              {preview.keyword_used && preview.keyword_used !== keywords.trim() && (
                <span style={{ fontSize: 10, color: '#9A9AAC' }}>via "{preview.keyword_used}"</span>
              )}
              <span style={{ fontSize: 11, color: '#16161F' }}>→ <strong>{preview.value}</strong></span>
            </div>
          )}
          {!analyzing && (preview?._debug || preview?._notFound) && keywords.trim() && ocrText && (
            <div>
              <span style={{ fontSize: 10.5, color: '#8B1A1A' }}>
                ⚠ Не е пронајдено во OCR текстот
                {preview._localHit && <span style={{ color: '#7A4100' }}> (локален {preview._localHit} совпаѓање — regex несовпаѓање)</span>}
              </span>
              {preview._debug && Object.entries(preview._debug).map(([kw, pat]) => (
                <div key={kw} style={{ ...mono, fontSize: 9, color: '#5A3A3A', marginTop: 2, wordBreak: 'break-all' }}>
                  {pat}
                </div>
              ))}
              {preview._kw && (
                <div style={{ ...mono, fontSize: 9, color: '#9A5A5A', marginTop: 3 }}>
                  chars: {codepoints(preview._kw)}
                </div>
              )}
            </div>
          )}
          {!analyzing && !ocrText && (
            <span style={{ fontSize: 10.5, color: '#C0C0CC' }}>Прикачи фактура за да видиш преглед</span>
          )}
        </div>
      )}

      {/* Advanced: manual regex override */}
      {advanced && (
        <div>
          <input
            type="text"
            value={manualPattern}
            onChange={(e) => handleManualChange(e.target.value)}
            placeholder="Прилагоден regex шаблон со (capture group)…"
            spellCheck={false}
            style={{
              width: '100%', boxSizing: 'border-box',
              border: '1px solid #D0D0F0', borderRadius: 6, padding: '6px 9px',
              fontSize: 11, color: '#16161F', background: '#F8F8FF', outline: 'none',
              ...mono,
            }}
          />
          {manualPattern && (
            <div style={{ marginTop: 3, fontSize: 10, color: '#1A1A6E' }}>✓ Рачна замена е активна</div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Template form — smart keyword builder
// ---------------------------------------------------------------------------
function TemplateForm({ initial, onSave, onCancel, saving }) {
  const [meta, setMeta] = useState({
    id:           initial?.id || '',
    display_name: initial?.display_name || '',
    currency:     initial?.currency || 'MKD',
  })
  const [keywordsRaw, setKeywordsRaw] = useState((initial?.keywords || []).join(', '))

  // Collected from FieldKeywordRow children
  const [fieldPatterns,     setFieldPatterns]     = useState(
    Object.fromEntries(PATTERN_FIELDS.map((f) => [f.key, initial?.patterns?.[f.key]     || null]))
  )
  const [fieldKeywordHints, setFieldKeywordHints] = useState(
    Object.fromEntries(PATTERN_FIELDS.map((f) => [f.key, initial?.keyword_hints?.[f.key] || '']))
  )

  // OCR text for smart mode
  const [ocrText,    setOcrText]    = useState('')
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrError,   setOcrError]   = useState(null)
  const [ocrFile,    setOcrFile]    = useState(null)
  const ocrInputRef = useRef()

  function handleFieldUpdate(key, { pattern, keywords }) {
    setFieldPatterns((p)     => ({ ...p,     [key]: pattern  }))
    setFieldKeywordHints((p) => ({ ...p,     [key]: keywords }))
  }

  async function loadOcr(file) {
    if (!file) return
    setOcrFile(file)
    setOcrLoading(true)
    setOcrError(null)
    try {
      const data = await getOcrText(file)
      setOcrText(data.full_text || '')
    } catch (e) {
      setOcrError(e.message)
    } finally {
      setOcrLoading(false)
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    const keywords = keywordsRaw.split(',').map((k) => k.trim()).filter(Boolean)
    const patterns = {}
    const keyword_hints = {}
    for (const f of PATTERN_FIELDS) {
      patterns[f.key]      = fieldPatterns[f.key]      || null
      if (fieldKeywordHints[f.key]) keyword_hints[f.key] = fieldKeywordHints[f.key]
    }
    onSave({ ...meta, keywords, currency: meta.currency || 'MKD', patterns, keyword_hints })
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    border: '1px solid #E2E2DC', borderRadius: 6, padding: '6px 9px',
    fontSize: 12.5, color: '#16161F', background: '#fff', outline: 'none',
  }
  const labelStyle = { fontSize: 11, color: '#8A8A9C', marginBottom: 3, display: 'block' }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Top: display_name + currency */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
        <div>
          <label style={labelStyle}>Прикажано име на добавувачот *</label>
          <input
            style={inputStyle}
            value={meta.display_name}
            onChange={(e) => setMeta((m) => ({ ...m, display_name: e.target.value }))}
            placeholder="e.g. ЕВН Македонија"
            required
          />
        </div>
        <div style={{ width: 80 }}>
          <label style={labelStyle}>Валута</label>
          <input
            style={inputStyle}
            value={meta.currency}
            onChange={(e) => setMeta((m) => ({ ...m, currency: e.target.value.toUpperCase() }))}
            placeholder="MKD"
          />
        </div>
      </div>

      <div>
        <label style={labelStyle}>
          Клучни зборови за идентификација — барем еден мора да се pojavi во OCR текстот за активирање (одделени со запирка)
        </label>
        <input
          style={inputStyle}
          value={keywordsRaw}
          onChange={(e) => setKeywordsRaw(e.target.value)}
          placeholder="евн македонија, EVN, ЕВН"
        />
      </div>

      {/* Patterns section */}
      <div>
        <div style={{ ...sectionLabel, marginBottom: 10 }}>Шаблони за извлекување</div>

        {/* OCR upload for smart mode */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 14px', marginBottom: 14,
          background: ocrText ? '#F0FAF4' : '#F7F7F5',
          border: `1px solid ${ocrText ? '#B8E0CC' : '#E8E8E2'}`,
          borderRadius: 8,
        }}>
          <input
            ref={ocrInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            style={{ display: 'none' }}
            onChange={(e) => loadOcr(e.target.files[0] || null)}
          />
          <button
            type="button"
            onClick={() => ocrInputRef.current.click()}
            disabled={ocrLoading}
            style={{
              border: '1px solid #D0D0CC', background: '#fff', color: '#16161F',
              borderRadius: 7, padding: '6px 13px', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            {ocrLoading ? 'Скенирање…' : ocrText ? '↺ Замени фактура' : '⬆ Прикачи фактура за паметен режим'}
          </button>
          {ocrText && !ocrLoading && (
            <span style={{ fontSize: 11.5, color: '#0D5C44', fontWeight: 500 }}>
              ✓ {ocrFile?.name || 'Фактурата е вчитана'} — напиши клучни зборови за градење шаблони во реално време
            </span>
          )}
          {!ocrText && !ocrLoading && (
            <span style={{ fontSize: 11, color: '#9A9AAC' }}>
              Прикачи фактура за да може апликацијата автоматски да генерира regex шаблони од клучни зборови
            </span>
          )}
          {ocrError && (
            <span style={{ fontSize: 11.5, color: '#8B1A1A' }}>{ocrError}</span>
          )}
        </div>

        {/* Two-column layout when OCR text is loaded */}
        <div style={{ display: 'grid', gridTemplateColumns: ocrText ? '1fr 380px' : '1fr', gap: 16 }}>
          {/* Field rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {PATTERN_FIELDS.map((f) => (
              <FieldKeywordRow
                key={f.key}
                fieldKey={f.key}
                label={f.label}
                ocrText={ocrText}
                initialKeywords={initial?.keyword_hints?.[f.key] || ''}
                initialPattern={initial?.patterns?.[f.key] || ''}
                onUpdate={handleFieldUpdate}
              />
            ))}
          </div>

          {/* OCR text pane (right side) */}
          {ocrText && (
            <div style={{ position: 'relative' }}>
              <div style={{ ...sectionLabel, marginBottom: 6 }}>OCR текст — копирај клучни зборови оттука</div>
              <pre style={{
                margin: 0,
                background: '#F7F7F5',
                border: '1px solid #E8E8E2',
                borderRadius: 7,
                padding: '11px 13px',
                fontSize: 10.5,
                lineHeight: 1.75,
                maxHeight: 520,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                color: '#16161F',
                ...mono,
              }}>
                {ocrText}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{ border: '1px solid #E2E2DC', background: '#fff', color: '#5A5A6E', borderRadius: 7, padding: '8px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
        >
          Откажи
        </button>
        <button
          type="submit"
          disabled={saving}
          style={{ background: saving ? '#8A8ABA' : '#1A1A6E', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 12.5, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}
        >
          {saving ? 'Се зачувува…' : 'Зачувај шаблон'}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Template card
// ---------------------------------------------------------------------------
function TemplateCard({ template, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const patternCount = Object.values(template.patterns || {}).filter(Boolean).length

  async function handleDelete() {
    if (!window.confirm(`Избриши шаблон "${template.display_name}"?`)) return
    setDeleting(true)
    await onDelete(template.id)
  }

  return (
    <div style={card}>
      {/* Header row */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', cursor: 'pointer' }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div
          style={{
            width: 36, height: 36, borderRadius: 9,
            background: vendorColor(template.display_name),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0, ...mono,
          }}
        >
          {initials(template.display_name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#16161F' }}>{template.display_name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {(template.keywords || []).slice(0, 4).map((kw) => (
              <span key={kw} style={{ ...mono, fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#EEEEF8', color: '#1A1A6E' }}>
                {kw}
              </span>
            ))}
            {(template.keywords || []).length > 4 && (
              <span style={{ fontSize: 11, color: '#9A9AAC' }}>+{template.keywords.length - 4} повеќе</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <span style={{ ...mono, fontSize: 10, color: '#8A8A9C' }}>{patternCount} шаблон{patternCount !== 1 ? 'и' : ''}</span>
          <span style={{ ...mono, fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#F0F0EC', color: '#5A5A6E' }}>{template.currency || 'MKD'}</span>
          <svg
            width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#A0A0B2" strokeWidth="1.5"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* Expanded: patterns + actions */}
      {expanded && (
        <div style={{ borderTop: '1px solid #F0F0EC', padding: '14px 18px 18px' }}>
          <div style={{ ...sectionLabel, marginBottom: 10 }}>Конфигурирани шаблони</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {PATTERN_FIELDS.map((f) => {
              const val = template.patterns?.[f.key]
              const hint = template.keyword_hints?.[f.key]
              return (
                <div key={f.key} style={{ background: '#FAFAF8', borderRadius: 6, padding: '7px 10px' }}>
                  <div style={{ fontSize: 10.5, color: '#8A8A9C', marginBottom: 2 }}>{f.label}</div>
                  {hint && (
                    <div style={{ fontSize: 10, color: '#1A1A6E', marginBottom: 2 }}>
                      🔑 {hint}
                    </div>
                  )}
                  <div style={{ ...mono, fontSize: 11, color: val ? '#16161F' : hint ? '#1A1A6E' : '#C4C4D0', wordBreak: 'break-all' }}>
                    {val || (hint ? '— преку клучен збор —' : '— хеуристичко извлекување —')}
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(template) }}
              style={{ border: '1px solid #E2E2DC', background: '#fff', color: '#1A1A6E', borderRadius: 7, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
            >
              Уреди
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete() }}
              disabled={deleting}
              style={{ border: '1px solid #E6C9C9', background: '#fff', color: '#8B1A1A', borderRadius: 7, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.5 : 1 }}
            >
              {deleting ? 'Се брише…' : 'Избриши'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Color helpers for template card avatar
// ---------------------------------------------------------------------------
function vendorColor(name = '') {
  const colors = ['#1A1A6E', '#0D5C44', '#7A4100', '#3D1C8E', '#8B1A1A', '#005E7A']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  return colors[h % colors.length]
}

function initials(name = '') {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase()
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function Templates() {
  const [templates, setTemplates] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [editing,   setEditing]   = useState(null) // null | 'new' | template object
  const [saving,    setSaving]    = useState(false)

  async function loadTemplates() {
    setLoading(true)
    setError(null)
    try {
      const data = await getTemplates()
      setTemplates(data.templates || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTemplates() }, [])

  async function handleSave(template) {
    setSaving(true)
    try {
      await saveTemplate(template)
      await loadTemplates()
      setEditing(null)
    } catch (e) {
      alert('Зачувувањето не успеа: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteTemplate(id)
      await loadTemplates()
    } catch (e) {
      alert('Бришењето не успеа: ' + e.message)
    }
  }

  return (
    <div style={{ padding: '24px 32px 60px', maxWidth: 1200 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <h1 style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 24, fontWeight: 600, color: '#16161F', margin: 0 }}>
            Шаблони за добавувачи
          </h1>
          <p style={{ fontSize: 13, color: '#8A8A9C', margin: '6px 0 0' }}>
            Внеси клучни зборови — апликацијата автоматски гради regex шаблони од OCR текстот на фактурата.
          </p>
        </div>
        {editing === null && (
          <button
            onClick={() => setEditing('new')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#1A1A6E', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#13134f')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#1A1A6E')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M8 2v12M2 8h12" strokeLinecap="round" />
            </svg>
            Додај шаблон
          </button>
        )}
      </div>

      {/* Create / Edit form */}
      {editing !== null && (
        <div style={{ ...card, overflow: 'visible', padding: 24, marginTop: 20, marginBottom: 20 }}>
          <div style={{ ...sectionLabel, marginBottom: 16 }}>
            {editing === 'new' ? 'Нов шаблон за добавувач' : `Уредување: ${editing.display_name}`}
          </div>
          <TemplateForm
            initial={editing === 'new' ? null : editing}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
            saving={saving}
          />
        </div>
      )}

      {/* Template list */}
      {loading && (
        <div style={{ color: '#8A8A9C', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Се вчитуваат шаблони…</div>
      )}
      {error && (
        <div style={{ color: '#8B1A1A', background: '#FDEBEB', borderRadius: 8, padding: '14px 18px', marginTop: 16, fontSize: 13 }}>
          {error}
        </div>
      )}
      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: editing ? 0 : 20 }}>
          {templates.length === 0 && (
            <div style={{ color: '#8A8A9C', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
              Нема шаблони. Додај еден за детерминистичко извлекување за повторливи добавувачи.
            </div>
          )}
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} onEdit={(tmpl) => setEditing(tmpl)} onDelete={handleDelete} />
          ))}
        </div>
      )}


    </div>
  )
}
