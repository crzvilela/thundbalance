import { useState } from 'react'
import { adminRequest } from '../api'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../ui'

// "Estado del sistema": the errors of the site that were recorded (monitoring.py). Only types, places and counts: never personal data.
const FILTERS = ['', 'new', 'seen', 'resolved']
const TONE = { new: 'amber', seen: 'sky', resolved: 'emerald' }

export default function SystemStatus() {
  const { t, language } = useAdminText()
  const toast = useToast()
  const [filter, setFilter] = useState('')
  const resource = useAdminResource(`/admin/system-errors${filter ? `?status=${filter}` : ''}`)
  const items = resource.data?.items || []
  const summary = resource.data?.summary
  const when = (value) => (value ? new Date(value).toLocaleString(language === 'es' ? 'es-ES' : 'en-GB') : '—')

  const setStatus = async (item, status) => {
    try {
      await adminRequest('POST', `/admin/system-errors/${item.id}/status`, { status })
      resource.reload()
    } catch (error) {
      toast.push(error.message, 'error')
    }
  }

  return (
    <div className="admin-fade">
      <PageHeader pageKey="system" title={t('sys_title')} subtitle={t('sys_sub')}
        actions={<Button variant="secondary" onClick={resource.reload}>{t('sys_refresh')}</Button>} />

      <section className="mb-6 grid gap-4 sm:grid-cols-2" aria-label={t('sys_summary')}>
        <Card className="p-5">
          <p className="text-sm text-gray-400">{t('sys_new_24h')}</p>
          <p className={`mt-1 text-3xl font-semibold tabular-nums ${summary?.new_24h ? 'text-amber-300' : 'text-emerald-300'}`}>{summary ? summary.new_24h : '—'}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-gray-400">{t('sys_last')}</p>
          <p className="mt-1 break-words text-lg font-semibold">{summary?.last_error ? summary.last_error.error_type : t('sys_none')}</p>
          {summary?.last_error && <p className="text-xs text-gray-500">{when(summary.last_error.last_seen)}</p>}
        </Card>
      </section>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('sys_filter')}>
        {FILTERS.map(value => (
          <button key={value || 'all'} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value}
            className={`min-h-10 rounded-full border px-4 text-sm transition ${filter === value ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200' : 'border-white/10 text-gray-400 hover:text-white'}`}>
            {value ? t(`sys_st_${value}`) : t('sys_all')}
          </button>
        ))}
      </div>

      {resource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${resource.error})`} retryLabel={t('retry')} onRetry={resource.reload} /></Card>
      ) : resource.loading && !resource.data ? (
        <Skeleton className="h-40" />
      ) : items.length === 0 ? (
        <Card><EmptyState icon="check" title={t('sys_empty')} /></Card>
      ) : (
        <ul className="space-y-3">
          {items.map(item => (
            <li key={item.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={item.source === 'frontend' ? 'sky' : 'neutral'}>{item.source === 'frontend' ? t('sys_src_front') : t('sys_src_back')}</Badge>
                  <Badge tone={TONE[item.status] || 'neutral'}>{t(`sys_st_${item.status}`)}</Badge>
                  <span className="font-semibold break-words">{item.error_type}</span>
                  <span className="ml-auto text-sm tabular-nums text-gray-400">{t('sys_times').replace('{n}', item.count)}</span>
                </div>
                <p className="mt-2 break-all text-sm text-gray-300">
                  {[item.route_pattern, item.file ? `${item.file}:${item.line}` : '', item.function].filter(Boolean).join(' · ') || '—'}
                </p>
                {item.message && <p className="mt-1 break-words text-xs text-gray-500">{item.message}</p>}
                <p className="mt-2 text-xs text-gray-500">{t('sys_first')} {when(item.first_seen)} · {t('sys_last_seen')} {when(item.last_seen)}{item.release ? ` · ${item.release}` : ''}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.status !== 'seen' && <Button variant="secondary" onClick={() => setStatus(item, 'seen')}>{t('sys_mark_seen')}</Button>}
                  {item.status !== 'resolved' && <Button variant="primary" onClick={() => setStatus(item, 'resolved')}>{t('sys_mark_resolved')}</Button>}
                  {item.status === 'resolved' && <Button variant="secondary" onClick={() => setStatus(item, 'new')}>{t('sys_reopen')}</Button>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
