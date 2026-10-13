import { useCallback, useEffect, useState } from 'react'
import { loadCalendarFeed, regenerateCalendarFeed } from '../api/calendarFeed'
import { useI18n } from '../i18n/I18nContext'

// "Add to my calendar": Google Calendar button, .ics download and the feed URL
// to paste into Apple Calendar / Outlook.
function CalendarSubscribe({ className = '' }) {
  const { t } = useI18n()
  const [links, setLinks] = useState(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async (action = loadCalendarFeed) => {
    try {
      setLinks(await action())
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    let active = true
    loadCalendarFeed().then(
      result => { if (active) setLinks(result) },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(links.https)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard blocked: the field is selectable
    }
  }

  const regenerate = () => {
    if (window.confirm(t('cal_regenerate_warn'))) load(regenerateCalendarFeed)
  }

  return <section className={`border border-white/10 bg-white/[0.03] p-6 rounded-2xl ${className}`}>
    <h2 style={{ fontFamily: 'Bebas Neue' }} className="text-4xl mb-2">{t('cal_title')}</h2>
    <p className="text-gray-400 mb-5">{t('cal_intro')}</p>
    {failed && <p className="text-amber-300 mb-4" role="alert">{t('cal_error')}</p>}
    {links && <>
      <div className="flex flex-wrap items-center gap-4 mb-5">
        <a href={links.google} target="_blank" rel="noopener noreferrer" className="bg-green-500 text-black font-semibold px-6 py-3 rounded-lg">{t('cal_add_google')}</a>
        <a href={links.https} className="underline text-gray-300">{t('cal_download')}</a>
      </div>
      <label className="block text-sm text-gray-400 mb-2" htmlFor="cal-feed-url">{t('cal_url_label')}</label>
      <div className="flex gap-2 mb-4">
        <input id="cal-feed-url" readOnly value={links.https} onFocus={event => event.target.select()} className="min-w-0 flex-1 bg-black border border-white/20 rounded-lg px-3 py-2 text-sm" />
        <button type="button" onClick={copy} className="border border-white/20 px-4 py-2 rounded-lg">{copied ? t('cal_copied') : t('cal_copy')}</button>
      </div>
      <p className="text-sm text-gray-400 mb-4">{t('cal_delay')}</p>
      <button type="button" onClick={regenerate} className="text-sm text-gray-500 underline">{t('cal_regenerate')}</button>
    </>}
  </section>
}

export default CalendarSubscribe
