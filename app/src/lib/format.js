const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtMoney(value) {
  if (value == null || isNaN(value)) return '—'
  return Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ден.'
}

// Internal dates are ISO 8601 (matches the pipeline contract); only formatted for display here.
// If the date failed backend parsing, iso is the raw model string — show it as-is.
export function fmtDate(iso) {
  if (!iso) return '—'
  const parts = iso.split('-')
  if (parts.length !== 3 || parts[0].length !== 4) return iso
  const [y, m, d] = parts
  const mIdx = Number(m) - 1
  if (isNaN(Number(d)) || mIdx < 0 || mIdx > 11) return iso
  return Number(d) + ' ' + MONTHS[mIdx] + ' ' + y
}

// All amounts are in MKD — returns the invoice total directly.
export function mkd(invoice) {
  return invoice.total || 0
}

export function fmtMKDRounded(value) {
  return Math.round(value).toLocaleString('en-GB') + ' ден.'
}
