import { fmtMoney, fmtDate } from './format'

// Tolerance mirrors the pipeline rule: any discrepancy > €0.01 is flagged.
const EPSILON = 0.01

export function hasHighSeverity(invoice) {
  return invoice.flags.some((f) => f.severity === 'high')
}

// Convert the pipeline's raw flag strings (e.g. "TOTAL_MISMATCH [HIGH SEVERITY]: ...")
// into the UI flag shape used everywhere else.
export function parseBackendFlags(rawFlags = []) {
  return rawFlags.map((raw) => {
    const isHigh = /HIGH SEVERITY/i.test(raw)
    const colon = raw.indexOf(':')
    const head = (colon >= 0 ? raw.slice(0, colon) : raw).replace(/\[HIGH SEVERITY\]/i, '').trim()
    const text = (colon >= 0 ? raw.slice(colon + 1) : raw).trim()
    const label = head
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase())
    return { severity: isHigh ? 'high' : 'warn', label: label || 'Validation', text: text || raw }
  })
}

// Compact flag summary used in tables / dashboard rows.
export function flagSummary(flags) {
  if (!flags || !flags.length) return null
  const high = flags.some((f) => f.severity === 'high')
  if (high) return { tone: 'high', label: flags.length + ' · critical' }
  return { tone: 'warn', label: flags.length + (flags.length > 1 ? ' warnings' : ' warning') }
}

// Build the display shape for the invoice detail page.
// Only the fields extracted are shown — no phantom fields.
export function buildDetail(invoice) {
  const liSum = (invoice.lineItems || []).reduce((acc, l) => acc + (Number(l.lineTotal) || 0), 0)
  const totalOk = Math.abs(liSum - (Number(invoice.total) || 0)) < EPSILON

  const dateFlag = invoice.flags.some((f) => /ambiguous/i.test(f.label))

  const flags = invoice.flags.map((f) => ({
    label: f.label,
    text: f.text,
    isHigh: f.severity === 'high',
    tag: f.severity === 'high' ? 'HIGH SEVERITY' : 'WARNING',
  }))

  const lineItems = (invoice.lineItems || []).map((l) => {
    const calc = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0)
    const bad = Math.abs(calc - (Number(l.lineTotal) || 0)) > EPSILON
    return {
      desc: l.description,
      qty: l.qty,
      unit: fmtMoney(l.unitPrice),
      total: fmtMoney(l.lineTotal),
      bad,
    }
  })

  const high = invoice.flags.filter((f) => f.severity === 'high')
  const isExported = invoice.status === 'Exported'

  return {
    id: invoice.id,
    vendor: invoice.vendor,
    number: invoice.number,
    status: invoice.status,
    isProcessing: invoice.status === 'Processing',
    fileName: invoice.fileName,
    receivedFmt: fmtDate(invoice.received),
    flags,
    flagCount: invoice.flags.length,
    hasFlags: invoice.flags.length > 0,
    hasHigh: high.length > 0,
    lineItems,
    liSum: fmtMoney(liSum),
    totalFmt: fmtMoney(invoice.total),
    totalOk,
    dateFlag,
    isExported,
    exportLabel: isExported ? 'Re-export .xlsx' : 'Approve & Export → Helix-K',
    exportDisabled: high.length > 0 && !isExported,
  }
}
