// Double-entry journal (Книжење) generation + balancing.
//
// Accounting logic is deterministic and lives here (not in the model).
// Journal structure for purchase invoices:
//   - One debit row per line item using the GROSS amount (Цена со ДДВ)
//   - Rounding lines (Заокружување) absorbed into the main taxable line if ≥0.50,
//     or discarded if <0.50 — never emitted as a standalone row
//   - No separate VAT row — VAT is included in the gross per-line amounts
//   - One credit row for supplier payable (2200) = sum of all debits
// KONTO codes are assigned by keyword matching against the Macedonian chart of accounts.

// 4499 = Останати трошоци на работење — fallback for unclassified expenses
export const DEFAULT_EXPENSE_KONTO = '4499'
export const VAT_INPUT_KONTO = '1360'   // ДДВ во примени фактури (kept for label display only)
export const PAYABLE_KONTO   = '2200'   // Обврски спрема добавувачи (supplier payable)

// ---------------------------------------------------------------------------
// Keyword → Konto mapping (derived from actual Контен план of Diners Club MK)
// Each rule: { konto, label, keywords[] } — first match wins.
// Keywords matched case-insensitively against the line description + vendor name.
// ---------------------------------------------------------------------------
const EXPENSE_KONTO_MAP = [
  // Electricity — 4030 ELEKTRI^NA ENERGIJA
  {
    konto: '4030', label: 'Електрична енергија',
    keywords: [
      'gemak', 'evn ', 'електр', 'elektr', 'struja', 'струја', 'kwh', 'kw/h',
      'осветлув', 'осветување', 'дистрибуц', 'distribuc', 'ЕВН',
    ],
  },
  // Heating / district heat — 4031 TOPLINSKA ENERGIJA
  {
    konto: '4031', label: 'Топлинска енергија',
    keywords: ['toplin', 'toplif', 'toplana', 'grejanje', 'греење', 'heating'],
  },
  // Fuel — 4032 GORIVO ZA MOTORNI VOZILA
  {
    konto: '4032', label: 'Горива',
    keywords: ['gorivo', 'nafta', 'benzin', 'dizel', 'petrol', 'fuel', 'гориво', 'нафта', 'бензин', 'дизел'],
  },
  // Water — 4150 SNABDUVAWE SO VODA
  {
    konto: '4150', label: 'Снабдување со вода',
    keywords: ['komunalec', 'vodovod', 'voda ', ' voda', 'water', 'водовод', 'вода', 'канализ'],
  },
  // Office materials — 4010 POTRO[EN KANCELARISKI MATERIJAL
  {
    konto: '4010', label: 'Канцелариски материјали',
    keywords: ['kancelariski', 'kancelar', 'канцелар', 'hartija', 'paper', 'toner', 'тонер', 'materijal', 'repro'],
  },
  // Cleaning materials — 4011
  {
    konto: '4011', label: 'Материјал за чистење и одржување',
    keywords: ['^istko', 'cistko', 'chistko', 'cleanin', 'чистко', 'чистење'],
  },
  // Postal — 4110 PO[TENSKI USLUGI
  {
    konto: '4110', label: 'Поштенски услуги',
    keywords: ['po[tenski', 'postensk', 'пошт', 'makedonska po[ta', 'ptt '],
  },
  // Telephone — 4111 TELEFONSKI USLUGI
  {
    konto: '4111', label: 'Телефонски услуги',
    keywords: ['telefonski', 'telekomunikac', 'a1 mak', 'one mak', 'телефон', 'telefon', 'мобил', 'mobil'],
  },
  // Internet — 4112 INTERNET USLUGI
  {
    konto: '4112', label: 'Интернет услуги',
    keywords: ['internet', 'wifi', 'broadband', 'fiber', 'adsl', 'интернет'],
  },
  // Maintenance — 4130 USLUGI ZA TEKOVNO INVESTICIONO ODR@UVAWE
  {
    konto: '4130', label: 'Услуги за тековно и инвестиционо одржување',
    keywords: ['odr@uvawe', 'odrzuvanje', 'одржув', 'поправк', 'popravk', 'tekovno', 'investiciono', 'maintenance', 'servis'],
  },
  // Rent / lease — 4140 NAEMNINI ZA DELOVNI PROSTORII
  {
    konto: '4140', label: 'Наемнини за деловни простории',
    keywords: ['naemnin', 'kirija', 'кирија', 'закуп', 'zakup', 'renta', 'najem', 'leasing', 'lizing', 'наем'],
  },
  // Insurance — 4450 PREMII ZA OSIGURUVAWE
  {
    konto: '4450', label: 'Премии за осигурување',
    keywords: ['osigur', 'polisa', 'triglav', 'uniqa', 'grawe', 'insurance', 'осигур', 'полиса'],
  },
  // Advertising / marketing — 4170 REKLAMIRAWE I PROPAGANDA
  {
    konto: '4170', label: 'Рекламирање и пропаганда',
    keywords: ['reklam', 'marketing', 'oglas', 'реклам', 'маркет', 'огласув', 'propaganda', 'media'],
  },
  // Notary — 44905
  {
    konto: '44905', label: 'Нотарски услуги',
    keywords: ['notarski', 'нотар', 'notary'],
  },
  // Legal / lawyer — 449051
  {
    konto: '449051', label: 'Адвокатски услуги',
    keywords: ['advokat', 'правни', 'pravni', 'legal', 'lawyer', 'адвокат'],
  },
  // IT services — 44907
  {
    konto: '44907', label: 'ИТ услуги',
    keywords: ['software', 'softvyer', 'softver', 'licenc', 'лиценц', 'cloud', 'hosting', 'saas', 'erp', 'it service', 'лиценза'],
  },
  // Consulting / accounting — 44902
  {
    konto: '44902', label: 'Консултантски и советодавни услуги',
    keywords: ['konsalt', 'konsultant', 'sovetodav', 'revizija', 'reviz', 'audit', 'консалт', 'ревиз', 'smetkovod', 'сметководс'],
  },
  // Banking — 4460 BANKARSKI USLUGI
  {
    konto: '4460', label: 'Банкарски услуги',
    keywords: ['bankarski', 'banka', 'bank ', 'provizija', 'камата', 'kamata', 'commission', 'банка', 'провизија'],
  },
  // Transport / delivery — 4109
  {
    konto: '4109', label: 'Транспортни услуги',
    keywords: ['prevoz', 'transport', 'dostava', 'logistik', 'freight', 'cargo', 'delivery', 'kurirsk', 'куриерск', 'достава', 'превоз', 'такси', 'taxi'],
  },
  // Travel / per diem — 44000
  {
    konto: '44000', label: 'Дневници за службени патувања',
    keywords: ['hotel', 'avion', 'airlin', 'letov', 'dnevnic', 'travel', 'хотел', 'патувањ', 'smestu', 'сместув'],
  },
]

