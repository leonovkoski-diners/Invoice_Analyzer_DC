import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../state/appContext'
import { fmtDate, fmtMKDRounded, fmtMoney } from '../lib/format'
import StatusBadge from '../components/StatusBadge'

const th = { textAlign: 'left', fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9A9AAC', padding: '11px 16px', borderBottom: '1px solid #E8E8E2', fontWeight: 500 }

export default function Payments() {
  const navigate = useNavigate()
  const { invoices, pushToast } = useApp()

  const nextFriday = useMemo(() => {
    const d = new Date()
    const day = d.getDay()
    const daysUntilFriday = day <= 5 ? 5 - day : 6
    d.setDate(d.getDate() + daysUntilFriday)
    return d.toISOString().slice(0, 10)
  }, [])

  // Friday payment run: approved/exported invoices due on or before the run date.
  const payList = useMemo(
    () => invoices.filter((i) => (i.status === 'Approved' || i.status === 'Exported') && i.dueDate && i.dueDate <= nextFriday),
    [invoices, nextFriday],
  )

  const byCurrency = useMemo(() => {
    const acc = {}
    payList.forEach((i) => {
      acc[i.currency] = acc[i.currency] || { sum: 0, count: 0 }
      acc[i.currency].sum += i.total
      acc[i.currency].count++
    })
    return Object.keys(acc).map((c) => ({ currency: c, totalFmt: fmtMoney(acc[c].sum, c), count: acc[c].count }))
  }, [payList])

  const payMKD = payList.reduce((acc, i) => acc + (i.total || 0), 0)

  const onExportAll = () => {
    pushToast('info', 'Batch file queued', payList.length + ' invoices · ' + fmtMKDRounded(payMKD) + ' for the Friday run')
  }

  return (
    <div style={{ padding: '22px 28px 40px', maxWidth: 1080 }}>
      <div style={{ background: '#1A1A6E', borderRadius: 12, padding: '22px 24px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>Scheduled payment run</div>
          <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 24, fontWeight: 600, marginTop: 5 }}>{new Date(nextFriday + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.65)', marginTop: 3 }}>{payList.length} invoices cleared for payment · due on or before run date</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>Вкупно MKD</div>
            <div style={{ fontFamily: "'Lora', serif", fontSize: 26, fontWeight: 600, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{fmtMKDRounded(payMKD)}</div>
          </div>
          <button
            onClick={onExportAll}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', color: '#1A1A6E', border: 'none', borderRadius: 8, padding: '11px 16px', fontSize: 13, fontWeight: 600 }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#EEEEF8')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#1A1A6E" strokeWidth="1.6">
              <path d="M8 11V3M4.6 6.2L8 2.8l3.4 3.4M3 12.6h10" />
            </svg>
            Generate batch file
          </button>
        </div>
      </div>

      {/* per currency */}
      <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
        {byCurrency.map((c) => (
          <div key={c.currency} style={{ flex: 1, minWidth: 160, background: '#fff', border: '1px solid #E8E8E2', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A0A0B2' }}>{c.currency} · {c.count} invoices</div>
            <div style={{ fontFamily: "'Lora', serif", fontSize: 23, fontWeight: 600, color: '#16161F', marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>{c.totalFmt}</div>
          </div>
        ))}
      </div>

      {/* table */}
      <div style={{ background: '#fff', border: '1px solid #E8E8E2', borderRadius: 10, overflow: 'hidden', marginTop: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#FBFBFA' }}>
              <th style={th}>Vendor</th>
              <th style={th}>Invoice no.</th>
              <th style={th}>Due</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {payList.map((i) => (
              <tr
                key={i.id}
                onClick={() => navigate('/invoices/' + i.id)}
                style={{ cursor: 'pointer', borderBottom: '1px solid #F4F4F0' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFC')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '11px 16px', fontWeight: 600, color: '#16161F' }}>{i.vendor}</td>
                <td style={{ padding: '11px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#5A5A6E' }}>{i.number}</td>
                <td style={{ padding: '11px 16px', color: '#5A5A6E', whiteSpace: 'nowrap' }}>{fmtDate(i.dueDate)}</td>
                <td style={{ padding: '11px 16px' }}>
                  <StatusBadge status={i.status} />
                </td>
                <td style={{ padding: '11px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, fontWeight: 500, color: '#16161F', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtMoney(i.total, i.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {payList.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#A0A0B2', fontSize: 13 }}>No approved invoices due for this run yet.</div>
        )}
      </div>
    </div>
  )
}
