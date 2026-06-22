import { useNavigate } from 'react-router-dom'
import { useApp } from '../state/appContext'

// Status dot colors for each invoice in the batch review bar.
const DOT_COLOR = {
  Approved: '#0D5C44',
  Exported: '#0D5C44',
  Rejected: '#8B1A1A',
  Pending: '#C4C4D0',
}

const DOT_TITLE = {
  Approved: 'Approved',
  Exported: 'Exported',
  Rejected: 'Rejected',
  Pending: 'Pending review',
}

export default function BatchNavBar({ currentInvoiceId }) {
  const navigate = useNavigate()
  const {
    invoices,
    batchQueue,
    batchCursor,
    batchDoneItems,
    batchErrorItems,
    batchAllDone,
    batchNavNext,
    batchNavPrev,
    batchNavTo,
    exportAllApproved,
    clearBatchSession,
  } = useApp()

  const total = batchDoneItems.length
  const pos = batchCursor + 1
  const hasPrev = batchCursor > 0
  const hasNext = batchCursor < total - 1
  const errorCount = batchErrorItems.length

  // Count approved invoices in this batch for the export button label.
  const doneIds = new Set(batchDoneItems.map((i) => i.invoiceId))
  const approvedCount = invoices.filter(
    (inv) => doneIds.has(inv.id) && (inv.status === 'Approved' || inv.status === 'Exported'),
  ).length

  const navTo = (id) => {
    if (id) navigate('/invoices/' + id)
  }

  const btnBase = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    border: '1px solid rgba(255,255,255,0.25)', borderRadius: 7,
    padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
    background: 'rgba(255,255,255,0.12)', color: '#fff', transition: 'background 0.12s',
  }
  const btnDisabled = { ...btnBase, opacity: 0.35, cursor: 'not-allowed', pointerEvents: 'none' }

  return (
    <div style={{ background: '#1A1A6E', borderRadius: '0 0 10px 10px', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
      {/* Batch label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' }}>Batch session</span>
        {!batchAllDone && (
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', opacity: 0.7, animation: 'pulseDot 1s infinite' }} />
        )}
        {errorCount > 0 && (
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: '#F4A0A0', letterSpacing: '0.05em' }}>{errorCount} failed</span>
        )}
      </div>

      {/* Prev / position / Next */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          style={hasPrev ? btnBase : btnDisabled}
          onClick={() => navTo(batchNavPrev())}
          onMouseEnter={(e) => hasPrev && (e.currentTarget.style.background = 'rgba(255,255,255,0.22)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.5 3.5L5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Prev
        </button>

        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#fff', fontWeight: 600, minWidth: 54, textAlign: 'center' }}>
          {pos} / {total}
        </span>

        <button
          style={hasNext ? btnBase : btnDisabled}
          onClick={() => navTo(batchNavNext())}
          onMouseEnter={(e) => hasNext && (e.currentTarget.style.background = 'rgba(255,255,255,0.22)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
        >
          Next
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6.5 3.5L11 8l-4.5 4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      {/* Status dots — one per successfully extracted invoice */}
      {total <= 20 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, flexWrap: 'wrap' }}>
          {batchDoneItems.map((item, idx) => {
            const inv = invoices.find((i) => i.id === item.invoiceId)
            const invStatus = inv ? inv.status : 'Pending'
            const isCurrent = idx === batchCursor
            return (
              <button
                key={item.batchId}
                title={`${item.fileName} · ${DOT_TITLE[invStatus] || invStatus}`}
                onClick={() => navTo(batchNavTo(idx))}
                style={{
                  width: isCurrent ? 20 : 10,
                  height: 10,
                  borderRadius: 5,
                  background: isCurrent ? '#fff' : (DOT_COLOR[invStatus] || '#888'),
                  border: isCurrent ? 'none' : '1.5px solid rgba(255,255,255,0.3)',
                  padding: 0,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
              />
            )
          })}
        </div>
      )}
      {total > 20 && (
        <div style={{ flex: 1 }} />
      )}

      {/* Export all approved */}
      <button
        onClick={exportAllApproved}
        disabled={approvedCount === 0}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          border: 'none', borderRadius: 7,
          padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
          background: approvedCount > 0 ? '#fff' : 'rgba(255,255,255,0.15)',
          color: approvedCount > 0 ? '#1A1A6E' : 'rgba(255,255,255,0.4)',
          cursor: approvedCount > 0 ? 'pointer' : 'not-allowed',
          transition: 'background 0.12s',
        }}
        onMouseEnter={(e) => approvedCount > 0 && (e.currentTarget.style.background = '#F0F0FC')}
        onMouseLeave={(e) => approvedCount > 0 && (e.currentTarget.style.background = '#fff')}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M3 1.6h7l3 3v9.8H3z" />
          <path d="M5.6 8.4l1.8 1.8 3-3.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Export {approvedCount > 0 ? approvedCount : ''} Approved
      </button>

      {/* End session */}
      <button
        onClick={clearBatchSession}
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: 500, cursor: 'pointer', padding: '4px 2px', whiteSpace: 'nowrap' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
      >
        End session
      </button>
    </div>
  )
}
