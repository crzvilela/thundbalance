import { memo } from 'react'
import { Link } from 'react-router-dom'
import { BsArchive, BsCheckCircleFill, BsClockHistory, BsEnvelope, BsInbox } from 'react-icons/bs'
import { useI18n } from '../../i18n/I18nContext'
import { doneLabelKey, fullDate, isLong, relativeTime } from '../../utils/inboxFormat'
import { linkify } from '../../utils/linkify'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'
const BUTTON = `inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 sm:w-auto ${FOCUS}`
const PRIMARY = `${BUTTON} bg-emerald-400 text-black hover:bg-emerald-300`
const SECONDARY = `${BUTTON} border border-white/25 text-white hover:bg-white/10`
const CONTACT_ADDRESS = 'pt@thundbalance.com'

const spinner = <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />

// The text of a message: line breaks kept, web addresses clickable. Every piece is drawn as React text (escaped);
// only http(s) addresses become links, and they open in a new tab without handing over the opener.
function MessageText({ text }) {
  return linkify(text).map((piece, index) => (
    piece.href
      ? <a key={index} href={piece.href} target="_blank" rel="noopener noreferrer" className={`break-all text-emerald-300 underline underline-offset-2 hover:text-emerald-200 ${FOCUS}`}>{piece.text}</a>
      : <span key={index}>{piece.text}</span>
  ))
}

function LinkButton({ action, onRead }) {
  const internal = String(action.target || '').startsWith('/')
  return internal
    ? <Link to={action.target} onClick={onRead} className={SECONDARY}>{action.label}</Link>
    : <a href={action.target} target="_blank" rel="noopener noreferrer" onClick={onRead} className={SECONDARY}>{action.label}</a>
}

// One message. It knows nothing about the server: the page gives it the item (with the live state of each button),
// what happened after the last press (`outcome`, `result`, `error`) and the functions to call.
function MessageCard({ item, now, expanded, busy, outcome, result, error, onToggle, onRead, onAction, onArchive, onUnarchive, translate, localeOverride }) {
  const i18n = useI18n()
  // the studio's preview draws the card in the language it is asked for, not in the language of the panel
  const t = translate || i18n.t
  const locale = localeOverride || i18n.locale
  const buttons = item.actions.filter(action => action.type !== 'link')
  const links = item.actions.filter(action => action.type === 'link' && action.target)
  const waiting = buttons.filter(action => action.state === 'available')
  const settled = buttons.length > 0 && waiting.length === 0 ? (buttons.some(action => action.state === 'done') ? 'done' : 'expired') : null
  const long = isLong(item.body)
  const counter = item.type === 'reschedule_counter'
  const labelOf = (action) => t(`in_btn_${action.type}`) === `in_btn_${action.type}` ? action.label : t(`in_btn_${action.type}`)
  const result0 = buttons[0]
  const answered = result0 ? (result0.result || outcome) : null

  const handleClick = (event) => {
    if (!item.read && !event.target.closest('a, button')) onRead(item)       // a click on the card itself reads it
  }

  return (
    <article
      onClick={handleClick} aria-labelledby={`message-title-${item.id}`}
      className={`rounded-3xl border bg-white/[0.025] p-5 sm:p-6 ${item.read ? 'border-white/10' : 'border-emerald-400/40'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 id={`message-title-${item.id}`} className="min-w-0 flex-1 basis-60 text-lg font-semibold text-white [overflow-wrap:anywhere]">
          <button type="button" onClick={() => onToggle(item)} aria-expanded={expanded} className={`text-left ${FOCUS} rounded`}>{item.title}</button>
        </h2>
        <div className="flex items-center gap-3">
          {!item.read && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-400" />{t('in_new')}
            </span>
          )}
          <time dateTime={item.date} title={fullDate(item.date, locale)} className="text-xs text-gray-400">{relativeTime(item.date, now, locale)}</time>
        </div>
      </div>

      {counter ? (
        <p className={`mt-4 whitespace-pre-wrap rounded-2xl border border-amber-400/40 bg-amber-400/[0.07] p-4 text-base text-amber-50 [overflow-wrap:anywhere] ${!expanded && long ? 'line-clamp-4' : ''}`}>
          <MessageText text={item.body} />
        </p>
      ) : (
        <p className={`mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-200 [overflow-wrap:anywhere] ${!expanded && long ? 'line-clamp-4' : ''}`}>
          <MessageText text={item.body} />
        </p>
      )}
      {long && (
        <button type="button" onClick={() => onToggle(item)} aria-expanded={expanded} className={`mt-2 min-h-[32px] rounded text-sm font-semibold text-emerald-300 underline-offset-4 hover:underline ${FOCUS}`}>
          {expanded ? t('in_show_less') : t('in_show_more')}
        </button>
      )}

      {(waiting.length > 0 || settled || links.length > 0 || result || error) && (
        <div className="mt-5 flex flex-col gap-3">
          {waiting.length > 0 && (
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {waiting.map(action => {
                const positive = action.type === 'trial_confirm' || action.type === 'reschedule_accept'
                return (
                  <button key={action.type} type="button" disabled={busy} onClick={() => onAction(item, action)} className={positive ? PRIMARY : SECONDARY}>
                    {busy && spinner}{labelOf(action)}
                  </button>
                )
              })}
            </div>
          )}
          {settled === 'done' && (
            <p className="inline-flex items-center gap-2 self-start rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3.5 py-1.5 text-sm font-semibold text-emerald-200">
              <BsCheckCircleFill aria-hidden="true" className="h-4 w-4" />{t(doneLabelKey(result0.type, answered))}
            </p>
          )}
          {settled === 'expired' && (
            <p className="inline-flex items-center gap-2 self-start rounded-full border border-white/20 bg-white/5 px-3.5 py-1.5 text-sm font-semibold text-gray-300">
              <BsClockHistory aria-hidden="true" className="h-4 w-4" />{t('in_expired')}
            </p>
          )}
          {result && <p role="status" className="text-sm text-emerald-200">{t(result)}</p>}
          {error && <p role="alert" className="rounded-xl border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-100">{t(error)}</p>}
          {links.length > 0 && (
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {links.map(action => <LinkButton key={`${action.target}-${action.label}`} action={action} onRead={() => onRead(item)} />)}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
        <a
          href={`mailto:${CONTACT_ADDRESS}?subject=${encodeURIComponent(t('in_contact_subject', { title: item.title }))}`}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg px-2 text-sm text-gray-300 transition hover:text-white ${FOCUS}`}
        >
          <BsEnvelope aria-hidden="true" className="h-4 w-4" />{t('in_contact')}
        </a>
        <div className="flex items-center gap-3">
          {item.archived ? (
            <button
              type="button" disabled={busy} onClick={() => onUnarchive(item)}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/20 px-3 text-sm text-white transition hover:bg-white/10 disabled:opacity-50 ${FOCUS}`}
            >
              <BsInbox aria-hidden="true" className="h-4 w-4" />{t('in_unarchive')}
            </button>
          ) : (
            <>
              {!item.can_archive && <span id={`blocked-${item.id}`} className="max-w-[16rem] text-right text-xs text-gray-400">{t('in_archive_blocked')}</span>}
              <button
                type="button" disabled={!item.can_archive || busy} onClick={() => onArchive(item)}
                aria-describedby={item.can_archive ? undefined : `blocked-${item.id}`}
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-300 ${FOCUS}`}
              >
                <BsArchive aria-hidden="true" className="h-4 w-4" />{t('in_archive')}
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  )
}

export default memo(MessageCard)
