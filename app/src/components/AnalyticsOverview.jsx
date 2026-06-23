import { useMemo } from 'react'
import { Bar, BarChart, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApp } from '../state/appContext'
import { mkd, fmtMKDRounded } from '../lib/format'
import { journalTotals } from '../lib/journal'

const MONTHS = ['Јан', 'Феб', 'Мар', 'Апр', 'Мај', 'Јун', 'Јул', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек']
const PALETTE = ['#1A1A6E', '#2E2E9E', '#3AA17E', '#0D5C44', '#7A4100', '#8A8A9C', '#5B8DEF', '#B7791F']
const card = { background: '#fff', border: '1px solid #E8E8E2', borderRadius: 10 }
const chartTitle = { fontSize: 13, fontWeight: 600, color: '#16161F', marginBottom: 10 }

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ ...card, padding: '14px 16px', flex: 1, minWidth: 150 }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A0A0B2' }}>{label}</div>
      <div style={{ fontFamily: "'Lora', serif", fontSize: 23, fontWeight: 600, color: accent || '#16161F', marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#8A8A9C', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function AnalyticsOverview() {
  const { invoices } = useApp()

  const data = useMemo(() => {
    const relevant = invoices.filter((i) => i.status !== 'Rejected')

    // Split each invoice into net (base) and VAT components.
    // Line items carry gross amounts; vatRate (e.g. 18 = 18%) splits them.
    // Unknown rates fall back to the standard MK rate of 18%.
    function splitNetVat(inv) {
      const items = inv.lineItems || []
      if (items.length === 0) {
        const gross = inv.total || 0
        const net = gross / 1.18
        return { net, vat: gross - net }
      }
      let net = 0, vat = 0
      for (const li of items) {
        const gross = li.lineTotal || 0
        const divisor = li.vatRate != null ? 1 + li.vatRate / 100 : 1.18
        const n = gross / divisor
        net += n
        vat += gross - n
      }
      return { net, vat }
    }

    let netMKD = 0, vatMKD = 0
    relevant.forEach((i) => {
      const { net, vat } = splitNetVat(i)
      netMKD += net
      vatMKD += vat
    })
    const vendors = new Set(relevant.map((i) => i.vendor)).size

    const balanced = invoices.filter((i) => journalTotals(i.journal || []).balanced).length
    const health = invoices.length ? Math.round((balanced / invoices.length) * 100) : 100

    const byVendor = {}
    relevant.forEach((i) => {
      byVendor[i.vendor] = (byVendor[i.vendor] || 0) + mkd(i)
    })
    const topVendors = Object.entries(byVendor)
      .map(([name, value]) => ({ name: name.length > 18 ? name.slice(0, 17) + '…' : name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)

    const byCur = {}
    relevant.forEach((i) => {
      const cur = i.currency || 'MKD'
      byCur[cur] = (byCur[cur] || 0) + mkd(i)
    })
    const currency = Object.entries(byCur).map(([name, value]) => ({ name, value: Math.round(value) }))

    const byMonth = {}
    relevant.forEach((i) => {
      if (!i.invoiceDate || i.invoiceDate.length < 7) return
      const key = i.invoiceDate.slice(0, 7)
      byMonth[key] = (byMonth[key] || 0) + mkd(i)
    })
    const monthly = Object.keys(byMonth)
      .sort()
      .map((k) => {
        const [y, m] = k.split('-')
        return { label: `${MONTHS[Number(m) - 1]} ${y.slice(2)}`, value: Math.round(byMonth[k]) }
      })

    return { netMKD, vatMKD, vendors, health, topVendors, currency, monthly }
  }, [invoices])

  const tooltipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid #E8E8E2', fontFamily: "'JetBrains Mono', monospace" }

  return (
    <div style={{ marginTop: 14 }}>
      <h2 style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 18, fontWeight: 600, color: '#16161F', margin: '0 0 12px' }}>Финансиска аналитика</h2>

      <div style={{ ...card, padding: 18 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <StatCard label="Нето трошоци MKD" value={fmtMKDRounded(data.netMKD)} sub="Без одбиени" accent="#1A1A6E" />
          <StatCard label="ДДВ за повраток MKD" value={fmtMKDRounded(data.vatMKD)} sub="Влезен ДДВ" accent="#0D5C44" />
          <StatCard label="Активни добавувачи" value={String(data.vendors)} sub="Различни добавувачи" />
          <StatCard label="Здравје на книжење" value={data.health + '%'} sub="Избалансирани ставки" accent={data.health === 100 ? '#0D5C44' : '#7A4100'} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginTop: 16 }}>
          {/* Monthly trend */}
          <div style={{ border: '1px solid #F0F0EC', borderRadius: 10, padding: '14px 14px 6px' }}>
            <div style={chartTitle}>Месечен тренд на трошоци</div>
            <div style={{ height: 170 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.monthly} margin={{ top: 6, right: 10, bottom: 4, left: 0 }}>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fill: '#A0A0B2' }} />
                  <YAxis hide domain={[0, 'dataMax + 1']} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMKDRounded(v)} />
                  <Line type="monotone" dataKey="value" stroke="#1A1A6E" strokeWidth={2} dot={{ r: 2.5, fill: '#1A1A6E' }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top vendors */}
          <div style={{ border: '1px solid #F0F0EC', borderRadius: 10, padding: '14px 14px 6px' }}>
            <div style={chartTitle}>Топ добавувачи по потрошувачка</div>
            <div style={{ height: 170 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.topVendors} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={104} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#5A5A6E' }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMKDRounded(v)} cursor={{ fill: '#F4F4FB' }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {data.topVendors.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Currency distribution */}
          <div style={{ border: '1px solid #F0F0EC', borderRadius: 10, padding: '14px 14px 6px' }}>
            <div style={chartTitle}>Распределба по валута</div>
            <div style={{ height: 170, display: 'flex', alignItems: 'center' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.currency} dataKey="value" nameKey="name" innerRadius={42} outerRadius={66} paddingAngle={2} isAnimationActive={false}>
                    {data.currency.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMKDRounded(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', paddingBottom: 8 }}>
              {data.currency.map((c, i) => (
                <span key={c.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#5A5A6E' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: PALETTE[i % PALETTE.length] }} />
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