// Return the best-matching expense konto for a given text (line description + vendor).
export function assignExpenseKonto(text = '') {
  const lower = (text || '').toLowerCase()
  for (const rule of EXPENSE_KONTO_MAP) {
    if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return rule.konto
    }
  }
  return DEFAULT_EXPENSE_KONTO
}

// Return the human-readable label for a konto code.
export function kontoLabel(konto) {
  if (konto === PAYABLE_KONTO)   return 'Обврска спрема добавувач'
  if (konto === VAT_INPUT_KONTO) return 'ДДВ / Input VAT'
  if (konto === DEFAULT_EXPENSE_KONTO) return 'Останати трошоци на работење'
  const found = EXPENSE_KONTO_MAP.find((r) => r.konto === konto)
  return found ? found.label : ''
}

const EPSILON = 0.01
// Rounding threshold: absolute rounding value below this is discarded, at or above it
// is applied to the main taxable line (rounded to the next whole number).
const ROUNDING_ABSORB_THRESHOLD = 0.50

let rowSeq = 0
function rowId() { return 'je-' + ++rowSeq }

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const round0 = (n) => Math.round(Number(n) || 0)

// Detect rounding/adjustment lines by description keyword.
const ROUNDING_KEYWORDS = ['заокружување', 'zaokruzuvanje', 'zaokruzuv', 'rounding']
function isRoundingLine(description) {
  const lower = (description || '').toLowerCase()
  return ROUNDING_KEYWORDS.some((kw) => lower.includes(kw))
}

