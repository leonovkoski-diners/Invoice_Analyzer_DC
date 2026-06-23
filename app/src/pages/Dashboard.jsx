import { useNavigate } from 'react-router-dom'
import { useApp } from '../state/appContext'
import { fmtDate, fmtMKDRounded, fmtMoney } from '../lib/format'
import StatusBadge from '../components/StatusBadge'
import FlagBadge from '../components/FlagBadge'
import Sparkline from '../components/Sparkline'
import VolumeChart from '../components/VolumeChart'
import AnalyticsOverview from '../components/AnalyticsOverview'

const cardStyle = { background: '#fff', border: '1px solid #E8E8E2', borderRadius: 10 }

export default function Dashboard() {
  const navigate = useNavigate()
  const { invoices } = useApp()

  const total = invoices.length
  const pending = invoices.filter((i) => i.status === 'Pending').length
  const exported = invoices.filter((i) => i.status === 'Exported').length
  const totalValue = invoices.reduce((acc, i) => acc + (i.total || 0), 0)

  const kpis = [
    { label: 'Вкупно фактури', value: String(total), sub: 'Во работниот простор', data: [total], color: '#1A1A6E', fill: 'rgba(26,26,110,0.08)' },
    { label: 'Чекаат одобрување', value: String(pending), sub: 'Чекаат преглед', data: [pending], color: '#B7791F', fill: 'rgba(183,121,31,0.10)' },
    { label: 'Извезени овој месец', value: String(exported), sub: new Date().toLocaleString('mk', { month: 'long', year: 'numeric' }), data: [exported], color: '#0D5C44', fill: 'rgba(13,92,68,0.10)' },
    { label: 'Вкупна вредност', value: fmtMKDRounded(totalValue), sub: 'MKD, сите фактури', data: [totalValue || 0], color: '#1A1A6E', fill: 'rgba(26,26,110,0.08)' },
  ]

  const recent = invoices.slice(0, 6)
  const attention = invoices.filter((i) => i.flags.length > 0)
  const attentionTop = attention.slice(0, 5)

  return (
    <div style={{ padding: '24px 28px 40px', maxWidth: 1180 }}>
      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
        {kpis.map((kpi) => (
          <div key={kpi.label} style={{ ...cardStyle, padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 108 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A0A0B2', lineHeight: 1.3 }}>{kpi.label}</div>
              <Sparkline data={kpi.data} color={kpi.color} fill={kpi.fill} />
            </div>
            <div>
              <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 29, fontWeight: 600, color: '#16161F', letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{kpi.value}</div>
              <div style={{ fontSize: 11.5, color: '#8A8A9C', marginTop: 5 }}>{kpi.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Financial analytics — computed from the live invoice set */}
      <AnalyticsOverview />

      {/* Volume chart */}
      <div style={{ ...cardStyle, padding: '18px 20px 14px', marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#16161F' }}>Волумен на фактури</div>
            <div style={{ fontSize: 11.5, color: '#A0A0B2', marginTop: 1 }}>Обработени по ден · последни 14 дена</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#8A8A9C', letterSpacing: '0.04em' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#1A1A6E' }} /> ОБРАБОТЕНИ
          </div>
        </div>
        <VolumeChart />
      </div>

      {/* Two columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.45fr 1fr', gap: 14, marginTop: 14 }}>
        {/* Recent */}
        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #F0F0EC' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#16161F' }}>Последни фактури</div>
            <button onClick={() => navigate('/invoices')} style={{ background: 'none', border: 'none', color: '#2E2E9E', fontSize: 12, fontWeight: 600, padding: 0 }}>Прикажи ги сите →</button>
          </div>
          {recent.map((inv) => (
            <div
              key={inv.id}
              onClick={() => navigate('/invoices/' + inv.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: '1px solid #F4F4F0', cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFC')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#16161F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{inv.vendor}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: '#A0A0B2', marginTop: 1 }}>{inv.number} · {fmtDate(inv.invoiceDate)}</div>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, fontWeight: 500, color: '#16161F', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(inv.total, inv.currency)}</div>
              <StatusBadge status={inv.status} />
            </div>
          ))}
        </div>

        {/* Needs attention */}
        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', borderBottom: '1px solid #F0F0EC' }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#8B1A1A" strokeWidth="1.5">
              <path d="M8 1.8L15 14H1z" />
              <path d="M8 6.4v3.2" strokeLinecap="round" />
              <circle cx="8" cy="11.6" r="0.5" fill="#8B1A1A" />
            </svg>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#16161F' }}>Потребно внимание</div>
            <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#8B1A1A', fontWeight: 500 }}>{attention.length}</span>
          </div>
          {attentionTop.map((inv) => (
            <div
              key={inv.id}
              onClick={() => navigate('/invoices/' + inv.id)}
              style={{ padding: '11px 18px', borderBottom: '1px solid #F4F4F0', cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#FAFAFC')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#16161F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{inv.vendor}</div>
                <FlagBadge flags={inv.flags} />
              </div>
              <div style={{ fontSize: 11.5, color: '#8A8A9C', marginTop: 3, lineHeight: 1.45 }}>{inv.flags[0] && inv.flags[0].text}</div>
            </div>
          ))}
          {attention.length === 0 && (
            <div style={{ padding: '28px 18px', textAlign: 'center', color: '#A0A0B2', fontSize: 12.5 }}>Сè е во ред — нема флагови за валидација.</div>
          )}
        </div>
      </div>
    </div>
  )
}
