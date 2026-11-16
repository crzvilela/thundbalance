import { useI18n } from '../i18n/I18nContext'

// The line under a form that says how the automatic check is going. Nothing to solve or click while it works: it only reads
// "checking" and then "ready". If it fails there is a button to try again (a real button: it works with the keyboard).
export default function ChallengeStatus({ guard, light = false, className = '' }) {
  const { t } = useI18n()
  const { state } = guard
  const tone = light ? 'text-gray-600' : 'text-hint'
  const alarm = light ? 'text-red-700' : 'text-red-300'
  return (
    <div role="status" aria-live="polite" className={`min-h-[1.25rem] text-xs ${state === 'error' || state === 'unsupported' ? alarm : tone} ${className}`}>
      {state === 'checking' && t('ch_checking')}
      {state === 'ready' && t('ch_ready')}
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
