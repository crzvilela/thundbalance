import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nContext'

// Shown instead of a blank page when the server (a free host that sleeps) takes more than 3 seconds to answer.
// It is discreet, never an error, and disappears with the placeholder it lives in as soon as the content arrives.
export const WAKE_NOTICE_MS = 3000

export default function WakeNotice() {
  const { t } = useI18n()
  const [late, setLate] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setLate(true), WAKE_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <div role="status" aria-live="polite" className="flex min-h-[40vh] items-center justify-center px-6 text-center">
      {late && <p className="max-w-sm text-sm text-gray-300">{t('wake_notice')}</p>}
    </div>
  )
}
