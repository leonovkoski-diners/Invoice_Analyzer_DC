import { useCallback, useMemo, useRef, useState } from 'react'
import { fmtMoney, fmtDate } from '../lib/format'
import { parseBackendFlags } from '../lib/invoice'
import { generateJournal } from '../lib/journal'
import { extractDocument, setTemplateDefault as setTemplateDefaultApi, saveKontoCorrection } from '../lib/api'
import { exportToHelixK, exportBatchToHelixK } from '../lib/helixk'
import { AppContext } from './appContext'

let toastSeq = 0

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// Enrich a raw invoice (seed or extracted) with the fields the review screen needs.
function decorate(inv, extractionMethod) {
  const withMeta = {
    docType: 'invoice',
    paymentRef: inv.paymentRef ?? null,
    extractionMethod: inv.extractionMethod ?? extractionMethod,
    bookingDate: inv.bookingDate ?? inv.received ?? todayISO(),
    hiddenFields: inv.hiddenFields ?? [],
    komitent: inv.komitent ?? '',
    komitentSifra: inv.komitentSifra ?? '',
    extra: inv.extra ?? [],
    ...inv,
  }
  // kontoSuggestion (from backend embedding model) is passed to generateJournal
  // so expense debit lines use the model's konto instead of local keyword rules.
  return { ...withMeta, journal: withMeta.journal ?? generateJournal(withMeta, withMeta.kontoSuggestion ?? null) }
}

// Map the FastAPI extraction response onto our invoice shape. Minimal fields only.
function invoiceFromExtraction(resp, fileMeta) {
  const r = resp.record
  const lineItems = (r.line_items || []).map((li) => ({
    description: li.description,
    qty: li.quantity,
    unitPrice: li.unit_price,
    lineTotal: li.line_total,
    vatRate: li.vat_rate ?? null,
  }))
  const base = {
    id: 'up-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    vendor: r.vendor_name || 'Unknown vendor',
    number: r.invoice_number || '—',
    invoiceDate: r.invoice_date || null,
    total: r.total ?? 0,
    status: 'Pending',
    received: todayISO(),
    bookingDate: todayISO(),
    fileName: fileMeta.fileName,
    fileUrl: fileMeta.fileUrl,
    fileType: fileMeta.fileType,
    lineItems,
    flags: parseBackendFlags(resp.flags),
    extra: [],
    komitent: r.komitent_name || '',
    komitentId: r.komitent_id || null,
    komitentSifra: r.komitent_id ? String(r.komitent_id) : '',
    komitentLowConfidence: r.komitent_low_confidence ?? false,
    pageCount: resp.page_count,
    hiddenFields: [],
    templateUsed: resp.template_used || null,
    templateName: resp.template_name || null,
    templateDefaults: resp.template_defaults || {},
    ocrText: resp.ocr_text || '',
    kontoSuggestion: resp.suggested_konto || null,
    kontoMethod: resp.konto_method || null,
    kontoConfidence: resp.konto_confidence ?? null,
  }
  return decorate(base, resp.extraction_method || 'local_ocr')
}

