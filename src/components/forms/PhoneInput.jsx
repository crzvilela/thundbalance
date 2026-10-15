import { useEffect, useMemo, useRef, useState } from 'react'
import { AsYouType, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/min'
import FormField from './FormField'
import { DEFAULT_COUNTRY, countryForCode, countryLists, flagUrl } from './countries'
import { formText } from '../../i18n/formText'
import { phoneProblem, toE164 } from '../../utils/validators'

const digitsOf = (text) => String(text ?? '').replace(/\D/g, '')

// What a value means: { country, digits, legacy }. E.164 values are split into
// country + national digits; an old value with no international prefix keeps
// its text as it is (shown untouched) and the country of `fallbackCode` (+34).
function readValue(value, fallbackCode) {
  const text = String(value ?? '').trim()
  if (!text) return { country: countryForCode(fallbackCode) || DEFAULT_COUNTRY, digits: '', legacy: false }
  if (text.startsWith('+') || text.startsWith('00')) {
    const number = parsePhoneNumberFromString(toE164(text))
    if (number) return { country: number.country || countryForCode(number.countryCallingCode), digits: String(number.nationalNumber), legacy: false }
    const code = digitsOf(text).slice(0, 3)
    return { country: countryForCode(code), digits: digitsOf(text).slice(code.length), legacy: false }
  }
  return { country: countryForCode(fallbackCode) || DEFAULT_COUNTRY, digits: text, legacy: true }
}

function Flag({ iso }) {
  const url = flagUrl(iso)
  return url
    ? <img src={url} alt="" width="20" height="14" loading="lazy" className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover" />
    : <span className="w-5 text-[10px] text-gray-400">{iso}</span>
}

// Phone with the country picker inside the same box. Spain (+34) by default.
// onChange receives E.164 ("+34613502662"), or '' when empty. Paste works in
// any usual format ("+34 613 50 26 62", "0034613502662", "(613) 50-26-62").
export default function PhoneInput({
  label, value, onChange, onBlur, language = 'en', required = false, error, fallbackCode,
  disabled = false, name = 'phone', id, hint, validate = true,
}) {
  const [state, setState] = useState(() => readValue(value, fallbackCode))
  const [emitted, setEmitted] = useState(value)
  const [touched, setTouched] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const boxRef = useRef(null)
  const buttonRef = useRef(null)
  const listRef = useRef(null)

  // A value set from outside (a profile that finished loading) replaces what is shown.
  if (value !== emitted) {
    setEmitted(value)
    setState(readValue(value, fallbackCode))
  }

  const { country, digits, legacy } = state
  const code = `+${getCountryCallingCode(country)}`
  // Formatted the international way, without the prefix the selector already shows:
  // "613 50 26 62", "6 12 34 56 78" (no national trunk 0 is added).
  const formatted = digits ? new AsYouType().input(`${code}${digits}`) : ''
  const shown = legacy ? digits : (formatted.startsWith(code) ? formatted.slice(code.length).trim() : digits)
  const current = legacy ? digits : (digits ? `${code}${digits}` : '')
  const problem = validate ? phoneProblem(current, { required, fallbackCode: legacy ? (fallbackCode || '+34') : code }) : null
  const message = error || (touched && problem ? formText(language, problem) : '')

  const emit = (next) => {
    setState(next)
    const e164 = next.digits ? `+${getCountryCallingCode(next.country)}${next.digits}` : ''
    setEmitted(e164)
    onChange?.(e164)
  }

  const handleInput = (event) => {
    const text = event.target.value
    // A full international number (typed or pasted) brings its own country.
    if (/^(\+|00)/.test(text.replace(/[\s().-]/g, ''))) {
      const number = parsePhoneNumberFromString(toE164(text))
      if (number) {
        emit({ country: number.country || countryForCode(number.countryCallingCode), digits: String(number.nationalNumber), legacy: false })
        return
      }
    }
    emit({ country, digits: digitsOf(text).slice(0, 15), legacy: false })
  }

  const choose = (iso) => {
    emit({ country: iso, digits: legacy ? digitsOf(digits) : digits, legacy: false })
    setOpen(false)
    setQuery('')
    buttonRef.current?.focus()
  }

  const lists = countryLists(language)
  const items = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^\+/, '')
    if (!needle) return [...lists.main, null, ...lists.rest]     // null = separator
    const match = (item) => item.name.toLowerCase().includes(needle) || item.iso.toLowerCase() === needle || item.code.slice(1).startsWith(needle)
    return [...lists.main, ...lists.rest].filter(match)
  }, [lists, query])
  const selectable = items.filter(Boolean)
  // each row with its position among the selectable countries (separators have none)
  const rows = useMemo(() => {
    let next = -1
    return items.map((item) => (item ? { item, index: (next += 1) } : { item: null, index: -1 }))
  }, [items])

  // Close on a click outside.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => { if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  // Keep the highlighted country visible while moving with the arrows.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const openList = () => {
    setActive(Math.max(0, selectable.findIndex((item) => item.iso === country)))
    setOpen(true)
  }

  const onSearchKey = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(selectable.length - 1, i + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (event.key === 'Enter') { event.preventDefault(); if (selectable[active]) choose(selectable[active].iso) }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); buttonRef.current?.focus() }
  }

  return (
    <FormField label={label} required={required} hint={hint} error={message} id={id}>
      {({ id: inputId, describedBy, invalid }) => (
        <div ref={boxRef} className="relative">
          <div className={`flex items-stretch overflow-visible rounded-xl border bg-black/40 transition focus-within:ring-2 ${
            invalid ? 'border-red-400/70 focus-within:border-red-400 focus-within:ring-red-400/20' : 'border-white/15 focus-within:border-emerald-400/70 focus-within:ring-emerald-400/20'
          } ${disabled ? 'opacity-60' : ''}`}>
            <button
              ref={buttonRef} type="button" disabled={disabled}
              aria-haspopup="listbox" aria-expanded={open} aria-label={`${formText(language, 'phone_country')}: ${code}`}
              onClick={() => (open ? setOpen(false) : openList())}
              onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); openList() } }}
              className="flex shrink-0 items-center gap-2 rounded-l-xl border-r border-white/10 px-3 text-sm text-white outline-none hover:bg-white/5 focus-visible:bg-white/10"
            >
              <Flag iso={country} />
              <span className="tabular-nums">{code}</span>
              <svg viewBox="0 0 20 20" className="h-4 w-4 text-gray-400" fill="currentColor" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <input
              id={inputId} name={name} type="tel" inputMode="tel" autoComplete="tel-national" disabled={disabled}
              value={shown} onChange={handleInput}
              onBlur={(event) => { setTouched(true); onBlur?.(event) }}
              aria-invalid={invalid || undefined} aria-required={required || undefined} aria-describedby={describedBy}
              className="min-w-0 flex-1 rounded-r-xl bg-transparent px-4 py-3.5 text-base text-white outline-none placeholder:text-gray-500"
              placeholder={country === 'ES' ? '612 34 56 78' : ''}
            />
          </div>

          {open && (
            <>
              <div className="fixed inset-0 z-40 bg-black/50 sm:hidden" aria-hidden="true" />
              <div className="fixed inset-x-3 top-[12vh] z-50 flex max-h-[76vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d0f0e] shadow-2xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:max-h-80 sm:w-80">
                <div className="flex items-center gap-2 border-b border-white/10 p-2">
                  <input
                    autoFocus type="search" value={query} onChange={(event) => { setQuery(event.target.value); setActive(0) }}
                    onKeyDown={onSearchKey} placeholder={formText(language, 'phone_search')} aria-label={formText(language, 'phone_search')}
                    aria-controls={`${inputId}-countries`} aria-activedescendant={selectable[active] ? `${inputId}-c-${selectable[active].iso}` : undefined}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/70"
                  />
                  <button type="button" onClick={() => { setOpen(false); buttonRef.current?.focus() }} className="min-h-[40px] rounded-lg px-3 text-sm text-gray-300 hover:bg-white/10 sm:hidden">
                    {formText(language, 'phone_close')}
                  </button>
                </div>
                <ul ref={listRef} id={`${inputId}-countries`} role="listbox" aria-label={formText(language, 'phone_country')} className="flex-1 overflow-y-auto py-1">
                  {selectable.length === 0 && <li className="px-4 py-3 text-sm text-gray-500">{formText(language, 'phone_none')}</li>}
                  {rows.map(({ item, index: mine }, position) => {
                    if (!item) return <li key={`sep-${position}`} role="separator" className="my-1 border-t border-white/10" />
                    return (
                      <li
                        key={item.iso + position} id={`${inputId}-c-${item.iso}`} data-index={mine} role="option" aria-selected={item.iso === country}
                        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item.iso)} onMouseEnter={() => setActive(mine)}
                        className={`flex min-h-[44px] cursor-pointer items-center gap-3 px-4 text-sm ${mine === active ? 'bg-emerald-400/15 text-white' : 'text-gray-200'}`}
                      >
                        <Flag iso={item.iso} />
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        <span className="tabular-nums text-gray-400">{item.code}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </FormField>
  )
}
