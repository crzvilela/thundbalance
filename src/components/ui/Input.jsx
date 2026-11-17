import { INPUT_CLASS, inputBorder } from '../forms/inputStyles'

// A text field with the look of every field of the site (inputStyles.js). Put it inside <FormField> (label, error, help) and spread the
// props it gives: <FormField label="Email">{({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} />}</FormField>
export default function Input({ invalid = false, className = '', ...props }) {
  return <input {...props} aria-invalid={invalid || props['aria-invalid'] || undefined} className={`${INPUT_CLASS} ${inputBorder(invalid)} ${className}`.trim()} />
}
