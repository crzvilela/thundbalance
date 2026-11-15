import { Link } from 'react-router-dom'
import { useAdminText } from './useAdminText'
import { useAdminResource } from './useAdminResource'

// A discreet line on the Overview while the company data is incomplete or the legal texts are not marked as reviewed.
export default function LegalNotice() {
  const { t } = useAdminText()
  const resource = useAdminResource('/admin/legal/status')
  if (!resource.data?.needs_attention) return null
  return (
    <p role="status" className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-sky-400/25 bg-sky-400/5 px-4 py-2.5 text-sm text-sky-100">
      <span>{t('lt_notice')}</span>
      <Link to="/admin/legal" className="font-semibold underline underline-offset-2 hover:text-white">{t('lt_notice_open')}</Link>
    </p>
  )
}
