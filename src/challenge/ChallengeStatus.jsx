import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nContext'

export const SLOW_CHECK_MS = 3000

// The line under a form for the automatic check. When all goes well nothing is shown at all: it only speaks when the check takes more
// than 3 seconds ("checking") or fails (a message and a real "Retry" button that works with the keyboard). Screen readers hear it only then.
export default function ChallengeStatus({ guard, light = false, className = '' }) {
  const { t } = useI18n()
  const { state } = guard
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (state !== 'checking') return undefined
    const timer = window.setTimeout(() => setSlow(true), SLOW_CHECK_MS)
    return () => { window.clearTimeout(timer); setSlow(false) }
  }, [state])
  const tone = light ? 'text-gray-600' : 'text-hint'
  const alarm = light ? 'text-red-700' : 'text-red-300'
  const visible = (state === 'checking' && slow) || state === 'error' || state === 'unsupported'
  // the live region is always in the page (so a later message is announced) but takes no room while there is nothing to say
  return (
    <div role="status" aria-live="polite" className={visible ? `text-xs ${state === 'error' || state === 'unsupported' ? alarm : tone} ${className}` : 'sr-only'}>
      {state === 'checking' && slow && t('ch_checking')}
      {state === 'unsupported' && t('ch_unsupported')}
      {state === 'error' && (
        <span>
          {t('ch_error')}{' '}
          <button type="button" onClick={guard.retry} className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-2">{t('ch_retry')}</button>
        </span>
      )}
    </div>
  )
}
