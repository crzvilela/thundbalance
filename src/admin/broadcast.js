// Pure helpers of "Mensajes enviados" (the studio writes messages for the clients' inbox).
// Tested with: node --test src/admin/
// The limits and the allowed button destinations are the SERVER's (inbox.py); the server checks everything again.

export const TITLE_MAX = 120
export const BODY_MAX = 2000
export const LABEL_MAX = 40
export const LANGS = ['en', 'es', 'ca']
export const MAX_AHEAD_DAYS = 366

// The fixed destinations of a button (the server accepts exactly these paths) and the external link.
export const TARGETS = [
  { value: '/my-sessions', key: 'bx_dest_sessions' },
  { value: '/profile', key: 'bx_dest_profile' },
  { value: '/trial-session', key: 'bx_dest_trial' },
  { value: 'external', key: 'bx_dest_external' }
]

// The audiences the studio can combine. 'user' needs a person (chosen by email).
export const AUDIENCE_OPTIONS = ['all', 'active_pack', 'trainers', 'user']

export const emptyDraft = (mainLang = 'es') => ({
  audiences: ['all'], person: null,
  mainLang, title: '', body: '', translations: { en: { title: '', body: '', label: '' }, es: { title: '', body: '', label: '' }, ca: { title: '', body: '', label: '' } },
  showTranslations: false,
  button: false, label: '', target: '/my-sessions', url: '',
  when: 'now', sendAt: '', expires: false, expiresAt: ''
})

// Anything typed yet? (what the "you have an unsent message" warning looks at)
export function isDirty(draft) {
  return Boolean(
    draft.title.trim() || draft.body.trim() || draft.person || draft.label.trim() || draft.url.trim() ||
    LANGS.some(code => draft.translations[code].title.trim() || draft.translations[code].body.trim() || (draft.translations[code].label || '').trim())
  )
}

const HTML = /<\s*\/?\s*[a-zA-Z!]/
export const hasHtml = (text) => HTML.test(String(text || ''))

