import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../state/appContext'
import { fmtDate, fmtMoney } from '../lib/format'
import StatusBadge from '../components/StatusBadge'
import FlagBadge from '../components/FlagBadge'

const STATUS_OPTS = ['All', 'Pending', 'Processing', 'Approved', 'Exported', 'Rejected']
const DATE_OPTS = [
  ['All', 'All dates'],
  ['7d', 'Last 7 days'],
  ['month', 'This month'],
  ['overdue', 'Overdue'],
]

const pillBase = { display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #E2E2DC', background: '#fff', borderRadius: 7, padding: '7px 11px', fontSize: 12.5, fontWeight: 500, color: '#5A5A6E' }
const pillActive = { ...pillBase, background: '#1A1A6E', color: '#fff', border: '1px solid #1A1A6E' }
const th = { textAlign: 'left', fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9A9AAC', padding: '11px 16px', borderBottom: '1px solid #E8E8E2' }

export default function Invoices() {
  const navigate = useNavigate()
  const { invoices } = useApp()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [dateFilter, setDateFilter] = useState('All')

  const statusCounts = useMemo(() => {
    const counts = { All: invoices.length }
    ;['Pending', 'Processing', 'Approved', 'Exported', 'Rejected'].forEach((st) => {
      counts[st] = invoices.filter((i) => i.status === st).length
    })
    return counts
  }, [invoices])

  const rows = useMemo(() => {
    let list = invoices.slice()
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
  }, [invoices, statusFilter, search, dateFilter])

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('All')
    setDateFilter('All')
  }

  return (
    <div style={{ padding: '22px 28px 40px' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #E2E2DC', borderRadius: 8, padding: '8px 12px', width: 280 }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#A0A0B2" strokeWidth="1.6">
            <circle cx="7" cy="7" r="5" />
            <path d="M10.8 10.8L14 14" strokeLinecap="round" />
          </svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor or invoice no." style={{ border: 'none', outline: 'none', background: 'none', fontSize: 13, color: '#16161F', width: '100%' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {STATUS_OPTS.map((st) => {
            const active = statusFilter === st
            return (
              <button key={st} onClick={() => setStatusFilter(st)} style={active ? pillActive : pillBase}>
                {st}
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, padding: '0px 5px', borderRadius: 8, background: active ? 'rgba(255,255,255,0.2)' : '#F0F0EC', color: active ? '#fff' : '#8A8A9C' }}>{statusCounts[st]}</span>
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
              <th style={th}>Vendor</th>
              <th style={th}>Invoice no.</th>
              <th style={th}>Date</th>
              <th style={th}>Due</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th>
              <th style={th}>Status</th>
              <th style={th}>Flags</th>
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
            <div style={{ fontSize: 14, color: '#5A5A6E', fontWeight: 600 }}>No invoices match your filters</div>
            <button onClick={clearFilters} style={{ marginTop: 10, background: 'none', border: '1px solid #E2E2DC', borderRadius: 7, padding: '7px 14px', fontSize: 12.5, color: '#2E2E9E', fontWeight: 600 }}>Clear filters</button>
          </div>
        )}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: '#A0A0B2', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.03em' }}>{rows.length} of {invoices.length} invoices</div>
    </div>
  )
}
