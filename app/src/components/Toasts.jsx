import { useApp } from '../state/appContext'

const TOAST_STYLES = {
  ok: { accent: '#0D5C44', bg: '#E4F2EC', color: '#0D5C44', icon: '✓' },
  error: { accent: '#8B1A1A', bg: '#FDEBEB', color: '#8B1A1A', icon: '!' },
  warn: { accent: '#7A4100', bg: '#FEF3E2', color: '#7A4100', icon: '!' },
  info: { accent: '#1A1A6E', bg: '#EEEEF8', color: '#1A1A6E', icon: 'i' },
}

export default function Toasts() {
  const { toasts, dismissToast } = useApp()

  return (
    <div style={{ position: 'fixed', bottom: 22, right: 22, display: 'flex', flexDirection: 'column', gap: 10, zIndex: 80, width: 340, maxWidth: 'calc(100vw - 44px)' }}>
      {toasts.map((t) => {
        const c = TOAST_STYLES[t.type] || TOAST_STYLES.info
        return (
          <div key={t.id} style={{ display: 'flex', gap: 11, background: '#fff', border: '1px solid #E8E8E2', borderLeft: '3px solid ' + c.accent, borderRadius: 10, padding: '12px 13px', boxShadow: '0 10px 28px rgba(14,14,26,0.12)', animation: 'toastIn 0.24s cubic-bezier(0.2,0.8,0.2,1)' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: c.bg, color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0, fontFamily: 'Inter' }}>{c.icon}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#16161F' }}>{t.title}</div>
              <div style={{ fontSize: 12, color: '#6A6A7E', marginTop: 1, lineHeight: 1.45 }}>{t.msg}</div>
            </div>
            <button onClick={() => dismissToast(t.id)} style={{ background: 'none', border: 'none', color: '#B4B4C2', padding: 2, display: 'flex', alignSelf: 'flex-start' }} onMouseEnter={(e) => (e.currentTarget.style.color = '#16161F')} onMouseLeave={(e) => (e.currentTarget.style.color = '#B4B4C2')}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}