export function isHttpUrl(text) {
  const value = String(text || '').trim()
  if (!value || /\s/.test(value) || [...value].some(character => character.charCodeAt(0) < 32) || value.length > 500) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

// "2026-12-24T09:00" + days -> the same kind of text (Madrid wall clock, all as UTC arithmetic)
export function addDays(wall, days) {
  const [day, time] = wall.split('T')
  const [year, month, date] = day.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return new Date(Date.UTC(year, month - 1, date + days, hour, minute)).toISOString().slice(0, 16)
}

// Problems of a draft, by field: { title, body, person, label, url, sendAt, expiresAt, translations }
// Each value is a translation key (bx_v_*). `nowWall` is the Madrid wall clock as "YYYY-MM-DDTHH:MM".
export function validateDraft(draft, nowWall) {
  const problems = {}
  if (draft.audiences.length === 0) problems.audiences = 'bx_v_audiences'
  if (draft.audiences.includes('user') && !draft.person) problems.person = 'bx_v_person'
  if (!draft.title.trim()) problems.title = 'bx_v_title_required'
  else if (draft.title.length > TITLE_MAX) problems.title = 'bx_v_too_long'
  else if (hasHtml(draft.title)) problems.title = 'bx_v_html'
  if (!draft.body.trim()) problems.body = 'bx_v_body_required'
  else if (draft.body.length > BODY_MAX) problems.body = 'bx_v_too_long'
  else if (hasHtml(draft.body)) problems.body = 'bx_v_html'
  for (const code of LANGS) {
    if (code === draft.mainLang) continue
    const part = draft.translations[code]
    const label = draft.button ? (part.label || '') : ''          // the translated button text only counts when there is a button
    if (part.title.length > TITLE_MAX || part.body.length > BODY_MAX || label.length > LABEL_MAX) problems[`t_${code}`] = 'bx_v_too_long'
    else if (hasHtml(part.title) || hasHtml(part.body) || hasHtml(label)) problems[`t_${code}`] = 'bx_v_html'
  }
  if (draft.button) {
    if (!draft.label.trim()) problems.label = 'bx_v_label'
    else if (draft.label.length > LABEL_MAX) problems.label = 'bx_v_too_long'
    else if (hasHtml(draft.label)) problems.label = 'bx_v_html'
    if (draft.target === 'external' && !isHttpUrl(draft.url)) problems.url = 'bx_v_url'
  }
  if (draft.when === 'later') {
    if (!draft.sendAt) problems.sendAt = 'bx_v_send_at'
    else if (draft.sendAt <= nowWall) problems.sendAt = 'bx_v_past'
    else if (draft.sendAt > addDays(nowWall, MAX_AHEAD_DAYS)) problems.sendAt = 'bx_v_far'
  }
  if (draft.expires) {
    const start = draft.when === 'later' && draft.sendAt ? draft.sendAt : nowWall
    if (!draft.expiresAt) problems.expiresAt = 'bx_v_expiry_required'
    else if (draft.expiresAt <= start) problems.expiresAt = 'bx_v_expiry_after'
  }
  return problems
}

// The body of POST /admin/messages
export function toPayload(draft, idempotencyKey) {
  const translations = {}
  for (const code of LANGS) {
    if (code === draft.mainLang) continue
    const part = draft.translations[code]
    const title = part.title.trim()
    const body = part.body.trim()
    const label = draft.button ? (part.label || '').trim() : ''
    if (title || body || label) translations[code] = { ...(title ? { title } : {}), ...(body ? { body } : {}), ...(label ? { action_label: label } : {}) }
  }
  return {
    audiences: AUDIENCE_OPTIONS.filter(option => draft.audiences.includes(option)),
    ...(draft.audiences.includes('user') ? { email: draft.person.email } : {}),
    main_lang: draft.mainLang,
    title: draft.title.trim(),
    body: draft.body.trim(),
    ...(Object.keys(translations).length ? { translations } : {}),
    ...(draft.button ? { action_label: draft.label.trim(), action_target: draft.target === 'external' ? draft.url.trim() : draft.target } : {}),
    ...(draft.when === 'later' ? { visible_from: draft.sendAt } : {}),
    ...(draft.expires ? { expires_at: draft.expiresAt } : {}),
    idempotency_key: idempotencyKey
  }
}

// The card the client will see, for the language `lang`: the translation of each part if there is one,
// otherwise what was written in the main language (the server does the same).
export function previewItem(draft, lang, nowWall) {
  const own = lang === draft.mainLang ? {} : draft.translations[lang]
  const target = draft.target === 'external' ? draft.url.trim() : draft.target
  const label = own.label?.trim() || draft.label.trim()                  // the button text of that language, or the written one
  const actions = draft.button && label && draft.label.trim() && target
    ? [{ type: 'link', label, target, state: 'available' }]
    : []
  return {
    id: 0, kind: 'admin', type: draft.audiences.length === 1 && draft.audiences[0] === 'user' ? 'direct' : 'broadcast',
    title: own.title?.trim() || draft.title.trim(), body: own.body?.trim() || draft.body.trim(),
    date: nowWall, read: false, actions, can_archive: true, archived: false
  }
}

// What each answer of the server (error.code) says. The keys are admin texts.
const SERVER = {
  required: 'bx_err_required', too_long: 'bx_err_too_long', html_not_allowed: 'bx_err_html_not_allowed',
  invalid_target: 'bx_err_invalid_target', button_incomplete: 'bx_err_button_incomplete', date_in_past: 'bx_err_date_in_past',
  date_too_far: 'bx_err_date_too_far', invalid_date: 'bx_err_invalid_date', expiry_before_start: 'bx_err_expiry_before_start',
  no_such_client: 'bx_err_no_such_client', client_archived: 'bx_err_client_archived', no_recipients: 'bx_err_no_recipients',
  invalid_audience: 'bx_err_invalid_audience', invalid_language: 'bx_err_invalid_language'
}
export const serverErrorKey = (code) => SERVER[code] || 'bx_err_generic'

// The audience as the history says it
export const AUDIENCE_KEY = { all: 'bx_to_all', active_pack: 'bx_to_pack', trainers: 'bx_to_trainers', user: 'bx_to_user' }

// The audiences of a message of the history: the list, or the single old column of an older message.
export const audiencesOf = (message) => (Array.isArray(message.audiences) && message.audiences.length ? message.audiences : [message.audience].filter(Boolean))
export const STATUS_TONE = { scheduled: 'sky', sent: 'emerald', expired: 'neutral' }
