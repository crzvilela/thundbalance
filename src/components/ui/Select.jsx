import { INPUT_CLASS, inputBorder } from '../forms/inputStyles'

// A native <select> with the corners, border, height and focus of the other fields, and a chevron of our own (the browser's is square and
// differs from system to system). It still opens the system's list: on a phone that is the best picker there is.
const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`

export default function Select({ invalid = false, className = '', children, ...props }) {
  return (
    <select
      {...props}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      style={{ backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1.25rem', ...props.style }}
      className={`${INPUT_CLASS} ${inputBorder(invalid)} appearance-none pr-12 ${className}`.trim()}
    >
      {children}
    </select>
  )
}
