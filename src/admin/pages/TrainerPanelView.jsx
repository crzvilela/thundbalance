import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { adminFetch } from '../../api/admin'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { Button, Card, EmptyState, ErrorState, Icon, Skeleton } from '../ui'
import TrainerPanel from '../../trainer/TrainerPanel'
import { trainerSource } from '../../trainer/trainerSource'
import { useTrainerText } from '../../trainer/useTrainerText'

// /admin/trainers/:trainerId/panel: the SAME panel the trainer sees, fed by the admin endpoints, read only,
// under a fixed band that says so. The language is the admin panel's.
export default function TrainerPanelView() {
  const { trainerId } = useParams()
  const navigate = useNavigate()
  const { t: adminT, language } = useAdminText()
  const { t } = useTrainerText(language)
  const trainers = useAdminResource('/admin/trainer-availability')
  const source = useMemo(() => trainerSource(adminFetch, `/admin/trainers/${trainerId}/panel`), [trainerId])
  const trainer = (Array.isArray(trainers.data) ? trainers.data : []).find(item => String(item.id) === String(trainerId))

  return (
    <div className="admin-fade">
      <div className="sticky top-0 z-30 -mx-1 mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/15 px-4 py-3 text-amber-300 shadow-lg backdrop-blur">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Icon name="alert" className="h-4 w-4 shrink-0" />
          <span className="min-w-0">{trainer ? t('tr_admin_banner', { name: trainer.name }) : t('tr_readonly')}</span>
        </p>
        <Button variant="secondary" onClick={() => navigate('/admin/trainers')}>{t('tr_back')}</Button>
      </div>

      {trainers.error ? (
        <Card><ErrorState message={`${adminT('load_error')} (${trainers.error})`} retryLabel={adminT('retry')} onRetry={trainers.reload} /></Card>
      ) : trainers.loading && !trainers.data ? (
        <Skeleton className="h-64" />
      ) : !trainer ? (
        <Card><EmptyState icon="clients" title={t('tr_admin_not_found')} /></Card>
      ) : (
        <TrainerPanel source={source} trainerName={trainer.name} color={trainer.color} language={language} />
      )}
    </div>
  )
}