export function AppProvider({ children }) {
  const [invoices, setInvoices] = useState([])
  const [toasts, setToasts] = useState([])

  // Upload modal open state
  const [uploadOpen, setUploadOpen] = useState(false)

  // Batch session state
  // batchQueue items: { batchId, fileName, status: 'waiting'|'analyzing'|'done'|'error', invoiceId, errorMsg }
  const [batchQueue, setBatchQueue] = useState([])
  const [batchCursor, setBatchCursor] = useState(0)
  const batchRunningRef = useRef(false)

  // Derived batch helpers (computed inline — stable as values, not functions)
  const batchDoneItems = batchQueue.filter((i) => i.status === 'done')
  const batchErrorItems = batchQueue.filter((i) => i.status === 'error')
  const batchAllDone = batchQueue.length > 0 && batchQueue.every((i) => i.status === 'done' || i.status === 'error')
  const batchMode = batchQueue.length > 0

  const dismissToast = useCallback((id) => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
  }, [])

  const pushToast = useCallback(
    (type, title, msg) => {
      const id = ++toastSeq
      setToasts((ts) => ts.concat([{ id, type, title, msg }]))
      setTimeout(() => dismissToast(id), 4600)
    },
    [dismissToast],
  )

  // ── Review actions ────────────────────────────────────────────────────────

  // Approve: blocked while unresolved high-severity flags exist (CLAUDE.md rule).
  const approveInvoice = useCallback(
    (id) => {
      const inv = invoices.find((i) => i.id === id)
      if (!inv) return
      const high = inv.flags.filter((f) => f.severity === 'high')
      const alreadyPosted = inv.status === 'Approved' || inv.status === 'Exported'
      if (!alreadyPosted && high.length) {
        pushToast('error', 'Одобрувањето е блокирано', high.length + ' критичен флаг' + (high.length > 1 ? 'ови' : '') + ' мора да се решат прво')
        return false
      }
      setInvoices((list) => list.map((i) => (i.id === id ? { ...i, status: 'Approved' } : i)))
      pushToast('ok', 'Одобрена', inv.number + ' прокнижена')

      // Send the final expense konto back to the backend for learning.
      // Fire-and-forget: never block the approval on a learning error.
      if (inv.ocrText) {
        const expenseLine = (inv.journal || []).find((e) => e.debit > 0 && e.konto && e.konto !== '2200')
        if (expenseLine?.konto) {
          saveKontoCorrection({
            ocr_text: inv.ocrText,
            konto: expenseLine.konto,
            komitent_id: inv.komitentId || null,
          }).catch(() => {})
        }
      }

      return true
    },
    [invoices, pushToast],
  )

  const rejectInvoice = useCallback(
    (id) => {
      const inv = invoices.find((i) => i.id === id)
      if (!inv) return
      setInvoices((list) => list.map((i) => (i.id === id ? { ...i, status: 'Rejected' } : i)))
      pushToast('warn', 'Одбиена', inv.number + ' означена како нерелевантна')
    },
    [invoices, pushToast],
  )

  // Export the posted entry to Helix-K .xlsx (only meaningful once approved).
  const exportInvoice = useCallback(
    (id) => {
      const inv = invoices.find((i) => i.id === id)
      if (!inv) return
      if (inv.status !== 'Approved' && inv.status !== 'Exported') {
        pushToast('error', 'Извозот е блокиран', 'Одобри го документот пред извоз')
        return
      }
      try {
        const filename = exportToHelixK(inv)
        const was = inv.status === 'Exported'
        setInvoices((list) => list.map((i) => (i.id === id ? { ...i, status: 'Exported' } : i)))
        pushToast('ok', was ? 'Повторно извезена во Helix-K' : 'Извезена во Helix-K', filename + ' преземено')
      } catch (err) {
        pushToast('error', 'Извозот не успеа', err.message || 'Не може да се генерира .xlsx')
      }
    },
    [invoices, pushToast],
  )

  const setBookingDate = useCallback((id, date) => {
    setInvoices((list) => list.map((i) => (i.id === id ? { ...i, bookingDate: date } : i)))
  }, [])

  const updateJournal = useCallback((id, journal) => {
    setInvoices((list) => list.map((i) => (i.id === id ? { ...i, journal } : i)))
  }, [])

  const updateField = useCallback((id, field, value) => {
    setInvoices((list) => list.map((i) => (i.id === id ? { ...i, [field]: value } : i)))
  }, [])

  // Add a blank custom field to invoice.extra (user fills in label + value).
  const addExtraField = useCallback((id) => {
    setInvoices((list) =>
      list.map((i) =>
        i.id === id ? { ...i, extra: [...(i.extra || []), { key: 'New field', value: '' }] } : i,
      ),
    )
  }, [])

  // Update the key or value of an extra field by index.
  const updateExtraField = useCallback((id, idx, key, value) => {
    setInvoices((list) =>
      list.map((i) => {
        if (i.id !== id) return i
        const extra = (i.extra || []).map((e, j) => (j === idx ? { key, value } : e))
        return { ...i, extra }
      }),
    )
  }, [])

  // Permanently remove an extra field by index.
  const removeExtraField = useCallback((id, idx) => {
    setInvoices((list) =>
      list.map((i) => {
        if (i.id !== id) return i
        const extra = (i.extra || []).filter((_, j) => j !== idx)
        return { ...i, extra }
      }),
    )
  }, [])

  // Persist a field default on the matched vendor template and update local state.
  // field: 'vendor_name' | 'komitent_name' | 'komitent_sifra'
  // value: string to set, null to clear
  const setTemplateDefault = useCallback(
    async (invoiceId, templateId, field, value) => {
      try {
        await setTemplateDefaultApi(templateId, field, value)
        setInvoices((list) =>
          list.map((i) => {
            if (i.id !== invoiceId) return i
            const td = { ...(i.templateDefaults || {}) }
            if (value != null && value !== '') {
              td[field] = value
            } else {
              delete td[field]
            }
            return { ...i, templateDefaults: td }
          }),
        )
        pushToast(
          'ok',
          value ? 'Стандардот е зачуван' : 'Стандардот е избришан',
          value ? 'Ќе се користи за сите идни фактури од овој добавувач' : 'Полето ќе користи извлекување за идни фактури',
        )
      } catch (err) {
        pushToast('error', 'Неуспешно зачувување на стандардот', err.message)
      }
    },
    [pushToast],
  )

  // Hide a standard field by label (added to invoice.hiddenFields).
  const hideField = useCallback((id, label) => {
    setInvoices((list) =>
      list.map((i) => {
        if (i.id !== id) return i
        const hidden = [...(i.hiddenFields || []), label]
        return { ...i, hiddenFields: hidden }
      }),
    )
  }, [])

  // ── Upload / batch session ────────────────────────────────────────────────

  const openUpload = useCallback(() => {
    setUploadOpen(true)
  }, [])

  const closeUpload = useCallback(() => {
    setUploadOpen(false)
  }, [])

  // Process files sequentially. Each file is extracted one at a time; the queue
  // status updates reactively so UploadModal shows live progress.
  const startBatchSession = useCallback(async (files) => {
    if (batchRunningRef.current) return
    const arr = Array.from(files)
    if (arr.length === 0) return

    const items = arr.map((file, i) => ({
      batchId: 'b-' + Date.now() + '-' + i,
      fileName: file.name,
      file,
      status: 'waiting',
      invoiceId: null,
      errorMsg: null,
    }))

    setBatchQueue(items)
    setBatchCursor(0)
    batchRunningRef.current = true

    for (const item of items) {
      setBatchQueue((q) => q.map((i) => (i.batchId === item.batchId ? { ...i, status: 'analyzing' } : i)))

      const fileUrl = URL.createObjectURL(item.file)
      try {
        const resp = await extractDocument(item.file)
        const inv = invoiceFromExtraction(resp, { fileName: item.fileName, fileUrl, fileType: item.file.type })
        setInvoices((list) => [inv, ...list])
        setBatchQueue((q) => q.map((i) => (i.batchId === item.batchId ? { ...i, status: 'done', invoiceId: inv.id } : i)))
      } catch (err) {
        URL.revokeObjectURL(fileUrl)
        setBatchQueue((q) => q.map((i) => (i.batchId === item.batchId ? { ...i, status: 'error', errorMsg: err.message || 'Extraction failed' } : i)))
      }
    }

    batchRunningRef.current = false
  }, [])

  // Clear the batch session entirely (resets queue and cursor).
  const clearBatchSession = useCallback(() => {
    if (batchRunningRef.current) return // don't clear while processing
    setBatchQueue([])
    setBatchCursor(0)
  }, [])

  // Advance cursor to the next successfully extracted invoice.
  // Returns the invoiceId to navigate to, or null if already at the end.
  const batchNavNext = useCallback(() => {
    const done = batchQueue.filter((i) => i.status === 'done')
    const next = batchCursor + 1
    if (next < done.length) {
      setBatchCursor(next)
      return done[next].invoiceId
    }
    return null
  }, [batchQueue, batchCursor])

  // Go back to the previous invoice in the batch.
  // Returns the invoiceId to navigate to, or null if already at the start.
  const batchNavPrev = useCallback(() => {
    const done = batchQueue.filter((i) => i.status === 'done')
    const prev = batchCursor - 1
    if (prev >= 0) {
      setBatchCursor(prev)
      return done[prev].invoiceId
    }
    return null
  }, [batchQueue, batchCursor])

  // Navigate to a specific cursor index in the batch.
  // Returns the invoiceId or null.
  const batchNavTo = useCallback(
    (idx) => {
      const done = batchQueue.filter((i) => i.status === 'done')
      if (idx < 0 || idx >= done.length) return null
      setBatchCursor(idx)
      return done[idx].invoiceId
    },
    [batchQueue],
  )

  // Export all approved invoices in the current batch session to a single Helix-K file.
  const exportAllApproved = useCallback(() => {
    const doneIds = new Set(batchQueue.filter((i) => i.status === 'done').map((i) => i.invoiceId))
    const approved = invoices
      .filter((inv) => doneIds.has(inv.id) && (inv.status === 'Approved' || inv.status === 'Exported'))
      .sort((a, b) => (a.invoiceDate || '').localeCompare(b.invoiceDate || ''))

    if (approved.length === 0) {
      pushToast('warn', 'Нема за извоз', 'Прво одобри барем една фактура')
      return
    }

    try {
      const filename = exportBatchToHelixK(approved)
      setInvoices((list) =>
        list.map((inv) => (approved.some((a) => a.id === inv.id) ? { ...inv, status: 'Exported' } : inv)),
      )
      pushToast('ok', 'Серијата е извезена', `${approved.length} ${approved.length > 1 ? 'фактури' : 'фактура'} → ${filename}`)
    } catch (err) {
      pushToast('error', 'Извозот не успеа', err.message || 'Не може да се генерира .xlsx')
    }
  }, [batchQueue, invoices, pushToast])

  const value = useMemo(
    () => ({
      invoices,
      toasts,
      pushToast,
      dismissToast,
      approveInvoice,
      rejectInvoice,
      exportInvoice,
      setBookingDate,
      updateJournal,
      updateField,
      addExtraField,
      updateExtraField,
      removeExtraField,
      hideField,
      setTemplateDefault,
      // upload modal
      uploadOpen,
      openUpload,
      closeUpload,
      // batch session
      batchQueue,
      batchCursor,
      batchDoneItems,
      batchErrorItems,
      batchAllDone,
      batchMode,
      startBatchSession,
      clearBatchSession,
      batchNavNext,
      batchNavPrev,
      batchNavTo,
      exportAllApproved,
    }),
    [
      invoices,
      toasts,
      pushToast,
      dismissToast,
      approveInvoice,
      rejectInvoice,
      exportInvoice,
      setBookingDate,
      updateJournal,
      updateField,
      addExtraField,
      updateExtraField,
      removeExtraField,
      hideField,
      setTemplateDefault,
      uploadOpen,
      openUpload,
      closeUpload,
      batchQueue,
      batchCursor,
      batchDoneItems,
      batchErrorItems,
      batchAllDone,
      batchMode,
      startBatchSession,
      clearBatchSession,
      batchNavNext,
      batchNavPrev,
      batchNavTo,
      exportAllApproved,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
