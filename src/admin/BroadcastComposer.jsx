import { useEffect, useMemo, useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useAdminResource } from './useAdminResource'
import { useToast } from './toastContext'
import MessageCard from '../components/inbox/MessageCard'
import SectionCard from '../components/admin/SectionCard'
import { translations } from '../i18n/translations'
import { madridWallClock, wallClock } from './calendar/calendarConfig'
import {
  BODY_MAX, LABEL_MAX, LANGS, MAX_AHEAD_DAYS, TARGETS, TITLE_MAX,
  addDays, emptyDraft, previewItem, serverErrorKey, toPayload, validateDraft
} from './broadcast'
import { Button, ConfirmDialog, Field, Icon, SelectInput, TextArea, TextInput } from './ui'

const fill = (text, values) => Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), text)
const LANGUAGE_NAMES = { en: 'English', es: 'Español', ca: 'Català' }
const PUBLIC_LOCALES = { en: 'en-GB', es: 'es-ES', ca: 'ca-ES' }
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'

// "2026-10-18T12:00" for the Madrid wall clock right now
const nowWall = () => madridWallClock().toISOString().slice(0, 16)

function newKey() {
  try { return crypto.randomUUID() } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}` }
}

// The problem of a field: icon + text next to the field (never only a colour).
function FieldError({ id, text }) {
  if (!text) return null
  return (
    <p id={id} role="alert" className="-mt-3 mb-4 flex items-start gap-1.5 text-sm text-red-300">
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" /><span>{text}</span>
    </p>
  )
}

function Counter({ value, max }) {
  return <span className={`mt-1 block text-right text-xs tabular-nums ${value > max ? 'text-red-300' : 'text-gray-500'}`} aria-live="off">{value}/{max}</span>
}

// A group of two or three choices drawn as buttons.
function Segmented({ label, value, options, onChange, disabled }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-xl border border-white/15 p-1">
      {options.map(([key, text]) => (
        <button key={key} type="button" aria-pressed={value === key} disabled={disabled} onClick={() => onChange(key)}
          className={`min-h-[44px] rounded-lg px-4 text-sm font-semibold transition ${FOCUS} ${value === key ? 'bg-emerald-400 text-black' : 'text-gray-300 hover:text-white'}`}>
          {text}
        </button>
      ))}
    </div>
  )
}

function Switch({ checked, onChange, children, disabled }) {
  return (
    <label className="mb-4 flex min-h-[44px] cursor-pointer items-center gap-3 text-base text-white">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="h-5 w-5 accent-emerald-400" />
      {children}
    </label>
  )
}

// "Una persona": a search by email among the clients that are not archived (the list of the panel), with suggestions.
function PersonPicker({ person, onPick, problem, onBlur, disabled }) {
  const { t } = useAdminText()
  const clients = useAdminResource('/admin/clients')              // archived clients are not in this list
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const matches = useMemo(() => {
    const list = Array.isArray(clients.data) ? clients.data : []
    if (!needle) return []
    return list.filter(client => String(client.email || '').toLowerCase().includes(needle) || String(client.name || '').toLowerCase().includes(needle)).slice(0, 6)
  }, [clients.data, needle])

  if (person) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] p-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-gray-400">{t('bx_person_chosen')}</p>
          <p className="truncate text-base font-semibold text-white">{person.name || person.email}</p>
          <p className="truncate text-sm text-gray-300">{person.email}</p>
        </div>
        <Button variant="secondary" onClick={() => { onPick(null); setQuery('') }} disabled={disabled}>{t('bx_person_change')}</Button>
      </div>
    )
  }

  return (
    <div className="mt-4">
      <Field label={t('bx_person_search')}>
        <TextInput
          type="search" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} onBlur={onBlur}
          placeholder="ana@example.com" aria-invalid={!!problem} aria-describedby={problem ? 'bx-person-error' : undefined} disabled={disabled}
        />
      </Field>
      <FieldError id="bx-person-error" text={problem ? t(problem) : ''} />
      {clients.loading && !clients.data && needle && <p role="status" className="-mt-3 mb-4 text-sm text-gray-400">{t('bx_count_loading')}</p>}
      {needle && matches.length > 0 && (
        <ul aria-label={t('bx_person_search')} className="-mt-3 mb-4 divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-black/40">
          {matches.map(client => (
            <li key={client.id}>
              <button type="button" onClick={() => onPick({ id: client.id, name: client.name, email: client.email })}
                className={`flex min-h-[48px] w-full flex-col items-start px-4 py-2 text-left transition hover:bg-white/10 ${FOCUS}`}>
                <span className="text-sm font-semibold text-white">{client.name}</span>
                <span className="text-sm text-gray-400 [overflow-wrap:anywhere]">{client.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {needle && !clients.loading && matches.length === 0 && <p className="-mt-3 mb-4 text-sm text-gray-400">{t('bx_person_none')}</p>}
    </div>
  )
}

// The message to write, how it will look, and the button that sends it. The draft lives in the page (so it survives
// a visit to the history); `onSent` is told when the server accepted it.
export default function BroadcastComposer({ draft, setDraft, onSent }) {
  const { t, language } = useAdminText()
  const toast = useToast()
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const [touched, setTouched] = useState({})
  const [key, setKey] = useState(newKey)                        // one key per message: a double click can never send twice
  const [asking, setAsking] = useState(false)
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState('')
  const [previewLang, setPreviewLang] = useState(draft.mainLang)
  const [previewNow] = useState(() => new Date())
  const [counter, setCounter] = useState({ key: '', data: null, failed: false })

  const patch = (values) => setDraft(current => ({ ...current, ...values }))
  const patchTranslation = (code, values) => setDraft(current => ({ ...current, translations: { ...current.translations, [code]: { ...current.translations[code], ...values } } }))
  const touch = (name) => setTouched(current => (current[name] ? current : { ...current, [name]: true }))
  const clock = nowWall()
  const problems = validateDraft(draft, clock)
  const shown = (name) => (touched[name] && problems[name] ? t(problems[name]) : '')

  // ---- how many will receive it (the server counts; a short pause while typing)
  const countKey = draft.audience === 'user' ? (draft.person ? `user|${draft.person.email}` : '') : draft.audience
  useEffect(() => {
    if (!countKey) return undefined
    let active = true
    const timer = window.setTimeout(() => {
      adminRequest('POST', '/admin/messages/preview', { audience: draft.audience, ...(draft.audience === 'user' ? { email: draft.person.email } : {}) })
        .then(data => { if (active) setCounter({ key: countKey, data, failed: false }) },
          () => { if (active) setCounter({ key: countKey, data: null, failed: true }) })
    }, 350)
    return () => { active = false; window.clearTimeout(timer) }
  }, [countKey, draft.audience, draft.person])

  const counting = !!countKey && counter.key !== countKey
  const data = counter.key === countKey ? counter.data : null
  const recipients = data ? data.count : 0
  let countText = ''
  if (draft.audience === 'user' && !draft.person) countText = t('bx_count_pick')
  else if (counting) countText = t('bx_count_loading')
  else if (counter.failed && counter.key === countKey) countText = t('bx_count_error')
  else if (data && draft.audience === 'user' && data.found === false) countText = t('bx_count_not_found')
  else if (data && data.archived) countText = t('bx_count_archived')
  else if (data) countText = recipients === 0 ? t('bx_count_zero') : recipients === 1 ? t('bx_count_one') : fill(t('bx_count_n'), { n: recipients })

  const canSend = Object.keys(problems).length === 0 && !counting && recipients > 0 && !sending

  // ---- dates
  const dateText = (wall) => `${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(wallClock(wall))}`
  const summary = draft.when === 'later' && draft.sendAt && !problems.sendAt
    ? fill(fill(t('bx_summary_at'), { date: dateText(draft.sendAt) }), { time: draft.sendAt.slice(11, 16) }) : ''

  const send = async () => {
    if (sending) return
    setSending(true)
    setFailure('')
    try {
      const answer = await adminRequest('POST', '/admin/messages', toPayload(draft, key))
      setAsking(false)
      toast.push(answer.repeated ? t('bx_repeated')
        : fill(t(draft.when === 'later' ? 'bx_scheduled_ok' : (answer.recipients === 1 ? 'bx_sent_ok_one' : 'bx_sent_ok')), { n: answer.recipients }))
      setDraft(emptyDraft(draft.mainLang))
      setTouched({})
      setKey(newKey())                                            // the next message gets its own key
      onSent(answer.id)
    } catch (error) {
      setAsking(false)
      setFailure(serverErrorKey(error.code))                      // what was written stays
    } finally {
      setSending(false)
    }
  }

  const otherLangs = LANGS.filter(code => code !== draft.mainLang)
  const preview = previewItem(draft, previewLang, clock)
  const hasPreview = draft.title.trim() || draft.body.trim()
  const previewT = useMemo(() => {
    const dictionary = translations[previewLang] || translations.en
    return (text, vars) => {
      const value = dictionary[text] ?? translations.en[text] ?? text
      return vars ? value.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match)) : value
    }
  }, [previewLang])
  const confirmText = draft.audience === 'user'
    ? fill(t('bx_confirm_user'), { email: draft.person?.email || '' })
    : recipients === 1 ? t('bx_confirm_one') : fill(t('bx_confirm_n'), { n: recipients })

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div>
        <SectionCard title={t('bx_to')} className="mb-5">
          <fieldset>
            <legend className="sr-only">{t('bx_to')}</legend>
            <div className="space-y-3">
              {[['all', 'bx_aud_all', 'bx_aud_all_help'], ['active_pack', 'bx_aud_pack', 'bx_aud_pack_help'], ['user', 'bx_aud_user', 'bx_aud_user_help']].map(([value, label, help]) => (
                <label key={value} className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${draft.audience === value ? 'border-emerald-400/50 bg-emerald-400/[0.06]' : 'border-white/10 hover:border-white/25'}`}>
                  <input type="radio" name="bx-audience" value={value} checked={draft.audience === value} onChange={() => patch({ audience: value, person: null })} className="mt-1 h-5 w-5 shrink-0 accent-emerald-400" />
                  <span><span className="block text-base font-semibold text-white">{t(label)}</span><span className="block text-sm text-gray-400">{t(help)}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          {draft.audience === 'user' && (
            <PersonPicker person={draft.person} onPick={person => patch({ person })} problem={touched.person ? problems.person : ''} onBlur={() => touch('person')} />
          )}
          <p role="status" aria-live="polite" className={`mt-4 flex items-center gap-2 text-sm font-medium ${data && recipients > 0 ? 'text-emerald-300' : 'text-gray-300'}`}>
            <Icon name={data && recipients > 0 ? 'check' : 'clients'} className="h-4 w-4" />{countText}
          </p>
        </SectionCard>

        <SectionCard title={t('bx_lang')} className="mb-5">
          <Segmented
            label={t('bx_lang')} value={draft.mainLang}
            options={LANGS.map(code => [code, `${code.toUpperCase()} · ${LANGUAGE_NAMES[code]}`])}
            onChange={code => { patch({ mainLang: code }); setPreviewLang(code) }}
          />
          <div className="mt-5">
            <Field label={t('bx_field_title')}>
              <TextInput value={draft.title} onChange={event => patch({ title: event.target.value })} onBlur={() => touch('title')} maxLength={TITLE_MAX + 40}
                aria-invalid={!!shown('title')} aria-describedby={shown('title') ? 'bx-title-error' : undefined} />
              <Counter value={draft.title.length} max={TITLE_MAX} />
            </Field>
            <FieldError id="bx-title-error" text={shown('title')} />
            <Field label={t('bx_field_body')} hint={t('bx_body_hint')}>
              <TextArea rows={7} value={draft.body} onChange={event => patch({ body: event.target.value })} onBlur={() => touch('body')} maxLength={BODY_MAX + 200}
                aria-invalid={!!shown('body')} aria-describedby={shown('body') ? 'bx-body-error' : undefined} />
              <Counter value={draft.body.length} max={BODY_MAX} />
            </Field>
            <FieldError id="bx-body-error" text={shown('body')} />
          </div>

          <button type="button" onClick={() => patch({ showTranslations: !draft.showTranslations })} aria-expanded={draft.showTranslations}
            className={`min-h-[44px] rounded-lg text-sm font-semibold text-emerald-300 underline-offset-4 hover:underline ${FOCUS}`}>
            {draft.showTranslations ? t('bx_hide_translation') : t('bx_add_translation')}
          </button>
          <p className="mt-1 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100">{t('bx_translation_note')}</p>
          {draft.showTranslations && otherLangs.map(code => (
            <fieldset key={code} className="mt-5 rounded-2xl border border-white/10 p-4">
              <legend className="px-2 text-sm font-semibold uppercase tracking-wider text-gray-300">{fill(t('bx_translation_of'), { lang: `${code.toUpperCase()} · ${LANGUAGE_NAMES[code]}` })} <span className="font-normal normal-case text-gray-500">{t('bx_optional')}</span></legend>
              <Field label={t('bx_field_title')}>
                <TextInput value={draft.translations[code].title} onChange={event => patchTranslation(code, { title: event.target.value })} />
                <Counter value={draft.translations[code].title.length} max={TITLE_MAX} />
              </Field>
              <Field label={t('bx_field_body')}>
                <TextArea rows={4} value={draft.translations[code].body} onChange={event => patchTranslation(code, { body: event.target.value })} />
                <Counter value={draft.translations[code].body.length} max={BODY_MAX} />
              </Field>
              {draft.button && (
                <Field label={t('bx_button_label')}>
                  <TextInput value={draft.translations[code].label || ''} onChange={event => patchTranslation(code, { label: event.target.value })} />
                  <Counter value={(draft.translations[code].label || '').length} max={LABEL_MAX} />
                </Field>
              )}
              <FieldError id={`bx-t-${code}`} text={problems[`t_${code}`] ? t(problems[`t_${code}`]) : ''} />
            </fieldset>
          ))}
        </SectionCard>

        <SectionCard title={t('bx_button_title')} className="mb-5">
          <Switch checked={draft.button} onChange={value => patch({ button: value })}>{t('bx_button_switch')}</Switch>
          {draft.button && (
            <>
              <Field label={t('bx_button_label')}>
                <TextInput value={draft.label} onChange={event => patch({ label: event.target.value })} onBlur={() => touch('label')} maxLength={LABEL_MAX + 20}
                  aria-invalid={!!shown('label')} aria-describedby={shown('label') ? 'bx-label-error' : undefined} />
                <Counter value={draft.label.length} max={LABEL_MAX} />
              </Field>
              <FieldError id="bx-label-error" text={shown('label')} />
              <Field label={t('bx_button_dest')}>
                <SelectInput value={draft.target} onChange={event => patch({ target: event.target.value })}>
                  {TARGETS.map(target => <option key={target.value} value={target.value}>{t(target.key)}</option>)}
                </SelectInput>
              </Field>
              {draft.target === 'external' && (
                <>
                  <Field label={t('bx_button_url')}>
                    <TextInput type="url" inputMode="url" value={draft.url} placeholder="https://" onChange={event => patch({ url: event.target.value })} onBlur={() => touch('url')}
                      aria-invalid={!!shown('url')} aria-describedby={shown('url') ? 'bx-url-error' : undefined} />
                  </Field>
                  <FieldError id="bx-url-error" text={shown('url')} />
                </>
              )}
              <p className="text-sm text-gray-500">{t('bx_button_note')}</p>
            </>
          )}
        </SectionCard>

        <SectionCard title={t('bx_when')} className="mb-5">
          <Segmented label={t('bx_when')} value={draft.when} options={[['now', t('bx_when_now')], ['later', t('bx_when_later')]]} onChange={value => patch({ when: value })} />
          {draft.when === 'later' && (
            <div className="mt-5">
              <Field label={t('bx_send_at')}>
                <TextInput type="datetime-local" value={draft.sendAt} min={clock} max={addDays(clock, MAX_AHEAD_DAYS)} onChange={event => patch({ sendAt: event.target.value })} onBlur={() => touch('sendAt')}
                  aria-invalid={!!shown('sendAt')} aria-describedby={shown('sendAt') ? 'bx-send-error' : undefined} />
              </Field>
              <FieldError id="bx-send-error" text={shown('sendAt')} />
              {summary && <p role="status" className="-mt-2 mb-2 flex items-center gap-2 text-sm font-medium text-emerald-300"><Icon name="calendar" className="h-4 w-4" />{summary}</p>}
            </div>
          )}
          <div className="mt-5 border-t border-white/10 pt-5">
            <Switch checked={draft.expires} onChange={value => patch({ expires: value })}>{t('bx_expires_switch')}</Switch>
            {draft.expires && (
              <>
                <Field label={t('bx_expires_at')} hint={t('bx_expires_help')}>
                  <TextInput type="datetime-local" value={draft.expiresAt} min={draft.when === 'later' && draft.sendAt ? draft.sendAt : clock} onChange={event => patch({ expiresAt: event.target.value })} onBlur={() => touch('expiresAt')}
                    aria-invalid={!!shown('expiresAt')} aria-describedby={shown('expiresAt') ? 'bx-expiry-error' : undefined} />
                </Field>
                <FieldError id="bx-expiry-error" text={shown('expiresAt')} />
              </>
            )}
          </div>
        </SectionCard>

        {failure && (
          <p role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" /><span>{t(failure)}</span>
          </p>
        )}
        <Button variant="primary" className="w-full !py-3.5 text-base sm:w-auto sm:!px-10" disabled={!canSend} loading={sending} onClick={() => setAsking(true)}>
          <Icon name="send" className="h-4 w-4" />{sending ? t('bx_sending') : t(draft.when === 'later' ? 'bx_schedule' : 'bx_send')}
        </Button>
      </div>

      <aside aria-label={t('bx_preview')} className="xl:sticky xl:top-6 xl:self-start">
        <SectionCard title={t('bx_preview')}>
          <p className="mb-4 text-sm text-gray-400">{t('bx_preview_help')}</p>
          <div className="mb-4">
            <Segmented label={t('bx_preview_lang')} value={previewLang} options={LANGS.map(code => [code, code.toUpperCase()])} onChange={setPreviewLang} />
          </div>
          {hasPreview ? (
            <div inert>
              <MessageCard
                item={preview} now={previewNow} expanded={false} busy={false} translate={previewT} localeOverride={PUBLIC_LOCALES[previewLang]}
                onToggle={() => {}} onRead={() => {}} onAction={() => {}} onDelete={() => {}}
              />
            </div>
          ) : <p className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-gray-400">{t('bx_preview_empty')}</p>}
        </SectionCard>
      </aside>

      <ConfirmDialog
        open={asking} busy={sending} tone="neutral" icon="send"
        title={t('bx_confirm_title')}
        text={`${confirmText}${summary ? ` ${summary}.` : ''}`}
        confirmLabel={t(draft.when === 'later' ? 'bx_confirm_yes_later' : 'bx_confirm_yes')} cancelLabel={t('cancel')}
        onConfirm={send} onCancel={() => setAsking(false)}
      />
    </div>
  )
}
