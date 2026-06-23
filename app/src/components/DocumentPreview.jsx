const sectionLabel = { fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9A9AAC' }

function isImageFile(fileType, fileName) {
  if (fileType) return fileType.startsWith('image/')
  return /\.(png|jpe?g|gif|webp|tiff?|bmp)$/i.test(fileName || '')
}

export default function DocumentPreview({ invoice }) {
  const { fileUrl, fileType, fileName } = invoice
  const hasFile = !!fileUrl
  const isImage = isImageFile(fileType, fileName)

  return (
    <div style={{ position: 'sticky', top: 0, alignSelf: 'start', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={sectionLabel}>Изворен документ</div>
        {hasFile && (
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, letterSpacing: '0.08em', background: '#EEEEF8', color: '#1A1A6E', border: '1px solid rgba(26,26,110,0.18)', padding: '1px 6px', borderRadius: 3 }}>ПРИКАЧЕНО</span>
        )}
      </div>

      <div style={{ background: '#fff', border: '1px solid #E8E8E2', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 14px', background: '#FBFBFA', borderBottom: '1px solid #F0F0EC' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#8A8A9C" strokeWidth="1.4" style={{ flexShrink: 0 }}>
              <path d="M3 1.6h7l3 3v9.8H3z" />
              <path d="M9.6 1.7v3.2h3.2" />
            </svg>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#5A5A6E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fileName || '—'}</span>
          </div>
          {hasFile && (
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#2E2E9E', fontSize: 11.5, fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}
            >
              Отвори
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M6 3h7v7M13 3L6.5 9.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M11 9.5v3.1a1 1 0 01-1 1H3.4a1 1 0 01-1-1V6a1 1 0 011-1h3.1" strokeLinecap="round" />
              </svg>
            </a>
          )}
        </div>

        <div style={{ height: 'calc(100vh - 250px)', minHeight: 460, background: '#F1F1EE', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
          {!hasFile ? (
            <div style={{ textAlign: 'center', padding: '32px 28px', maxWidth: 320 }}>
              <div style={{ width: 52, height: 52, borderRadius: 12, background: '#EAEAE6', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="#A0A0B2" strokeWidth="1.3">
                  <path d="M3 1.6h7l3 3v9.8H3z" />
                  <path d="M9.6 1.7v3.2h3.2" />
                  <path d="M5.4 8.4h5.2M5.4 10.8h3.4" strokeLinecap="round" />
                </svg>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: '#5A5A6E' }}>Изворната датотека не е зачувана</div>
              <div style={{ fontSize: 12, color: '#9A9AAC', marginTop: 6, lineHeight: 1.5 }}>
                Оригиналниот документ е достапен за фактури прикачени во оваа сесија.
              </div>
            </div>
          ) : isImage ? (
            <img src={fileUrl} alt={fileName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
          ) : (
            <iframe src={fileUrl} title={fileName} style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
          )}
        </div>
      </div>
    </div>
  )
}
