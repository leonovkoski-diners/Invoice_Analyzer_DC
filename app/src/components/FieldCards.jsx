// Renders extracted fields as a responsive card grid.
// Pass editable: true + onChange to make a card's value inline-editable.
// Pass labelEditable: true + onLabelChange for custom fields whose key is also editable.
// Pass onRemove to show a × remove button on a card.
// Pass onAddField to render a "+" card that adds a new custom field.
export default function FieldCards({ fields, onAddField }) {
  const borderLeft = (f) => f.flagged ? '3px solid #7A4100' : '3px solid #1A1A6E'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
      {fields.map((f, idx) => (
        <div
          key={idx}
          style={{
            background: '#fff',
            border: '1px solid #E8E8E2',
            borderLeft: borderLeft(f),
            borderRadius: 10,
            padding: '12px 14px',
            minHeight: 70,
            position: 'relative',
          }}
        >
          {/* Remove button */}
          {f.onRemove && (
            <button
              onClick={f.onRemove}
              title="Remove field"
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                color: '#C4C4D0',
                cursor: 'pointer',
                padding: 0,
                borderRadius: 3,
                lineHeight: 1,
                fontSize: 13,
                fontWeight: 400,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#8B1A1A'; e.currentTarget.style.background = '#FDEBEB' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#C4C4D0'; e.currentTarget.style.background = 'none' }}
            >
              ×
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: f.onRemove ? 16 : 0 }}>
            {f.labelEditable ? (
              <input
                type="text"
                value={f.label}
                onChange={(e) => f.onLabelChange && f.onLabelChange(e.target.value)}
                placeholder="Field name"
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: '#6A6A9C',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px dashed #C8C8E0',
                  outline: 'none',
                  padding: '1px 0',
                  width: '100%',
                }}
              />
            ) : (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9A9AAC' }}>{f.label}</div>
            )}
            {f.editable && !f.labelEditable && (
              <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="#C4C4D0" strokeWidth="1.8" style={{ flexShrink: 0 }}>
                <path d="M11 2.5l2.5 2.5L4.5 13.5H2v-2.5L11 2.5z" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          {f.editable ? (
            <input
              type={f.inputType || 'text'}
              value={f.value == null ? '' : String(f.value)}
              onChange={(e) => f.onChange && f.onChange(e.target.value)}
              placeholder={f.labelEditable ? 'Value…' : undefined}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 6,
                fontSize: 13.5,
                fontWeight: 600,
                color: f.flagged ? '#7A4100' : '#16161F',
                fontFamily: 'inherit',
                background: 'none',
                border: 'none',
                borderBottom: '1px dashed #C8C8E0',
                outline: 'none',
                padding: '1px 0 2px',
                lineHeight: 1.4,
                boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.currentTarget.style.borderBottomColor = '#1A1A6E')}
              onBlur={(e) => (e.currentTarget.style.borderBottomColor = '#C8C8E0')}
            />
          ) : (
            <div style={{ fontSize: 13.5, fontWeight: 600, color: f.flagged ? '#7A4100' : '#16161F', marginTop: 6, lineHeight: 1.4, wordBreak: 'break-word' }}>
              {f.value == null || f.value === '' ? '—' : String(f.value)}
            </div>
          )}
        </div>
      ))}

      {/* Add custom field button */}
      {onAddField && (
        <button
          onClick={onAddField}
          title="Add custom field"
          style={{
            background: '#F7F7FB',
            border: '1.5px dashed #C8C8E0',
            borderRadius: 10,
            minHeight: 70,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            cursor: 'pointer',
            color: '#9A9AAC',
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#1A1A6E'; e.currentTarget.style.color = '#1A1A6E' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#C8C8E0'; e.currentTarget.style.color = '#9A9AAC' }}
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Add field</span>
        </button>
      )}
    </div>
  )
}
