import { useEffect, useRef, useState } from 'react'
import { downloadAllSessionsIcs, loadCalendarFeed } from '../../api/calendarFeed'
import { useI18n } from '../../i18n/I18nContext'
import { Spinner } from './SessionParts'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'

// "Add all my sessions": subscribe (the calendar updates itself) or download one .ics.
export default function AddAllMenu({ onError }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [links, setLinks] = useState(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const box = useRef(null)
  const trigger = useRef(null)

  // the private link is created the first time the menu opens
  useEffect(() => {
    if (!open || links) return undefined
    let active = true
    loadCalendarFeed().then(
      result => { if (active) { setLinks(result); setFailed(false) } },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [open, links, attempt])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    const onClick = (event) => { if (box.current && !box.current.contains(event.target)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) }
  }, [open])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(links.https)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      onError(t('ms_err_download'))   // clipboard blocked: the field below is selectable anyway
    }
  }

  const download = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      await downloadAllSessionsIcs()
    } catch {
      onError(t('ms_err_download'))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div ref={box} className="relative">
      <button
        ref={trigger} type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(value => !value)}
        className={`inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/50 px-5 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-400 hover:text-black sm:w-auto ${FOCUS}`}
      >
        {t('ms_add_all')}<span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div role="group" aria-label={t('ms_menu_label')}
          className="absolute left-0 z-20 mt-2 w-[min(24rem,calc(100vw-2.5rem))] space-y-4 rounded-2xl border border-white/15 bg-[#0d1110] p-4 shadow-2xl shadow-black/60 sm:left-auto sm:right-0">
          <div>
            {links ? (
              <a href={links.google} target="_blank" rel="noopener noreferrer"
                className={`flex min-h-[44px] items-center justify-center rounded-xl bg-emerald-400 px-4 py-2.5 text-center text-sm font-semibold text-black transition hover:bg-emerald-300 ${FOCUS}`}>
                {t('ms_subscribe')}
              </a>
            ) : failed ? (
              <p role="alert" className="text-sm text-amber-300">{t('ms_err_feed')}{' '}
                <button type="button" onClick={() => { setFailed(false); setAttempt(count => count + 1) }} className={`underline ${FOCUS}`}>{t('pg_try_again')}</button>
              </p>
            ) : (
              <p role="status" className="flex items-center gap-2 text-sm text-gray-300"><Spinner />{t('ms_working')}</p>
            )}
          </div>

          {links && (
            <div>
              <label htmlFor="ms-feed-url" className="mb-1.5 block text-xs uppercase tracking-wider text-gray-400">{t('ms_feed_label')}</label>
              <div className="flex gap-2">
                <input id="ms-feed-url" readOnly value={links.https} onFocus={(event) => event.target.select()}
                  className={`min-w-0 flex-1 rounded-lg border border-white/20 bg-black px-3 py-2 text-xs text-gray-200 ${FOCUS}`} />
                <button type="button" onClick={copy} className={`min-h-[44px] shrink-0 rounded-lg border border-white/25 px-3 text-sm transition hover:bg-white/10 ${FOCUS}`}>
                  {copied ? t('ms_link_copied') : t('ms_copy_link')}
                </button>
              </div>
            </div>
          )}

          <button type="button" onClick={download} disabled={downloading}
            className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-white/25 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60 ${FOCUS}`}>
            {downloading && <Spinner />}{t('ms_download_all')}
          </button>

          <p className="text-xs leading-relaxed text-gray-400">{t('ms_google_delay')}</p>
        </div>
      )}
    </div>
  )
}
