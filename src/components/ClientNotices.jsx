import { useI18n } from '../i18n/I18nContext'

const SOON_DAYS = 7
const STUDIO_EMAIL = 'info@thundbalance.com'

const stampOf = (session) => `${session.date} ${String(session.time || '').slice(0, 5)}`

function dayKey(date) {
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function daysBetween(fromKey, toKey) {
  const [fy, fm, fd] = fromKey.split('-').map(Number)
  const [ty, tm, td] = toKey.split('-').map(Number)
  return Math.round((new Date(ty, tm - 1, td) - new Date(fy, fm - 1, fd)) / 86400000)
}

// Reminders for the client's dashboard: a session today or tomorrow, and a pack
// that is ending or has ended (the studio renews it).
export default function ClientNotices({ workflow }) {
  const { t, locale } = useI18n()
  const now = new Date()
  const today = dayKey(now)
  const nowStamp = `${today} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  const booked = (workflow?.sessions || []).filter(session => session.status === 'Booked')
  const next = booked.find(session => stampOf(session) >= nowStamp)
  const notices = []

  if (next) {
    const diff = daysBetween(today, next.date)
    const time = String(next.time || '').slice(0, 5)
    if (diff === 0) notices.push({ tone: 'emerald', text: t('notice_session_today', { time }) })
    else if (diff === 1) notices.push({ tone: 'emerald', text: t('notice_session_tomorrow', { time }) })
  }

  // End of the pack: the recorded end date, or the last booked session.
  const lastBooked = booked.length ? booked[booked.length - 1].date : null
  const end = workflow?.plan?.end_date || lastBooked
  if (end) {
    const left = daysBetween(today, end)
    const remaining = booked.filter(session => stampOf(session) >= nowStamp).length
    const endLabel = new Date(`${end}T00:00:00`).toLocaleDateString(locale)
    if (left < 0 || (remaining === 0 && left <= 0)) {
      notices.push({ tone: 'amber', text: t('notice_pack_ended', { date: endLabel }), renew: true })
    } else if (left <= SOON_DAYS) {
      notices.push({ tone: 'amber', text: t('notice_pack_ending', { date: endLabel, n: remaining }), renew: true })
    }
  }

  if (notices.length === 0) return null

  const styles = {
    emerald: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
    amber: 'border-amber-400/30 bg-amber-400/10 text-amber-100'
  }

  return (
    <div className="mb-8 space-y-3" role="region" aria-label={t('notice_region')}>
      {notices.map(notice => (
        <div key={notice.text} className={`flex flex-col gap-3 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${styles[notice.tone]}`}>
          <p>{notice.text}</p>
          {notice.renew && (
            <a href={`mailto:${STUDIO_EMAIL}`} className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border border-white/25 px-4 text-sm font-medium text-white transition hover:bg-white/10">
              {t('notice_renew')}
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
