// Helix-K accounting software export — Налози (journal entries) template.
//
// Generates an XLSX file matching the Налози import template columns.
// Each journal entry row maps to one debit or credit line in the double-entry.
// All arithmetic uses the already-verified invoice values (post_processor.py ran first).

import * as XLSX from 'xlsx'

// Convert ISO date (YYYY-MM-DD) to Macedonian format (DD.MM.YYYY) for Helix-K.
function fmtDateMK(iso) {
  if (!iso) return ''
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}.${parts[1]}.${parts[0]}`
}

// Round to 2 decimal places — amounts going into Helix-K must be exact.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// Return YYYY-MM-DD for the last day of the current calendar month.
function lastDayOfMonthISO() {
  const now = new Date()
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const mm = String(last.getMonth() + 1).padStart(2, '0')
  const dd = String(last.getDate()).padStart(2, '0')
  return `${last.getFullYear()}-${mm}-${dd}`
}

// Return YYYY-MM-DD for the first day of the current calendar month.
function firstDayOfMonthISO() {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-01`
}

// DATUM KNIZENJE logic (computed fresh at export time against today's date):
//   Invoice date in current month   → invoice date
//   Invoice date in previous month  → first day of current month
//   Invoice date in following month → last day of current month
function computeDatumKnizenje(invoiceISODate) {
  if (!invoiceISODate || invoiceISODate.length < 10) return lastDayOfMonthISO()
  const now    = new Date()
  const invDate = new Date(invoiceISODate + 'T00:00:00')
  const invYM  = invDate.getFullYear() * 12 + invDate.getMonth()
  const nowYM  = now.getFullYear()     * 12 + now.getMonth()
  if (invYM === nowYM) return invoiceISODate   // same month → use invoice date
  if (invYM  < nowYM) return firstDayOfMonthISO()  // past month → 1st of current
  return lastDayOfMonthISO()                        // future month → last of current
}

// Map a single invoice's journal entries to an array of Налози row objects.
// Column order matches the Налози template exactly.
export function invoiceToNaloziRows(invoice) {
  const rows = []
  const journal = invoice.journal || []

  // Dates computed at export time (not upload time) so DATUM KNIZENJE logic
  // always uses today's date as the reference point.
  const datumDokument = fmtDateMK(lastDayOfMonthISO())
  const datumKnizenje = fmtDateMK(computeDatumKnizenje(invoice.invoiceDate || ''))
  const sifraKomitent = invoice.komitentSifra || ''
  const sodrzina      = invoice.number  || ''

  for (const entry of journal) {
    rows.push({
      'KONTO':            entry.konto || '',
      'SODRZINA':         sodrzina,
      'SIFRA KOMITENT':   sifraKomitent,
      'IZVOD BR':         '',
      'DEN DOLZI':        r2(entry.debit),
      'DEN POBARUVA':     r2(entry.credit),
      'DEV DOLZI':        0,
      'DEV POBARUVA':     0,
      'KURS':             0,
      'DATUM VALUTA':     '',
      'DATUM DOKUMENT':   datumDokument,
      'ZABELESKA':        '',
      'BROJ DOKUMENT':    '',
      'DATUM KNIZENJE':   datumKnizenje,
      'STATUS POC':       '',
      'OE':               '',
    })
  }

  return rows
}

// Generate and trigger download of a Налози XLSX file for the given invoice.
// Follows the air-gap constraint — no data leaves the local machine.
export function exportToHelixK(invoice) {
  const rows = invoiceToNaloziRows(invoice)

  if (rows.length === 0) {
    throw new Error('No journal entries to export. Generate the journal first.')
  }

  const ws = XLSX.utils.json_to_sheet(rows)

  // Set column widths for readability
  ws['!cols'] = [
    { wch: 8 },   // KONTO
    { wch: 18 },  // SODRZINA
    { wch: 12 },  // SIFRA KOMITENT
    { wch: 8 },   // IZVOD BR
    { wch: 12 },  // DEN DOLZI
    { wch: 12 },  // DEN POBARUVA
    { wch: 12 },  // DEV DOLZI
    { wch: 12 },  // DEV POBARUVA
    { wch: 6 },   // KURS
    { wch: 12 },  // DATUM VALUTA
    { wch: 12 },  // DATUM DOKUMENT
    { wch: 28 },  // ZABELESKA
    { wch: 14 },  // BROJ DOKUMENT
    { wch: 12 },  // DATUM KNIZENJE
    { wch: 8 },   // STATUS POC
    { wch: 6 },   // OE
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Налози')

  const safeNum = (invoice.number || 'export').replace(/[^a-zA-Z0-9_\-]/g, '_')
  const safeDate = (invoice.bookingDate || invoice.invoiceDate || '').replace(/-/g, '')
  const filename = `helixk_${safeNum}_${safeDate}.xlsx`

  XLSX.writeFile(wb, filename)
  return filename
}

// Generate and trigger download of one Налози XLSX file for all invoices in a batch.
// Invoices are sorted by invoiceDate ascending; rows from all invoices are concatenated.
// Follows the air-gap constraint — no data leaves the local machine.
export function exportBatchToHelixK(invoices) {
  const sorted = [...invoices].sort((a, b) => {
    const da = a.invoiceDate || ''
    const db = b.invoiceDate || ''
    return da < db ? -1 : da > db ? 1 : 0
  })

  const rows = sorted.flatMap((inv) => invoiceToNaloziRows(inv))

  if (rows.length === 0) {
    throw new Error('No journal entries to export across the batch.')
  }

  const ws = XLSX.utils.json_to_sheet(rows)

  ws['!cols'] = [
    { wch: 8 },   // KONTO
    { wch: 18 },  // SODRZINA
    { wch: 12 },  // SIFRA KOMITENT
    { wch: 8 },   // IZVOD BR
    { wch: 12 },  // DEN DOLZI
    { wch: 12 },  // DEN POBARUVA
    { wch: 12 },  // DEV DOLZI
    { wch: 12 },  // DEV POBARUVA
    { wch: 6 },   // KURS
    { wch: 12 },  // DATUM VALUTA
    { wch: 12 },  // DATUM DOKUMENT
    { wch: 28 },  // ZABELESKA
    { wch: 14 },  // BROJ DOKUMENT
    { wch: 12 },  // DATUM KNIZENJE
    { wch: 8 },   // STATUS POC
    { wch: 6 },   // OE
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Налози')

  const now = new Date()
  const dateStr = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0')
  const filename = `helixk_batch_${sorted.length}inv_${dateStr}.xlsx`

  XLSX.writeFile(wb, filename)
  return filename
}
