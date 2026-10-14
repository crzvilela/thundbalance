import { useState } from 'react'
import FormField from './FormField'
import { INPUT_CLASS, inputBorder } from './inputStyles'
import { formText } from '../../i18n/formText'
import { postalCodeProblem } from '../../utils/validators'

// Postal code. Spain (the default): 5 digits, 01000 to 52999, number keyboard.
// Other countries: their usual format, or 3 to 10 letters and digits.
export default function PostalCodeInput({
  label, value, onChange, onBlur, country = 'ES', language = 'en', required = false, error,
  disabled = false, id, name = 'postal_code', validate = true,
}) {
  const [touched, setTouched] = useState(false)
  const spain = String(country || 'ES').toUpperCase() === 'ES'
  const problem = validate ? postalCodeProblem(value, country, { required }) : null
  const message = error || (touched && problem ? formText(language, problem) : '')

  return (
    <FormField label={label} required={required} error={message} id={id}>
      {({ id: inputId, describedBy, invalid }) => (
        <input
          id={inputId} name={name} type="text" autoComplete="postal-code" disabled={disabled}
          inputMode={spain ? 'numeric' : 'text'} maxLength={spain ? 5 : 10}
          value={value ?? ''}
          onChange={(event) => onChange?.(spain ? event.target.value.replace(/\D/g, '') : event.target.value.toUpperCase())}
          onBlur={(event) => { setTouched(true); onBlur?.(event) }}
          aria-invalid={invalid || undefined} aria-required={required || undefined} aria-describedby={describedBy}
          className={`${INPUT_CLASS} ${inputBorder(invalid)}`}
        />
      )}
    </FormField>
  )
}
