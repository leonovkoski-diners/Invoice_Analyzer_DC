import { useState } from 'react'
import { journalTotals, groupByKonto, emptyJournalRow } from '../lib/journal'
import { fmtMoney } from '../lib/format'

const headCell = { textAlign: 'left', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9A9AAC', padding: '9px 10px', borderBottom: '1px solid #F0F0EC', fontWeight: 500 }
const cellInput = { width: '100%', border: '1px solid transparent', background: 'transparent', borderRadius: 6, padding: '6px 8px', fontSize: 12.5, color: '#16161F', outline: 'none', fontFamily: 'inherit' }
const numInput = { ...cellInput, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }
const toggleBtn = (active) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid', borderColor: active ? '#1A1A6E' : '#E2E2DC', background: active ? '#1A1A6E' : '#fff', color: active ? '#fff' : '#5A5A6E', borderRadius: 7, padding: '6px 11px', fontSize: 12, fontWeight: 600 })

function focusBorder(e) {
  e.currentTarget.style.border = '1px solid #C8C8E0'
  e.currentTarget.style.background = '#FAFAFC'
}
function blurBorder(e) {
  e.currentTarget.style.border = '1px solid transparent'
  e.currentTarget.style.background = 'transparent'
}

export default function JournalEditor({ invoice, onChange, editable = true }) {
  const [grouped, setGrouped] = useState(false)
  const entries = invoice.journal || []
  const totals = journalTotals(entries)
  const currency = invoice.currency

  const update = (id, patch) => onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  const remove = (id) => onChange(entries.filter((e) => e.id !== id))
  const add = () => onChange([...entries, emptyJournalRow()])
  const num = (v) => {
    if (v === '' || v == null) return ''
    const n = Number(v)
    return isFinite(n) ? n.toFixed(2) : ''
  }

  const groupedRows = groupByKonto(entries)

  return (
    <div style={{ background: '#fff', border: '1px solid #E8E8E2', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderBottom: '1px solid #F0F0EC', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#1A1A6E" strokeWidth="1.5">
            <path d="M3 2h10v12H3z" />
            <path d="M6 2v12M3 6h3M3 10h3" />
          </svg>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: '#16161F' }}>Книжења</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setGrouped(false)} style={toggleBtn(!grouped)}>Прикажи поединечно</button>
          <button onClick={() => setGrouped(true)} style={toggleBtn(grouped)}>Групирај по конто</button>
          {editable && !grouped && (
            <button onClick={add} title="Додај ред" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, border: 'none', background: '#1A1A6E', color: '#fff', borderRadius: 7, fontSize: 18, lineHeight: 1 }}>+</button>
          )}
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: '#FBFBFA' }}>
            <th style={{ ...headCell, width: 36, textAlign: 'center' }}>#</th>
            <th style={{ ...headCell, width: '20%' }}>Конто</th>
            <th style={headCell}>Опис</th>
            <th style={{ ...headCell, textAlign: 'right', width: '16%' }}>Должи</th>
            <th style={{ ...headCell, textAlign: 'right', width: '16%' }}>Побарува</th>
            {editable && !grouped && <th style={{ ...headCell, width: 40 }} />}
          </tr>
        </thead>
        <tbody>
          {!grouped &&
            entries.map((e, idx) => (
              <tr key={e.id} style={{ borderBottom: '1px solid #F4F4F0' }}>
                <td style={{ textAlign: 'center', color: '#A0A0B2', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{idx + 1}</td>
                <td style={{ padding: '2px 4px' }}>
                  <input value={e.konto} disabled={!editable} onChange={(ev) => update(e.id, { konto: ev.target.value })} onFocus={focusBorder} onBlur={blurBorder} style={{ ...cellInput, fontFamily: "'JetBrains Mono', monospace" }} />
                </td>
                <td style={{ padding: '2px 4px' }}>
                  <input value={e.opis} disabled={!editable} onChange={(ev) => update(e.id, { opis: ev.target.value })} onFocus={focusBorder} onBlur={blurBorder} style={cellInput} />
                </td>
                <td style={{ padding: '2px 4px' }}>
                  <input value={num(e.debit)} inputMode="decimal" disabled={!editable} onChange={(ev) => update(e.id, { debit: parseFloat(ev.target.value) || 0 })} onFocus={focusBorder} onBlur={blurBorder} style={numInput} />
                </td>
                <td style={{ padding: '2px 4px' }}>
                  <input value={num(e.credit)} inputMode="decimal" disabled={!editable} onChange={(ev) => update(e.id, { credit: parseFloat(ev.target.value) || 0 })} onFocus={focusBorder} onBlur={blurBorder} style={numInput} />
                </td>
                {editable && (
                  <td style={{ textAlign: 'center' }}>
                    <button onClick={() => remove(e.id)} title="Избриши ред" style={{ background: 'none', border: 'none', color: '#C46A6A', padding: 4, display: 'inline-flex' }} onMouseEnter={(ev) => (ev.currentTarget.style.color = '#8B1A1A')} onMouseLeave={(ev) => (ev.currentTarget.style.color = '#C46A6A')}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 4h10M6.5 4V2.6h3V4M5 4l.6 9.4h4.8L11 4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </td>
                )}
              </tr>
            ))}

          {grouped &&
            groupedRows.map((g, idx) => (
              <tr key={g.konto + idx} style={{ borderBottom: '1px solid #F4F4F0' }}>
                <td style={{ textAlign: 'center', color: '#A0A0B2', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{idx + 1}</td>
                <td style={{ padding: '8px 10px', fontFamily: "'JetBrains Mono', monospace" }}>{g.konto}</td>
                <td style={{ padding: '8px 10px', color: '#5A5A6E' }}>{g.count > 1 ? `${g.count} ставки` : g.opis}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>{g.debit ? fmtMoney(g.debit, currency) : '—'}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>{g.credit ? fmtMoney(g.credit, currency) : '—'}</td>
              </tr>
            ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 14px', borderTop: '1px solid #F0F0EC', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#8A8A9C' }}>Вкупно должи <strong style={{ color: '#16161F', fontFamily: "'JetBrains Mono', monospace", marginLeft: 6 }}>{fmtMoney(totals.debit, currency)}</strong></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', padding: '4px 10px', borderRadius: 6, background: totals.balanced ? '#E4F2EC' : '#FDEBEB', color: totals.balanced ? '#0D5C44' : '#8B1A1A' }}>
          {totals.balanced ? (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#0D5C44" strokeWidth="1.8"><path d="M3.5 8.2l3 3 6-6.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#8B1A1A" strokeWidth="1.8"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
          )}
          {totals.balanced ? 'ИЗБАЛАНСИРАНО' : 'НЕИЗБАЛАНСИРАНО'}
        </span>
        <span style={{ fontSize: 12, color: '#8A8A9C' }}>Вкупно побарува <strong style={{ color: '#16161F', fontFamily: "'JetBrains Mono', monospace", marginLeft: 6 }}>{fmtMoney(totals.credit, currency)}</strong></span>
      </div>
    </div>
  )
}
