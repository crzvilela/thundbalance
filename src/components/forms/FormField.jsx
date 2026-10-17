import { useId } from 'react'

function ErrorIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" />
    </svg>
  )
}

// Label (with asterisk when required), the control, a help line, and the
// error under it: icon + text, never only colour. The error line keeps its
// height whether or not a message is there, so the layout never jumps.
//   children(props) receives { id, describedBy, invalid } for the control.
export default function FormField({ label, required = false, hint, error, suffix, children, className = '', id }) {
  const generated = useId()
  const fieldId = id || `field-${generated}`
  const errorId = `${fieldId}-error`
  const hintId = `${fieldId}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className={`block min-w-0 ${className}`}>
      {label && (
        <label htmlFor={fieldId} className="mb-2 flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wider text-gray-400">
          <span>
            {label}
            {required && <span className="ml-1 text-red-300" aria-hidden="true">*</span>}
          </span>
          {suffix && <span className="normal-case tracking-normal text-gray-500">{suffix}</span>}
        </label>
      )}
      {children({ id: fieldId, describedBy, invalid: Boolean(error), required })}
      {hint && <p id={hintId} className="mt-1.5 text-xs text-gray-500">{hint}</p>}
      <p id={errorId} role={error ? 'alert' : undefined} className="mt-1.5 flex min-h-[1.25rem] items-start gap-1.5 text-sm text-red-300">
        {error && (<><ErrorIcon /><span>{error}</span></>)}
      </p>
    </div>
  )
}
