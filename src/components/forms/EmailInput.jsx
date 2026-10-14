import { useState } from 'react'
import FormField from './FormField'
import { INPUT_CLASS, inputBorder } from './inputStyles'
import { formText } from '../../i18n/formText'
import { emailProblem, emailSuggestion, normalizeEmail } from '../../utils/validators'

// Email: checked when leaving the field (and by the form on submit), trimmed
// and lower-cased. A common slip in the domain ("gmial.com") gets a gentle
// "Did you mean ...?" with a button; it never blocks.
export default function EmailInput({
  label, value, onChange, onBlur, language = 'en', required = false, error, disabled = false,
  name = 'email', id, hint, autoComplete = 'email', validate = true, placeholder,
}) {
  const [touched, setTouched] = useState(false)
  const problem = validate ? emailProblem(value, { required }) : null
  const message = error || (touched && problem ? formText(language, problem) : '')
  const suggestion = touched && !problem ? emailSuggestion(value) : null

  return (
    <FormField label={label} required={required} hint={hint} error={message} id={id}>
      {({ id: inputId, describedBy, invalid }) => (
        <>
          <input
            id={inputId} name={name} type="email" inputMode="email" autoComplete={autoComplete} disabled={disabled}
            value={value ?? ''} placeholder={placeholder} spellCheck={false} autoCapitalize="none"
            onChange={(event) => onChange?.(event.target.value)}
            onBlur={(event) => {
              setTouched(true)
              const clean = normalizeEmail(event.target.value)
              if (clean !== value) onChange?.(clean)
              onBlur?.(event)
            }}
            aria-invalid={invalid || undefined} aria-required={required || undefined} aria-describedby={describedBy}
            className={`${INPUT_CLASS} ${inputBorder(invalid)}`}
          />
          {suggestion && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-amber-200">
              <span>{formText(language, 'email_suggest', { email: suggestion })}</span>
              <button type="button" onClick={() => onChange?.(suggestion)} className="min-h-[36px] rounded-lg border border-amber-300/40 px-3 text-amber-100 transition hover:bg-amber-300/10">
                {formText(language, 'email_suggest_accept')}
              </button>
            </p>
          )}
        </>
      )}
    </FormField>
  )
}
