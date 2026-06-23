import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useState, useRef } from 'react'
import { useApp } from '../state/appContext'
import { buildDetail } from '../lib/invoice'
import { fmtDate, fmtMoney } from '../lib/format'
import { saveTemplateFromInvoice, lookupKomitent } from '../lib/api'
import StatusBadge from '../components/StatusBadge'
import DocumentPreview from '../components/DocumentPreview'
import JournalEditor from '../components/JournalEditor'
import FieldCards from '../components/FieldCards'
import BatchNavBar from '../components/BatchNavBar'

const okTag = { fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 500, letterSpacing: '0.06em', padding: '2px 6px', borderRadius: 3, background: '#E4F2EC', color: '#0D5C44' }
const badTag = { fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 500, letterSpacing: '0.06em', padding: '2px 6px', borderRadius: 3, background: '#FDEBEB', color: '#8B1A1A' }
const sectionLabel = { fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9A9AAC' }
const totalRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #F4F4F0' }
const queueBtn = (disabled) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #E2E2DC', background: disabled ? '#F7F7F5' : '#fff', color: disabled ? '#C4C4D0' : '#5A5A6E', borderRadius: 7, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' })

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const {
    invoices, approveInvoice, rejectInvoice, exportInvoice,
    setBookingDate, updateJournal, updateField, addExtraField, updateExtraField, removeExtraField, hideField,
    setTemplateDefault,
    batchMode, batchDoneItems, batchCursor, batchNavNext, batchNavPrev,
    pushToast,
  } = useApp()
  const [ocrOpen, setOcrOpen] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateKeywords, setTemplateKeywords] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [templateSaved, setTemplateSaved] = useState(false)
  const sifraTimerRef = useRef(null)
  const komitentTimerRef = useRef(null)

  const invoice = invoices.find((i) => i.id === id)
  if (!invoice) return <Navigate to="/invoices" replace />
  const d = buildDetail(invoice)

  const posted = invoice.status === 'Approved' || invoice.status === 'Exported'

  // Auto-fill the sibling field when sifra or komitent name is changed.
  const handleSifraChange = (v) => {
    updateField(invoice.id, 'komitentSifra', v)
    clearTimeout(sifraTimerRef.current)
    if (!v.trim()) return
    sifraTimerRef.current = setTimeout(async () => {
      const match = await lookupKomitent({ sifra: v.trim() }).catch(() => null)
      if (match) updateField(invoice.id, 'komitent', match.name)
    }, 400)
  }

  const handleKomitentChange = (v) => {
    updateField(invoice.id, 'komitent', v)
    clearTimeout(komitentTimerRef.current)
    if (!v.trim() || v.trim().length < 3) return
    komitentTimerRef.current = setTimeout(async () => {
      const match = await lookupKomitent({ name: v.trim() }).catch(() => null)
      if (match) updateField(invoice.id, 'komitentSifra', match.id)
    }, 600)
  }

  // Batch mode: navigate through extracted invoices using the batch cursor.
  // Non-batch mode: navigate through all pending invoices (legacy queue).
  const inBatch = batchMode && batchDoneItems.some((i) => i.invoiceId === id)

  const goPrev = () => {
    if (inBatch) {
      const prevId = batchNavPrev()
      if (prevId) navigate('/invoices/' + prevId)
    } else {
      const queue = invoices.filter((i) => i.status === 'Pending')
      const qPos = queue.findIndex((i) => i.id === id)
      if (qPos > 0) navigate('/invoices/' + queue[qPos - 1].id)
    }
  }

  const goNext = () => {
    if (inBatch) {
      const nextId = batchNavNext()
      if (nextId) navigate('/invoices/' + nextId)
    } else {
      const queue = invoices.filter((i) => i.status === 'Pending')
      const qPos = queue.findIndex((i) => i.id === id)
      if (qPos < queue.length - 1) navigate('/invoices/' + queue[qPos + 1].id)
    }
  }

  // In batch mode approve/reject auto-advance to the next invoice.
  const handleApprove = () => {
    const highCount = invoice.flags.filter((f) => f.severity === 'high').length
    if (highCount > 0 && !posted) {
      approveInvoice(invoice.id) // shows error toast, does not approve
      return
    }
    approveInvoice(invoice.id)
    if (inBatch) {
      const nextId = batchNavNext()
      if (nextId) navigate('/invoices/' + nextId)
    }
  }

  const handleReject = () => {
    rejectInvoice(invoice.id)
    if (inBatch) {
      const nextId = batchNavNext()
      if (nextId) navigate('/invoices/' + nextId)
    }
  }

  // Non-batch queue position display
  const nonBatchQueue = invoices.filter((i) => i.status === 'Pending')
  const qPos = nonBatchQueue.findIndex((i) => i.id === id)
  const inNonBatchQueue = !inBatch && qPos >= 0

  const openSaveTemplate = () => {
    setTemplateName(invoice.vendor || '')
    const kws = [invoice.vendor, invoice.komitent].filter((k) => k && k.length > 2).join(', ')
    setTemplateKeywords(kws)
    setTemplateSaved(false)
    setSaveTemplateOpen(true)
  }

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return
    setSavingTemplate(true)
    try {
      const keywords = templateKeywords.split(',').map((k) => k.trim()).filter(Boolean)
      const defaults = {}
      if (invoice.vendor?.trim())        defaults.vendor_name      = invoice.vendor.trim()
      if (invoice.komitent?.trim())      defaults.komitent_name    = invoice.komitent.trim()
      if (invoice.komitentSifra?.trim()) defaults.komitent_sifra   = invoice.komitentSifra.trim()
      await saveTemplateFromInvoice({
        display_name: templateName.trim(),
        keywords,
        ocr_text: invoice.ocrText || '',
        extracted: {
          invoice_number: invoice.number,
          invoice_date: invoice.invoiceDate,
          total: invoice.total,
        },
        defaults,
      })
      setTemplateSaved(true)
      pushToast('ok', 'Шаблонот е зачуван', `"${templateName.trim()}" ќе се користи за идни фактури`)
      setTimeout(() => setSaveTemplateOpen(false), 1200)
    } catch {
      pushToast('error', 'Неуспешно зачувување', 'Не може да се зачува шаблонот — провери ја врската со серверот')
    } finally {
      setSavingTemplate(false)
    }
  }

  // Returns the ISO date string if valid, otherwise empty (so date input stays clearable).
  const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '')

  // Extracted-field cards — only the fields that matter for accounting.
  const hidden = new Set(invoice.hiddenFields || [])
  const stdField = (f) => hidden.has(f.label) ? null : { ...f, onRemove: () => hideField(invoice.id, f.label) }

  // Pin helpers — only active when this invoice matched a vendor template
  const canPin = !!invoice.templateUsed
  const td = invoice.templateDefaults || {}
  const pinProps = (defaultKey, getValue) => !canPin ? {} : {
    pinnable: true,
    pinned: !!td[defaultKey],
    onPin: () => setTemplateDefault(invoice.id, invoice.templateUsed, defaultKey, getValue()),
    onUnpin: () => setTemplateDefault(invoice.id, invoice.templateUsed, defaultKey, null),
  }

  const fields = [
    stdField({ label: 'Добавувач', value: invoice.vendor || '', editable: true, onChange: (v) => updateField(invoice.id, 'vendor', v), ...pinProps('vendor_name', () => invoice.vendor) }),
    stdField({ label: 'Комитент', value: invoice.komitent || '', editable: true, onChange: handleKomitentChange, flagged: invoice.komitentLowConfidence, ...pinProps('komitent_name', () => invoice.komitent) }),
    stdField({ label: 'Шифра на комитент', value: invoice.komitentSifra || '', editable: true, onChange: handleSifraChange, ...pinProps('komitent_sifra', () => invoice.komitentSifra) }),
    stdField({ label: 'Број на фактура', value: invoice.number || '', editable: true, onChange: (v) => updateField(invoice.id, 'number', v) }),
    stdField({
      label: 'Датум на фактура',
      value: isoDate(invoice.invoiceDate),
      editable: true,
      inputType: 'date',
      onChange: (v) => updateField(invoice.id, 'invoiceDate', v),
      flagged: d.dateFlag || (invoice.invoiceDate && !isoDate(invoice.invoiceDate)),
    }),
    stdField({ label: 'Вкупен износ', value: fmtMoney(invoice.total), flagged: !d.totalOk }),
    ...(invoice.extra || []).map((e, idx) => ({
      label: e.key,
      value: e.value,
      editable: true,
      labelEditable: true,
      onChange: (v) => updateExtraField(invoice.id, idx, e.key, v),
      onLabelChange: (k) => updateExtraField(invoice.id, idx, k, e.value),
      onRemove: () => removeExtraField(invoice.id, idx),
    })),
  ].filter(Boolean)

  const approveBtnStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600,
    ...(d.hasHigh && !posted ? { background: '#F4F4F0', color: '#A0A0B2', cursor: 'not-allowed' } : { background: '#1A1A6E', color: '#fff' }),
  }

  return (
    <div style={{ padding: '18px 28px 48px', maxWidth: 1320 }}>
      {/* Batch session nav bar — shown when reviewing a batch */}
      {inBatch && <BatchNavBar currentInvoiceId={id} />}

      {/* Back + review queue (non-batch mode) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <button
          onClick={() => navigate('/invoices')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#8A8A9C', fontSize: 12.5, fontWeight: 500, padding: 0 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#1A1A6E')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#8A8A9C')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9.5 3.5L5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Назад кон фактури
        </button>
        {!inBatch && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={goPrev} disabled={!inNonBatchQueue || qPos === 0} style={queueBtn(!inNonBatchQueue || qPos === 0)}>‹ Претходна</button>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#5A5A6E', minWidth: 78, textAlign: 'center' }}>{inNonBatchQueue ? `${qPos + 1} од ${nonBatchQueue.length} на чекање` : 'Прегледана'}</span>
            <button onClick={goNext} disabled={!inNonBatchQueue || qPos >= nonBatchQueue.length - 1} style={queueBtn(!inNonBatchQueue || qPos >= nonBatchQueue.length - 1)}>Следна ›</button>
          </div>
        )}
      </div>

      {/* Header + document actions */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', borderBottom: '1px solid #E8E8E2', paddingBottom: 18, marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 25, fontWeight: 600, color: '#16161F', margin: 0, letterSpacing: '-0.01em' }}>{d.vendor}</h2>
            <StatusBadge status={d.status} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: '#8A8A9C', flexWrap: 'wrap' }}>
            <span style={{ color: '#5A5A6E', fontWeight: 500 }}>{d.number}</span>
            <span style={{ color: '#D0D0D8' }}>·</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#A0A0B2" strokeWidth="1.4"><path d="M3 1.6h7l3 3v9.8H3z" /><path d="M9.6 1.7v3.2h3.2" /></svg>
              {d.fileName}
            </span>
            <span style={{ color: '#D0D0D8' }}>·</span>
            <span>Примено {d.receivedFmt}</span>
            {invoice.templateName && (
              <>
                <span style={{ color: '#D0D0D8' }}>·</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 4, background: '#EEEEF8', color: '#1A1A6E', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M5 5h6M5 8h4M5 11h3" strokeLinecap="round" /></svg>
                  {invoice.templateName}
                </span>
              </>
            )}
            {invoice.ocrText && (
              <>
                <span style={{ color: '#D0D0D8' }}>·</span>
                <button
                  onClick={() => setOcrOpen((v) => !v)}
                  style={{ background: 'none', border: 'none', padding: '2px 0', fontSize: 11.5, color: '#8A8A9C', fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                >
                  {ocrOpen ? 'сокриј OCR текст' : 'прикажи OCR текст'}
                </button>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid #E2E2DC', borderRadius: 8, padding: '7px 11px', fontSize: 12.5, color: '#5A5A6E' }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#8A8A9C" strokeWidth="1.5"><rect x="1.6" y="2.8" width="12.8" height="11" rx="1.4" /><path d="M1.6 6.2h12.8M4.5 1.4v2.4M11.5 1.4v2.4" /></svg>
              Книжење
              <input type="date" value={invoice.bookingDate || ''} onChange={(e) => setBookingDate(invoice.id, e.target.value)} style={{ border: 'none', outline: 'none', background: 'none', fontSize: 12.5, color: '#16161F', fontFamily: 'inherit' }} />
            </label>
            {invoice.ocrText && (
              <button
                onClick={openSaveTemplate}
                title="Save extraction patterns as a reusable vendor template"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #C8C8E0', background: '#fff', color: '#1A1A6E', borderRadius: 8, padding: '9px 13px', fontSize: 12.5, fontWeight: 600 }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M5 5h6M5 8h4M5 11h3" strokeLinecap="round" /></svg>
                Зачувај како шаблон
              </button>
            )}
            <button onClick={handleReject} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid #E6C9C9', background: '#fff', color: '#8B1A1A', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
              Одбиј
            </button>
            <button onClick={handleApprove} style={approveBtnStyle}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3.5 8.2l3 3 6-6.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {posted ? 'Одобрена' : 'Одобри'}
            </button>
          </div>
          {posted && (
            <button onClick={() => exportInvoice(invoice.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid #C8C8E0', background: '#fff', color: '#1A1A6E', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 1.6h7l3 3v9.8H3z" /><path d="M5.6 8.4l1.8 1.8 3-3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {invoice.status === 'Exported' ? 'Повторно извези .xlsx' : 'Извези → Helix-K'}
            </button>
          )}
          {d.hasHigh && !posted && <div style={{ fontSize: 11, color: '#8B1A1A', fontWeight: 500 }}>Реши ги критичните флагови за да одобриш</div>}

          {/* Save as Template inline panel */}
          {saveTemplateOpen && (
            <div style={{ background: '#F8F8FC', border: '1px solid #C8C8E0', borderRadius: 10, padding: '14px 16px', width: 320, marginTop: 2 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9A9AAC', marginBottom: 10 }}>Зачувај како шаблон</div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: '#8A8A9C', marginBottom: 3 }}>Име на шаблонот</div>
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g. ЗОНЕЛ Софтвер ДООЕЛ"
                  style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #E2E2DC', borderRadius: 6, padding: '6px 9px', fontSize: 12.5, color: '#16161F', fontFamily: 'inherit', outline: 'none' }}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#8A8A9C', marginBottom: 3 }}>Клучни зборови (одделени со запирка, за препознавање идни фактури)</div>
                <input
                  value={templateKeywords}
                  onChange={(e) => setTemplateKeywords(e.target.value)}
                  placeholder="e.g. ЗОНЕЛ, ZONEL, zonel"
                  style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #E2E2DC', borderRadius: 6, padding: '6px 9px', fontSize: 12.5, color: '#16161F', fontFamily: 'inherit', outline: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setSaveTemplateOpen(false)} style={{ border: '1px solid #E2E2DC', background: '#fff', color: '#5A5A6E', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                  Откажи
                </button>
                <button
                  onClick={handleSaveTemplate}
                  disabled={savingTemplate || !templateName.trim()}
                  style={{ border: 'none', background: templateSaved ? '#0D5C44' : '#1A1A6E', color: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: savingTemplate ? 'wait' : 'pointer', opacity: !templateName.trim() ? 0.5 : 1 }}
                >
                  {templateSaved ? '✓ Зачувано' : savingTemplate ? 'Се зачувува…' : 'Зачувај шаблон'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Flags */}
      {d.hasFlags && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ ...sectionLabel, marginBottom: 8 }}>Флагови за валидација · {d.flagCount}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {d.flags.map((f, idx) => (
              <div key={idx} style={{ borderLeft: f.isHigh ? '3px solid #8B1A1A' : '3px solid #7A4100', background: f.isHigh ? '#FDEBEB' : '#FEF3E2', borderRadius: '0 8px 8px 0', padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, fontWeight: 500, letterSpacing: '0.1em', padding: '2px 6px', borderRadius: 3, flexShrink: 0, background: f.isHigh ? '#8B1A1A' : '#7A4100', color: '#fff' }}>{f.tag}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#16161F' }}>{f.label}</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#5A5A6E', lineHeight: 1.55 }}>{f.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Extracted data (left) + source document (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,1fr)', gap: 18, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={sectionLabel}>Извлечени податоци</div>
            <div style={{ fontSize: 10.5, color: '#B4B4C2', fontStyle: 'italic', fontFamily: "'Lora', serif" }}>— верификувај со документот десно</div>
          </div>

          <JournalEditor invoice={invoice} onChange={(entries) => updateJournal(invoice.id, entries)} />

          <FieldCards fields={fields} onAddField={() => addExtraField(invoice.id)} />

          {/* Total verification — independently recomputed from line items (tolerance 0.01 ден.) */}
          <div style={{ background: '#fff', border: '1px solid #E8E8E2', borderRadius: 10, padding: '6px 16px' }}>
            <div style={totalRow}>
              <span style={{ fontSize: 12.5, color: '#8A8A9C' }}>Σ ставки (пресметано)</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={d.totalOk ? okTag : badTag}>{d.totalOk ? 'СОВПАЃА' : 'НЕ СОВПАЃА'}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#16161F', fontVariantNumeric: 'tabular-nums' }}>{d.liSum}</span>
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0 9px' }}>
              <span style={{ fontSize: 13, color: '#16161F', fontWeight: 600 }}>Вкупен износ</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={d.totalOk ? okTag : badTag}>{d.totalOk ? 'ВЕРИФИЦИРАНО' : 'НЕ СОВПАЃА'}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: '#1A1A6E', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{d.totalFmt}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Source document */}
        <DocumentPreview invoice={invoice} />
      </div>

      {/* OCR debug drawer */}
      {ocrOpen && invoice.ocrText && (
        <div style={{ marginTop: 20, border: '1px solid #E8E8E2', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#F8F8F4', borderBottom: '1px solid #E8E8E2' }}>
            <span style={{ ...sectionLabel }}>Суров OCR текст</span>
            <button
              onClick={() => setOcrOpen(false)}
              style={{ background: 'none', border: 'none', color: '#9A9AAC', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: '0 4px' }}
            >×</button>
          </div>
          <pre style={{ margin: 0, padding: '14px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, lineHeight: 1.7, color: '#3A3A4E', background: '#FAFAF8', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 420, overflowY: 'auto' }}>
            {invoice.ocrText}
          </pre>
        </div>
      )}
    </div>
  )
}
