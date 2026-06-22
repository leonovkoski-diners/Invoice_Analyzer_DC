import { flagSummary } from '../lib/invoice'

const BASE = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '10px',
  fontWeight: 500,
  padding: '2px 7px',
  borderRadius: '4px',
  whiteSpace: 'nowrap',
  letterSpacing: '0.03em',
}

const TONES = {
  high: { background: '#FDEBEB', color: '#8B1A1A', border: '1px solid rgba(139,26,26,0.25)' },
  warn: { background: '#FEF3E2', color: '#7A4100', border: '1px solid rgba(122,65,0,0.25)' },
}

// Renders the compact flag pill (e.g. "2 · critical" / "1 warning"). Renders nothing when clean.
export default function FlagBadge({ flags }) {
  const summary = flagSummary(flags)
  if (!summary) return null
  return <span style={{ ...BASE, ...TONES[summary.tone] }}>{summary.label}</span>
}
