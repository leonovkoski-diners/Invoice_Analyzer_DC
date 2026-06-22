import { Area, AreaChart, ResponsiveContainer } from 'recharts'

// Tiny KPI sparkline — area + line, no axes, matching the prototype's inline-SVG sparks.
export default function Sparkline({ data, color, fill, width = 74, height = 26 }) {
  const points = data.map((v, i) => ({ i, v }))
  return (
    <div style={{ width, height, flexShrink: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 4, right: 1, bottom: 4, left: 1 }}>
          <Area type="linear" dataKey="v" stroke={color} strokeWidth={1.6} fill={fill} isAnimationActive={false} dot={false} strokeLinecap="round" strokeLinejoin="round" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
