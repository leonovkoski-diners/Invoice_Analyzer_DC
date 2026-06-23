import { useLocation } from 'react-router-dom'
import { useApp } from '../state/appContext'

function titleFor(pathname) {
  if (pathname === '/') return ['Контролна табла', 'Преглед на обработката и валидацијата на фактури']
  if (pathname.startsWith('/invoices/')) return ['Детали на фактура', 'Преглед на извлечените полиња и флагови']
  if (pathname === '/invoices') return ['Фактури', 'Сите обработени фактури']
  if (pathname === '/templates') return ['Шаблони', 'Шаблони за детерминистичко извлекување по добавувач']
  return ['Контролна табла', 'Преглед на обработката и валидацијата на фактури']
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
        <button
          onClick={openUpload}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#1A1A6E', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 14px', fontSize: 13, fontWeight: 600 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#13134f')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#1A1A6E')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.6">
            <path d="M8 11V3M4.6 6.2L8 2.8l3.4 3.4M3 12.6h10" />
          </svg>
          Прикачи
        </button>
      </div>
    </header>
  )
}
