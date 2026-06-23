import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../state/appContext'
import { getTemplates } from '../lib/api'

const navBase = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  borderRadius: '8px',
  padding: '9px 10px',
  fontSize: '13px',
  fontWeight: 500,
  color: '#5A5A6E',
}
const navActive = { ...navBase, background: '#EEEEF8', color: '#1A1A6E', fontWeight: 600 }

function countStyle(active) {
  return {
    marginLeft: 'auto',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '10px',
    fontWeight: 500,
    padding: '1px 6px',
    borderRadius: '10px',
    background: active ? '#1A1A6E' : '#EDEDE7',
    color: active ? '#fff' : '#8A8A9C',
  }
}

export default function Sidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { invoices, openUpload } = useApp()
  const [templateCount, setTemplateCount] = useState(0)

  useEffect(() => {
    getTemplates()
      .then((d) => setTemplateCount((d.templates || []).length))
      .catch(() => {})
  }, [])

  const onDashboard = pathname === '/'
  const onInvoices = pathname === '/invoices' || pathname.startsWith('/invoices/')
  const onTemplates = pathname === '/templates'

  return (
    <aside style={{ width: 236, flexShrink: 0, borderRight: '1px solid #E8E8E2', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid #F0F0EC' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: '#1A1A6E', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.4">
              <path d="M3 1.6h7l3 3v9.8H3z" />
              <path d="M9.6 1.7v3.2h3.2" />
              <path d="M5.4 8h5.2M5.4 10.4h5.2M5.4 5.6h2.2" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em', color: '#16161F' }}>Invoice Analyzer</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#A0A0B2', marginTop: 1 }}>OCR · Шаблони</div>
          </div>
        </div>
      </div>

      <nav style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#B4B4C2', padding: '6px 10px 8px' }}>Работен простор</div>

        <button onClick={() => navigate('/')} style={onDashboard ? navActive : navBase}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1.5" y="1.5" width="5.2" height="5.2" rx="1" />
            <rect x="9.3" y="1.5" width="5.2" height="5.2" rx="1" />
            <rect x="1.5" y="9.3" width="5.2" height="5.2" rx="1" />
            <rect x="9.3" y="9.3" width="5.2" height="5.2" rx="1" />
          </svg>
          <span>Контролна табла</span>
        </button>

        <button onClick={() => navigate('/invoices')} style={onInvoices ? navActive : navBase}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 3.5h12M2 8h12M2 12.5h12" />
            <circle cx="2" cy="3.5" r="0.4" fill="currentColor" />
          </svg>
          <span>Фактури</span>
          <span style={countStyle(onInvoices)}>{invoices.length}</span>
        </button>

        <button onClick={() => navigate('/templates')} style={onTemplates ? navActive : navBase}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2" width="12" height="12" rx="1.5" />
            <path d="M5 5h6M5 8h4M5 11h3" strokeLinecap="round" />
          </svg>
          <span>Шаблони</span>
          <span style={countStyle(onTemplates)}>{templateCount}</span>
        </button>
      </nav>

      <div style={{ padding: '6px 14px 16px', marginTop: 'auto' }}>
        <button
          onClick={openUpload}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#1A1A6E', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 14px', fontSize: 13, fontWeight: 600, letterSpacing: '0.01em' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#13134f')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#1A1A6E')}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.6">
            <path d="M8 11V3M4.6 6.2L8 2.8l3.4 3.4M3 12.6h10" />
          </svg>
          Прикачи фактура
        </button>

        <div style={{ marginTop: 14, padding: '11px 12px', border: '1px solid #EDEDE7', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#EAEAF6', color: '#1A1A6E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12, flexShrink: 0 }}>LN</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#16161F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>L. Novkoski</div>
            <div style={{ fontSize: 11, color: '#A0A0B2', whiteSpace: 'nowrap' }}>Финансиски операции</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, padding: '0 4px' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#0D5C44', flexShrink: 0 }} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.06em', color: '#8A8A9C' }}>100% ЛОКАЛНО · БЕЗ ИСПРАЌАЊЕ ПОДАТОЦИ</span>
        </div>
      </div>
    </aside>
  )
}
