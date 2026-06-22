import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { useApp } from '../state/appContext'

export default function VolumeChart() {
  const { invoices } = useApp()

  const data = useMemo(() => {
    const counts = {}
    const today = new Date()
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      counts[d.toISOString().slice(0, 10)] = 0
    }
    invoices.forEach((inv) => {
      const day = inv.received || inv.invoiceDate
      if (day && day in counts) counts[day]++
    })
    return Object.entries(counts).map(([date, v], i) => {
      const d = new Date(date)
      const label = i === 0 || i === 4 || i === 9 || i === 13
        ? d.toLocaleString('en', { day: 'numeric', month: 'short' })
        : ''
      return { i, v, label }
    })
  }, [invoices])

  if (invoices.length === 0) {
    return (
      <div style={{ width: '100%', height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#A0A0B2', fontSize: 12.5, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.04em' }}>
        No invoices yet — upload to see volume
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: 150 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 14, right: 4, bottom: 6, left: 4 }}>
          <CartesianGrid vertical={false} stroke="#F0F0EC" strokeWidth={1} />
          <XAxis
            dataKey="i"
            ticks={[0, 4, 9, 13]}
            tickFormatter={(i) => data[i]?.label || ''}
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fill: '#A0A0B2' }}
          />
          <YAxis hide domain={[0, 'dataMax + 1']} />
          <Area type="linear" dataKey="v" stroke="#1A1A6E" strokeWidth={2} fill="rgba(26,26,110,0.07)" isAnimationActive={false} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={{ r: 3.5, fill: '#1A1A6E', stroke: '#fff', strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
