import { Link } from 'react-router-dom'
import { useAdminText } from './useAdminText'
import { useAdminResource } from './useAdminResource'

// A discreet line on the Overview, ONLY when the site recorded new errors in the last 24 hours (Admin > Estado del sistema has the list).
export default function SystemErrorsNotice() {
  const { t } = useAdminText()
  const resource = useAdminResource('/admin/system-errors?status=new&limit=1')
  const count = resource.data?.summary?.new_24h || 0
  if (!count) return null
  return (
    <p role="status" className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-400/25 bg-amber-400/5 px-4 py-2.5 text-sm text-amber-100">
      <span><strong className="tabular-nums">{count}</strong> {t('sys_notice')}</span>
      <Link to="/admin/system" className="font-semibold underline underline-offset-2 hover:text-white">{t('sys_notice_open')}</Link>
    </p>
  )
}