// Build a balanced journal from an invoice using GROSS amounts per line.
//
// Strategy:
//   - Separate rounding lines (Заокружување) from regular content lines.
//   - Rounding ≥ 0.50 absolute: apply to the main taxable line (adjust gross).
//   - Rounding < 0.50 absolute: discard entirely.
//   - For each regular line: gross = net × (1 + vatRate/100); exempt lines: gross = net.
//   - No separate VAT row — VAT is baked into the per-line gross amounts.
//   - Supplier payable credit (2200) = sum of all debit entries (balancing).
export function generateJournal(invoice) {
  const entries = []
  const vendorText = invoice.vendor || ''
  const total      = round2(invoice.total ?? 0)
  const lines      = invoice.lineItems || []

  if (lines.length === 0) {
    // No line items at all — single entry using the invoice gross total
    const konto = assignExpenseKonto(vendorText)
    entries.push({ id: rowId(), konto, opis: vendorText || 'Expense', debit: round0(total), credit: 0 })
    entries.push({ id: rowId(), konto: PAYABLE_KONTO, opis: 'Обврска спрема добавувач', debit: 0, credit: round0(total) })
    return entries
  }

  // Split rounding lines from regular lines
  const regularLines = []
  let roundingTotal = 0
  for (const li of lines) {
    if (isRoundingLine(li.description)) {
      roundingTotal = round2(roundingTotal + (Number(li.lineTotal) || 0))
    } else {
      regularLines.push(li)
    }
  }

  // Rounding rule: |roundingTotal| >= 0.50 → apply to main taxable line; else discard
  const applyRounding = Math.abs(roundingTotal) >= ROUNDING_ABSORB_THRESHOLD

  // Calculate gross per regular line; track the main taxable line index
  let mainTaxableIdx = -1
  let maxGross = -Infinity
  const grossAmounts = regularLines.map((li, i) => {
    const net     = round2(Number(li.lineTotal) || 0)
    const vatRate = Number(li.vatRate) || 0
    const gross   = vatRate > 0 ? round2(net * (1 + vatRate / 100)) : net
    if (vatRate > 0 && gross > maxGross) {
      maxGross = gross
      mainTaxableIdx = i
    }
    return gross
  })

  // Apply rounding to main taxable line when threshold is met
  if (applyRounding && mainTaxableIdx >= 0) {
    grossAmounts[mainTaxableIdx] = round2(grossAmounts[mainTaxableIdx] + roundingTotal)
  }

  // Fallback: if no per-line vatRate was extracted but the invoice carries a tax amount,
  // add the invoice-level tax to the largest line so debits reflect gross (VAT-inclusive) amounts.
  if (mainTaxableIdx < 0) {
    const invTax = round2(invoice.taxAmount ?? 0)
    if (invTax > 0) {
      let bigIdx = 0
      for (let i = 1; i < grossAmounts.length; i++) {
        if (grossAmounts[i] > grossAmounts[bigIdx]) bigIdx = i
      }
      grossAmounts[bigIdx] = round2(grossAmounts[bigIdx] + invTax)
    }
  }

  // Build one debit row per regular line using its gross amount
  for (let i = 0; i < regularLines.length; i++) {
    const li  = regularLines[i]
    const amt = grossAmounts[i]
    if (Math.abs(amt) < EPSILON) continue
    const desc  = (li.description || '').trim() || vendorText
    const konto = assignExpenseKonto(desc + ' ' + vendorText)
    if (amt >= 0) {
      entries.push({ id: rowId(), konto, opis: desc, debit: round0(amt), credit: 0 })
    } else {
      entries.push({ id: rowId(), konto, opis: desc, debit: 0, credit: round0(-amt) })
    }
  }

  // Supplier payable credit = net sum of all debit entries (balancing)
  const debitSum = round0(
    entries.reduce((s, e) => s + (Number(e.debit) || 0) - (Number(e.credit) || 0), 0)
  )
  entries.push({
    id: rowId(),
    konto: PAYABLE_KONTO,
    opis: 'Обврска спрема добавувач',
    debit: 0,
    credit: debitSum || total,
  })

  return entries
}

export function journalTotals(entries) {
  let debit = 0, credit = 0
  for (const e of entries) {
    debit  += Number(e.debit)  || 0
    credit += Number(e.credit) || 0
  }
  debit  = round2(debit)
  credit = round2(credit)
  return { debit, credit, balanced: Math.abs(debit - credit) < EPSILON }
}

export function emptyJournalRow() {
  return { id: rowId(), konto: '', opis: '', debit: 0, credit: 0 }
}

// Group entries by KONTO, summing debit/credit — backs the "Group by Konto" toggle.
export function groupByKonto(entries) {
  const map = new Map()
  for (const e of entries) {
    const key = e.konto || '—'
    const g = map.get(key) || { konto: key, opis: e.opis, debit: 0, credit: 0, count: 0 }
    g.debit  = round2(g.debit  + (Number(e.debit)  || 0))
    g.credit = round2(g.credit + (Number(e.credit) || 0))
    g.count += 1
    if (g.count > 1) g.opis = `${g.count} entries`
    map.set(key, g)
  }
  return Array.from(map.values())
}
