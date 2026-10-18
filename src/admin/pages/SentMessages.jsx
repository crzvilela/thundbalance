import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAdminText } from '../useAdminText'
import { useLeaveGuard } from '../leaveGuard'
import BroadcastComposer from '../BroadcastComposer'
import BroadcastHistory from '../BroadcastHistory'
import { emptyDraft, isDirty } from '../broadcast'
import { PageHeader } from '../ui'

const TABS = [['new', 'bx_tab_new'], ['sent', 'bx_tab_sent']]

// "Mensajes enviados": write, send or schedule a message for the clients' inbox (never by e-mail) and see what was
// sent. The tab and the message to highlight live in the URL. The draft lives here, so a look at the history does not
// lose it; leaving the page with text unsent asks first.
export default function SentMessages() {
  const { t, language } = useAdminText()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'sent' ? 'sent' : 'new'
  const highlight = Number.parseInt(params.get('highlight') || '', 10) || null
  const [draft, setDraft] = useState(() => emptyDraft(language === 'es' ? 'es' : 'en'))

  useLeaveGuard(isDirty(draft))

  const go = useCallback((next, extra = {}) => {
    setParams(() => {
      const query = new URLSearchParams()
      if (next === 'sent') query.set('tab', 'sent')
      for (const [key, value] of Object.entries(extra)) query.set(key, String(value))
      return query
    }, { replace: true })
  }, [setParams])

  return (
    <div className="admin-fade">
      <PageHeader title={t('bx_title')} subtitle={t('bx_sub')} />

      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label={t('bx_tabs')}>
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" id={`bx-tab-${key}`} aria-selected={tab === key} aria-controls={`bx-panel-${key}`} onClick={() => go(key)}
            className={`flex min-h-[44px] items-center gap-2 rounded-full border px-5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
              tab === key ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white'
            }`}>
            {t(label)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="bx-panel-new" aria-labelledby="bx-tab-new" hidden={tab !== 'new'}>
        <BroadcastComposer draft={draft} setDraft={setDraft} onSent={(id) => go('sent', { highlight: id })} />
      </div>
      {tab === 'sent' && (
        <div role="tabpanel" id="bx-panel-sent" aria-labelledby="bx-tab-sent">
          <BroadcastHistory highlight={highlight} />
        </div>
      )}
    </div>
  )
}
