import { Link } from 'react-router-dom'
import { useAdminText } from './useAdminText'
import { Button, Card } from './ui'

// A path under /admin that does not exist: it is shown INSIDE the admin (the side menu stays), in the language of the panel (ES / EN).
export default function AdminNotFound() {
  const { t } = useAdminText()
  return (
    <div className="admin-fade">
      <Card className="mx-auto mt-10 max-w-xl p-10 text-center">
        <p className="text-6xl font-semibold text-emerald-400" aria-hidden="true" style={{ fontFamily: 'Bebas Neue, Inter, sans-serif' }}>404</p>
        <h1 className="mt-3 text-2xl font-semibold">{t('nf_title')}</h1>
        <p className="mt-2 text-sm text-gray-400">{t('nf_text')}</p>
        <Link to="/admin" className="mt-6 inline-block"><Button variant="primary">{t('nf_back')}</Button></Link>
      </Card>
    </div>
  )
}
