import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../state/appContext'
import { getHealth } from '../lib/api'

// Maps the /api/health payload to a readiness chip shown before upload.
function engineStatus(h) {
  if (!h) return { tone: 'idle', text: 'Се проверува OCR моторот…' }
  if (h.error) return { tone: 'bad', text: 'Сервисот е офлајн — стартувај: uvicorn api.main:app --port 8000' }
  if (h.ocr_ready) return { tone: 'ok', text: `OCR подготвен · EasyOCR · ${h.template_count || 0} шаблони` }
  if (h.ready) return { tone: 'ok', text: 'Сервисот е подготвен · EasyOCR се вчитува…' }
  return { tone: 'bad', text: 'Моторот за извлекување не е подготвен' }
}

const TONE_COLOR = { ok: '#0D5C44', bad: '#8B1A1A', idle: '#A0A0B2' }

const STATUS_ICON = {
  waiting: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#A0A0B2" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5l2 1.5" strokeLinecap="round" />
    </svg>
  ),
  analyzing: (
    <div style={{ width: 14, height: 14, border: '2px solid #EEEEF8', borderTopColor: '#1A1A6E', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
  ),
  done: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#0D5C44" strokeWidth="1.8">
      <path d="M3.5 8.2l3 3 6-6.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#8B1A1A" strokeWidth="1.8">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  ),
}

const STATUS_COLOR = { waiting: '#A0A0B2', analyzing: '#1A1A6E', done: '#0D5C44', error: '#8B1A1A' }
const STATUS_LABEL = { waiting: 'Чека', analyzing: 'Се анализира', done: 'Завршено', error: 'Грешка' }

