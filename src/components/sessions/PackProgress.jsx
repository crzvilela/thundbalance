import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../../i18n/I18nContext'
import { Badge, Button, Card } from '../ui'
import { formatMonthDay } from '../../utils/sessionDates'
import { VISIBLE_PACKS, packState, sortPacks, warnText } from '../../utils/packProgress'

// How far a pack has got, readable at a glance: "4 of 8 sessions done · 4 left", when it ends and a bar that can be seen (taller, in the accent colour).
// ProgressMeter is the text + bar (My Sessions and the dashboard use it); PackBlock adds the name, the type and the gentle warning with "Renew pack";
// MyPacks is the dashboard's section ("My pack": one full block, or one compact block per pack, the one that ends first on top, three at most before "View all").

export function ProgressMeter({ done, total, remaining, endDate, label, className = '' }) {
  const { t, locale } = useI18n()
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0
  const text = t('pk_done_left', { done, total, left: remaining })
  return (
    <div className={className}>
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-gray-200">
        <span className="tabular-nums">{text}</span>
        {endDate && <span className="text-gray-400">{t('pk_ends', { date: formatMonthDay(endDate, locale) })}</span>}
      </p>
      <div role="progressbar" aria-label={label || t('pk_progress')} aria-valuetext={text} aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}
        className="mt-2.5 h-3 overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-accent transition-all duration-700 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function Warning({ warn }) {
  const { t } = useI18n()
  const text = warnText(warn)
  if (!text) return null
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Badge tone="warn" size="md">{t(text.key, text.values)}</Badge>
      <Button as={Link} to="/training-request" variant="secondary" size="sm">{t('pk_renew')}</Button>
    </div>
  )
}

export function PackBlock({ pack, today, compact = false }) {
  const { t } = useI18n()
  const state = packState(pack, today)
  const type = pack.session_type === 'dual' ? t('st_dual') : t('st_individual')
  return (
    <Card className={compact ? 'p-5' : 'p-6 sm:p-7'}>
      <p className="mb-1 text-sm text-gray-400">{type}</p>
      <h3 className={`break-words font-semibold ${compact ? 'text-xl' : 'text-2xl'}`}>{pack.name}</h3>
      <ProgressMeter className="mt-4" done={state.done} total={state.total} remaining={state.remaining} endDate={state.endDate} label={`${t('pk_progress')}: ${pack.name}`} />
      <Warning warn={state.warn} />
    </Card>
  )
}

export function MyPacks({ plans, today }) {
  const { t } = useI18n()
  const [all, setAll] = useState(false)
  const packs = sortPacks(plans)
  if (packs.length === 0) return null
  const shown = all ? packs : packs.slice(0, VISIBLE_PACKS)
  const several = packs.length > 1
  return (
    <section aria-labelledby="dash-pack-title" className="mb-8">
      <h2 id="dash-pack-title" style={{ fontFamily: 'Bebas Neue' }} className="mb-4 text-3xl">{several ? t('dash_my_packs') : t('dash_my_pack')}</h2>
      <ul className={`grid gap-4 ${several ? 'sm:grid-cols-2 lg:grid-cols-3' : ''}`} aria-label={t('dash_package')}>
        {shown.map(pack => <li key={pack.id}><PackBlock pack={pack} today={today} compact={several} /></li>)}
      </ul>
      {packs.length > VISIBLE_PACKS && (
        <Button variant="ghost" className="mt-3" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? t('pk_show_less') : t('pk_show_all', { n: packs.length })}
        </Button>
      )}
    </section>
  )
}
