import { useState } from 'react'
import FormField from './FormField'
import { INPUT_CLASS, inputBorder } from './inputStyles'
import { formText } from '../../i18n/formText'
import { DEFAULT_TAX_ID_TYPE, TAX_ID_TYPES, normalizeTaxId } from '../../utils/taxId'
import { documentProblem } from '../../utils/validators'

const HINT = { DNI: 'tax_id_dni_format', NIE: 'tax_id_nie_format', PASSPORT: 'tax_id_other_format', OTHER: 'tax_id_other_format' }

// Identity document: type (DNI by default, NIE, passport, other) + number in
// one row. Upper case while typing; checked only when leaving the field or on
// submit, never while the person is still writing.
export default function TaxIdInput({
  label, type, value, onTypeChange, onChange, onBlur, language = 'en', required = false, error,
  disabled = false, id, name = 'tax_id',
}) {
  const [touched, setTouched] = useState(false)
  const kind = TAX_ID_TYPES.includes(type) ? type : DEFAULT_TAX_ID_TYPE
  const problem = documentProblem(kind, value, { required })
  const message = error || (touched && problem ? formText(language, problem) : '')

  return (
    <FormField label={label} required={required} error={message} hint={formText(language, HINT[kind])} id={id}>
      {({ id: inputId, describedBy, invalid }) => (
        <div className="flex gap-2">
          <select
            aria-label={formText(language, 'tax_type_label')} value={kind} disabled={disabled}
            onChange={(event) => { onTypeChange?.(event.target.value); setTouched(Boolean(value)) }}
            className={`${INPUT_CLASS} ${inputBorder(false)} w-auto shrink-0 bg-black pr-8`}
          >
            {TAX_ID_TYPES.map((item) => <option key={item} value={item}>{formText(language, `tax_type_${item}`)}</option>)}
          </select>
          <input
            id={inputId} name={name} type="text" autoComplete="off" spellCheck={false} disabled={disabled}
            autoCapitalize="characters" maxLength={24}
            value={value ?? ''} onChange={(event) => onChange?.(event.target.value.toUpperCase())}
            onBlur={(event) => {
              setTouched(true)
              const clean = normalizeTaxId(event.target.value)
              if (clean !== value) onChange?.(clean)
              onBlur?.(event)
            }}
            aria-invalid={invalid || undefined} aria-required={required || undefined} aria-describedby={describedBy}
            className={`${INPUT_CLASS} ${inputBorder(invalid)} min-w-0 flex-1 uppercase`}
          />
        </div>
      )}
    </FormField>
  )
}
