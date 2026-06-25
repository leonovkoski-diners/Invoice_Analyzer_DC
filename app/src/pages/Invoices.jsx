import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../state/appContext'
import { fmtDate, fmtMoney } from '../lib/format'
import StatusBadge from '../components/StatusBadge'
import FlagBadge from '../components/FlagBadge'

// value = internal status key, label = displayed text
const STATUS_OPTS = [
  { value: 'All',        label: 'Сите' },
  { value: 'Pending',    label: 'На чекање' },
  { value: 'Processing', label: 'Во обработка' },
  { value: 'Approved',   label: 'Одобрени' },
  { value: 'Exported',   label: 'Извезени' },
  { value: 'Rejected',   label: 'Одбиени' },
]
const DATE_OPTS = [
  ['All',     'Сите датуми'],
  ['7d',      'Последни 7 дена'],
  ['month',   'Овој месец'],
  ['overdue', 'Задоцнети'],
]

const pillBase = { display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #E2E2DC', background: '#fff', borderRadius: 7, padding: '7px 11px', fontSize: 12.5, fontWeight: 500, color: '#5A5A6E' }
const pillActive = { ...pillBase, background: '#1A1A6E', color: '#fff', border: '1px solid #1A1A6E' }
const th = { textAlign: 'left', fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9A9AAC', padding: '11px 16px', borderBottom: '1px solid #E8E8E2' }

export default function Invoices() {
  const navigate = useNavigate()
  const { invoices, sessions, exportSelection, toggleExportSelect, exportSelected, clearExportSelection } = useApp()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [dateFilter, setDateFilter] = useState('All')
  const [sessionFilter, setSessionFilter] = useState(null)

  const statusCounts = useMemo(() => {
    const counts = { All: invoices.length }
    ;['Pending', 'Processing', 'Approved', 'Exported', 'Rejected'].forEach((st) => {
      counts[st] = invoices.filter((i) => i.status === st).length
    })
    return counts
  }, [invoices])

  const rows = useMemo(() => {
    let list = invoices.slice()
    if (sessionFilter) {
      const s = sessions.find((s) => s.id === sessionFilter)
      if (s) { const ids = new Set(s.invoiceIds); list = list.filter((i) => ids.has(i.id)) }
    }
    if (statusFilter !== 'All') list = list.filter((i) => i.status === statusFilter)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((i) => i.vendor.toLowerCase().includes(q) || i.number.toLowerCase().includes(q))
    const todayISO = new Date().toISOString().slice(0, 10)
    if (dateFilter === '7d') {
      const cutoff = new Date(todayISO + 'T00:00:00')
      cutoff.setDate(cutoff.getDate() - 7)
      list = list.filter((i) => new Date(i.invoiceDate + 'T00:00:00') >= cutoff)
    } else if (dateFilter === 'month') {
      const monthPrefix = todayISO.slice(0, 7)
      list = list.filter((i) => i.invoiceDate && i.invoiceDate.indexOf(monthPrefix) === 0)
    } else if (dateFilter === 'overdue') {
      list = list.filter((i) => i.dueDate && i.dueDate < todayISO && i.status !== 'Exported')
    }
    return list
  }, [invoices, sessions, sessionFilter, statusFilter, search, dateFilter])

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('All')
    setDateFilter('All')
    setSessionFilter(null)
  }

  return (
    <div style={{ padding: '22px 28px 40px' }}>

      {/* Sessions panel — shown once at least one upload batch exists */}
      {sessions.length > 0 && (
        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#9A9AAC', letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 2, flexShrink: 0 }}>Серии</span>
          <button
            onClick={() => setSessionFilter(null)}
            style={!sessionFilter ? pillActive : pillBase}
          >
            Сите серии
          </button>
          {sessions.map((s) => {
            const isActive = sessionFilter === s.id
            const isLatest = s.id === sessions[sessions.length - 1].id
            const sApproved = s.invoiceIds.filter((id) => {
              const inv = invoices.find((i) => i.id === id)
              return inv && (inv.status === 'Approved' || inv.status === 'Exported')
            }).length
            const time = new Date(s.createdAt).toLocaleTimeString('mk-MK', { hour: '2-digit', minute: '2-digit', hour12: false })
            return (
              <button
                key={s.id}
                onClick={() => setSessionFilter(isActive ? null : s.id)}
                style={{
                  ...(isActive ? pillActive : pillBase),
                  ...(isLatest && !isActive ? { borderColor: '#1A1A6E', color: '#1A1A6E' } : {}),
                }}
              >
                Серија {s.number}
                <span style={{ opacity: 0.65, fontSize: 11 }}>· {time} · {s.invoiceIds.length} фактури</span>
                {sApproved > 0 && (
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, padding: '0 5px', borderRadius: 8, background: isActive ? 'rgba(255,255,255,0.2)' : '#E4F2EC', color: isActive ? '#fff' : '#0D5C44' }}>{sApproved} одобрени</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #E2E2DC', borderRadius: 8, padding: '8px 12px', width: 280 }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#A0A0B2" strokeWidth="1.6">
            <circle cx="7" cy="7" r="5" />
            <path d="M10.8 10.8L14 14" strokeLinecap="round" />
          </svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Пребарај добавувач или бр. фактура" style={{ border: 'none', outline: 'none', background: 'none', fontSize: 13, color: '#16161F', width: '100%' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {STATUS_OPTS.map(({ value, label }) => {
            const active = statusFilter === value
            return (
              <button key={value} onClick={() => setStatusFilter(value)} style={active ? pillActive : pillBase}>
                {label}
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, padding: '0px 5px', borderRadius: 8, background: active ? 'rgba(255,255,255,0.2)' : '#F0F0EC', color: active ? '#fff' : '#8A8A9C' }}>{statusCounts[value]}</span>
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
          {DATE_OPTS.map(([key, label]) => (
            <button key={key} onClick={() => setDateFilter(key)} style={dateFilter === key ? pillActive : pillBase}>{label}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid #E8E8E2', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#FBFBFA' }}>
              <th style={{ ...th, width: 40, padding: '9px 0 9px 14px' }} />
              <th style={th}>Добавувач</th>
              <th style={th}>Бр. фактура</th>
              <th style={th}>Датум</th>
              <th style={th}>Доспевање</th>
              <th style={{ ...th, textAlign: 'right' }}>Износ</th>
              <th style={th}>Статус</th>
              <th style={th}>Флагови</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => (
              <tr
                key={inv.id}
                onClick={() => navigate('/invoices/' + inv.id)}
                style={{ cursor: 'pointer', borderBottom: '1px solid #F4F4F0' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFC')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '0 0 0 14px', width: 40 }} onClick={(e) => e.stopPropagation()}>
                  {(inv.status === 'Approved' || inv.status === 'Exported') && (
                    <input
                      type="checkbox"
                      checked={exportSelection.has(inv.id)}
                      onChange={() => toggleExportSelect(inv.id)}
                      style={{ cursor: 'pointer', accentColor: '#1A1A6E', width: 14, height: 14, display: 'block' }}
                    />
                  )}
                </td>
                <td style={{ padding: '10px 16px' }}>
                  <div style={{ fontWeight: 600, color: '#16161F' }}>{inv.vendor}</div>
                  <div style={{ fontSize: 11, color: '#A0A0B2', marginTop: 1 }}>{inv.country}</div>
                </td>
                <td style={{ padding: '10px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#5A5A6E' }}>{inv.number}</td>
                <td style={{ padding: '10px 16px', color: '#5A5A6E', whiteSpace: 'nowrap' }}>{fmtDate(inv.invoiceDate)}</td>
                <td style={{ padding: '10px 16px', color: '#5A5A6E', whiteSpace: 'nowrap' }}>{fmtDate(inv.dueDate)}</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, fontWeight: 500, color: '#16161F', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(inv.total, inv.currency)}</td>
                <td style={{ padding: '10px 16px' }}>
                  <StatusBadge status={inv.status} />
                </td>
                <td style={{ padding: '10px 16px' }}>
                  {inv.flags.length ? <FlagBadge flags={inv.flags} /> : <span style={{ color: '#C4C4D0' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div style={{ padding: '48px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#5A5A6E', fontWeight: 600 }}>Нема фактури кои одговараат на филтрите</div>
            <button onClick={clearFilters} style={{ marginTop: 10, background: 'none', border: '1px solid #E2E2DC', borderRadius: 7, padding: '7px 14px', fontSize: 12.5, color: '#2E2E9E', fontWeight: 600 }}>Исчисти филтри</button>
          </div>
        )}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: '#A0A0B2', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.03em' }}>{rows.length} од {invoices.length} фактури</div>

      {/* Floating cross-session export bar */}
      {exportSelection.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 300, background: '#1A1A6E', borderRadius: 12,
          padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 14,
          boxShadow: '0 8px 32px rgba(26,26,110,0.35)', whiteSpace: 'nowrap',
        }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'rgba(255,255,255,0.75)', minWidth: 72 }}>
            {exportSelection.size} {exportSelection.size === 1 ? 'избрана' : 'избрани'}
          </span>
          <button
            onClick={exportSelected}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: '#1A1A6E', border: 'none', borderRadius: 7, padding: '7px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#F0F0FC')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M3 1.6h7l3 3v9.8H3z" />
              <path d="M5.6 8.4l1.8 1.8 3-3.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Извези избрани
          </button>
          <button
            onClick={clearExportSelection}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '0 2px', display: 'inline-flex', alignItems: 'center' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
            title="Исчисти избор"
          >×</button>
        </div>
      )}
    </div>
  )
}