export default function UploadModal() {
  const navigate = useNavigate()
  const {
    uploadOpen,
    closeUpload,
    batchQueue,
    batchAllDone,
    batchDoneItems,
    batchErrorItems,
    batchMode,
    startBatchSession,
    clearBatchSession,
  } = useApp()
  const [dragOver, setDragOver] = useState(false)
  const [health, setHealth] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!uploadOpen) return
    let cancelled = false
    getHealth()
      .then((h) => !cancelled && setHealth(h))
      .catch(() => !cancelled && setHealth({ error: true }))
    return () => {
      cancelled = true
    }
  }, [uploadOpen])

  if (!uploadOpen) return null

  const status = engineStatus(health)

  const dropBase = { border: '2px dashed #D8D8D2', borderRadius: 12, padding: '30px 20px', transition: 'all 0.15s', background: '#FCFCFB' }
  const dropZoneStyle = dragOver ? { ...dropBase, border: '2px dashed #1A1A6E', background: '#F4F4FB' } : dropBase

  const handleFiles = (files) => {
    if (!files || files.length === 0) return
    startBatchSession(files)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer && e.dataTransfer.files)
  }

  const onPickFile = (e) => {
    handleFiles(e.target.files)
    e.target.value = ''
  }

  const startReview = () => {
    if (batchDoneItems.length === 0) return
    closeUpload()
    navigate('/invoices/' + batchDoneItems[0].invoiceId)
  }

  const startNewBatch = () => {
    clearBatchSession()
  }

  const analyzingCount = batchQueue.filter((i) => i.status === 'analyzing').length
  const doneCount = batchDoneItems.length
  const errorCount = batchErrorItems.length
  const totalCount = batchQueue.length
  const processedCount = doneCount + errorCount

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(14,14,26,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'overlayIn 0.18s ease' }}
      onClick={closeUpload}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520, maxWidth: 'calc(100vw - 40px)', background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(14,14,26,0.25)', overflow: 'hidden', animation: 'cardPop 0.22s ease' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #F0F0EC' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#16161F' }}>
            {!batchMode ? 'Прикачи фактури' : batchAllDone ? 'Анализата е завршена' : 'Се анализираат фактури…'}
          </div>
          <button onClick={closeUpload} style={{ background: 'none', border: 'none', color: '#A0A0B2', padding: 4, display: 'flex' }} onMouseEnter={(e) => (e.currentTarget.style.color = '#16161F')} onMouseLeave={(e) => (e.currentTarget.style.color = '#A0A0B2')}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '22px 20px 24px' }}>

          {/* DROP ZONE — shown when no batch is running */}
          {!batchMode && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
                onDragLeave={(e) => { e.preventDefault(); setDragOver(false) }}
                onDrop={onDrop}
                style={dropZoneStyle}
              >
                <div style={{ width: 48, height: 48, borderRadius: 12, background: '#EEEEF8', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                  <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="#1A1A6E" strokeWidth="1.4">
                    <path d="M8 10.5V3.2M5 6l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2.6 10.4v2.2a1 1 0 001 1h8.8a1 1 0 001-1v-2.2" strokeLinecap="round" />
                  </svg>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#16161F', textAlign: 'center' }}>Повлечи и пушти фактури овде</div>
                <div style={{ fontSize: 12.5, color: '#8A8A9C', textAlign: 'center', marginTop: 4 }}>PDF, PNG или JPG · поддржани повеќе датотеки · обработено локално</div>
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                  <button onClick={() => fileInputRef.current && fileInputRef.current.click()} style={{ background: '#1A1A6E', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600 }} onMouseEnter={(e) => (e.currentTarget.style.background = '#13134f')} onMouseLeave={(e) => (e.currentTarget.style.background = '#1A1A6E')}>Прелистај датотеки</button>
                </div>
                <input ref={fileInputRef} type="file" accept=".pdf,image/png,image/jpeg,image/jpg,image/webp" onChange={onPickFile} multiple style={{ display: 'none' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center', marginTop: 14 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: TONE_COLOR[status.tone], flexShrink: 0, animation: status.tone === 'idle' ? 'pulseDot 1.1s infinite' : 'none' }} />
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.04em', color: status.tone === 'bad' ? '#8B1A1A' : '#8A8A9C', textAlign: 'center' }}>{status.text}</span>
              </div>
            </>
          )}

          {/* PROCESSING QUEUE — shown while analyzing */}
          {batchMode && !batchAllDone && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: 12.5, color: '#5A5A6E' }}>
                  {processedCount} / {totalCount} завршено
                  {analyzingCount > 0 && <span style={{ color: '#1A1A6E', fontWeight: 600 }}> · се анализира…</span>}
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F4F4FB', border: '1px solid #E6E6F4', borderRadius: 6, padding: '5px 10px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1A1A6E', animation: 'pulseDot 1s infinite' }} />
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: '#2E2E9E', letterSpacing: '0.04em' }}>НА УРЕДОТ · БЕЗ МРЕЖА</span>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ height: 5, background: '#F0F0EC', borderRadius: 3, marginBottom: 16, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${totalCount > 0 ? (processedCount / totalCount) * 100 : 0}%`, background: '#1A1A6E', borderRadius: 3, transition: 'width 0.3s ease' }} />
              </div>

              {/* Queue list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {batchQueue.map((item) => (
                  <div key={item.batchId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, background: item.status === 'analyzing' ? '#F4F4FB' : '#FAFAF8', border: `1px solid ${item.status === 'analyzing' ? '#E0E0F4' : '#F0F0EC'}` }}>
                    <div style={{ flexShrink: 0 }}>{STATUS_ICON[item.status]}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: '#16161F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.fileName}</div>
                      {item.status === 'error' && item.errorMsg && (
                        <div style={{ fontSize: 11, color: '#8B1A1A', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.errorMsg}</div>
                      )}
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: STATUS_COLOR[item.status], flexShrink: 0 }}>
                      {STATUS_LABEL[item.status] || item.status}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ALL DONE summary */}
          {batchMode && batchAllDone && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, padding: '14px 16px', background: doneCount > 0 ? '#E4F2EC' : '#FDF6F6', borderRadius: 10, border: `1px solid ${doneCount > 0 ? '#BEE0CE' : '#F3DADA'}` }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: doneCount > 0 ? '#0D5C44' : '#8B1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {doneCount > 0 ? (
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.8"><path d="M3.5 8.2l3 3 6-6.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.8"><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#16161F' }}>
                    {doneCount} од {totalCount} {totalCount !== 1 ? 'фактури' : 'фактура'} подготвени
                  </div>
                  <div style={{ fontSize: 12, color: '#8A8A9C', marginTop: 1 }}>
                    {doneCount > 0 && `${doneCount} извлечени`}
                    {doneCount > 0 && errorCount > 0 && ' · '}
                    {errorCount > 0 && <span style={{ color: '#8B1A1A' }}>{errorCount} неуспешни</span>}
                  </div>
                </div>
              </div>

              {/* Compact queue list for reference */}
              {batchQueue.length <= 8 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 18 }}>
                  {batchQueue.map((item) => (
                    <div key={item.batchId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 7, background: '#FAFAF8' }}>
                      <div style={{ flexShrink: 0 }}>{STATUS_ICON[item.status]}</div>
                      <div style={{ fontSize: 12, color: '#5A5A6E', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.fileName}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={startNewBatch} style={{ flex: 1, background: '#fff', color: '#3A3A52', border: '1px solid #E2E2DC', borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600 }} onMouseEnter={(e) => (e.currentTarget.style.background = '#F7F7F5')} onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>Нова серија</button>
                {doneCount > 0 && (
                  <button onClick={startReview} style={{ flex: 2, background: '#1A1A6E', color: '#fff', border: 'none', borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600 }} onMouseEnter={(e) => (e.currentTarget.style.background = '#13134f')} onMouseLeave={(e) => (e.currentTarget.style.background = '#1A1A6E')}>
                    Започни преглед ({doneCount}) →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
