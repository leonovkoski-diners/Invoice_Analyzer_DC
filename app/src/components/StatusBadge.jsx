const STATUS_STYLES = {
  Pending: { background: '#FEF3E2', color: '#7A4100', border: '1px solid rgba(122,65,0,0.22)' },
  Processing: { background: '#EEEEF8', color: '#1A1A6E', border: '1px solid rgba(26,26,110,0.22)' },
  Approved: { background: '#E4F2EC', color: '#0D5C44', border: '1px solid rgba(13,92,68,0.22)' },
  Exported: { background: '#1A1A6E', color: '#ffffff', border: '1px solid #1A1A6E' },
  Rejected: { background: '#F1F1EE', color: '#8A8A9C', border: '1px solid #E2E2DC' },
}

const BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '10px',
  fontWeight: 500,
  letterSpacing: '0.04em',
  padding: '3px 8px',
  borderRadius: '5px',
  whiteSpace: 'nowrap',
}

export default function StatusBadge({ status }) {
  const style = { ...BASE, ...(STATUS_STYLES[status] || {}) }
  return (
    <span style={style}>
      {status === 'Processing' && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1A1A6E', animation: 'pulseDot 1.1s infinite' }} />
      )}
      {status}
    </span>
  )
}
