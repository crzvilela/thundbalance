import { OPEN } from './changeRequest.js'

// The requests of the client that still wait for something, for the "pending requests" cards of My Sessions.
// Pure (no React), so it is tested with `node --test`.
//
//   reschedule  a change of date: waiting for the studio ('pending') or the studio proposed another date ('counter_proposed')
//   pack        the pack request, waiting for the studio's approval
//   trial       the trial session: waiting for the studio ('pending') or approved and waiting for the client's confirmation
//
// Each item: { key, kind, counter, sentAt, ... }. A proposal of the studio always comes first, then the newest.

export function buildPendingRequests({ requests = [], sessions = [], trial = null, packRequest = null, isLive = () => true }) {
  const items = []
  for (const request of requests) {
    if (!OPEN.includes(request.status)) continue
    const session = sessions.find(item => item.id === request.session_id)
    if (!session || !isLive(session)) continue            // the session was cancelled or is over: nothing left to decide
    items.push({ key: `reschedule-${request.id}`, kind: 'reschedule', counter: request.status === 'counter_proposed', sentAt: request.created_at || null, request, session })
  }
  if (packRequest) {
    items.push({ key: `pack-${packRequest.id}`, kind: 'pack', counter: false, sentAt: packRequest.created_at || null, pack: packRequest })
  }
  if (trial && (trial.status === 'pending' || trial.status === 'approved')) {
    items.push({ key: `trial-${trial.id}`, kind: 'trial', counter: false, sentAt: trial.created_at || null, trial })
  }
  return items.sort((a, b) => Number(b.counter) - Number(a.counter) || String(b.sentAt || '').localeCompare(String(a.sentAt || '')))
}
