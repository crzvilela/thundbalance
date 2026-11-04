import { useAdminText } from './useAdminText'
import { parseDateKey } from './requests'
import { Button, Icon } from './ui'

// A client can have several packs at once. Two sessions of the same client at the same time (from different packs) are
// ALLOWED, but the admin is warned first: the list says the date, the hour and the pack the other session belongs to.
//   overlaps: [{ date, time, kind: 'client_busy', pack }]

function useFormat() {
  const { language } = useAdminText()
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  return (key) => parseDateKey(String(key).slice(0, 10)).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

export function OverlapList({ overlaps }) {
  const { t } = useAdminText()
  const format = useFormat()
  if (!overlaps || overlaps.length === 0) return null
  const shown = overlaps.slice(0, 12)
  return (
    <div className="mt-3 rounded-xl border border-sky-400/25 bg-sky-400/5 p-4 text-sm text-sky-100" role="status">
      <p className="mb-2 font-medium">{t('ov_title')} ({overlaps.length})</p>
      <ul className="space-y-1.5" aria-label={t('ov_title')}>
        {shown.map(item => (
          <li key={`${item.date}-${item.time}`} className="flex items-start gap-2">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
            <span><strong>{format(item.date)} · {item.time}</strong> — {item.pack ? t('ov_with_pack').replace('{pack}', item.pack) : t('ov_with_other')}</span>
          </li>
        ))}
        {overlaps.length > shown.length && <li className="pl-6 text-sky-200/80">+{overlaps.length - shown.length} …</li>}
      </ul>
    </div>
  )
}

// The question shown when the admin presses the button and the sessions overlap: change the form, or continue anyway.
export function OverlapAsk({ overlaps, busy, onChange, onContinue }) {
  const { t } = useAdminText()
  if (!overlaps || overlaps.length === 0) return null
  return (
    <div role="alert" className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
      <p className="mb-3 text-sm">{t('ov_question')}</p>
      <OverlapList overlaps={overlaps} />
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onChange} disabled={busy}>{t('cf_change')}</Button>
        <Button variant="primary" onClick={onContinue} loading={busy}>{t('ov_continue')}</Button>
      </div>
    </div>
  )
}
