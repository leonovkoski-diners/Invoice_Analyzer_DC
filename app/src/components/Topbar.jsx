import { useLocation } from 'react-router-dom'
import { useApp } from '../state/appContext'

function titleFor(pathname) {
  if (pathname === '/') return ['Dashboard', 'Overview of invoice processing & validation']
  if (pathname === '/payments') return ['Payment run', 'Approved invoices scheduled for payment']
  if (pathname.startsWith('/invoices/')) return ['Invoice detail', 'Review extracted fields & validation flags']
  if (pathname === '/invoices') return ['Invoices', 'All processed invoices']
  return ['Dashboard', 'Overview of invoice processing & validation']
}

export default function Topbar() {
  const { pathname } = useLocation()
  const { openUpload } = useApp()
  const [title, sub] = titleFor(pathname)

  return (
    <header style={{ height: 66, flexShrink: 0, borderBottom: '1px solid #E8E8E2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', background: '#fff' }}>
      <div>
        <h1 style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 20, fontWeight: 600, color: '#16161F', margin: 0, letterSpacing: '-0.01em', lineHeight: 1.1 }}>{title}</h1>
        <div style={{ fontSize: 12, color: '#8A8A9C', marginTop: 1 }}>{sub}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 11px', border: '1px solid #EDEDE7', borderRadius: 7 }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#8A8A9C" strokeWidth="1.5">
            <rect x="1.6" y="2.8" width="12.8" height="11" rx="1.4" />
            <path d="M1.6 6.2h12.8M4.5 1.4v2.4M11.5 1.4v2.4" />
          </svg>
          <span style={{ fontSize: 12, color: '#5A5A6E' }}>
            Next run <strong style={{ color: '#16161F', fontWeight: 600 }}>Fri 20 Jun</strong>
          </span>
        </div>
        <button
          onClick={openUpload}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#1A1A6E', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 14px', fontSize: 13, fontWeight: 600 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#13134f')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#1A1A6E')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.6">
            <path d="M8 11V3M4.6 6.2L8 2.8l3.4 3.4M3 12.6h10" />
          </svg>
          Upload
        </button>
      </div>
    </header>
  )
}
