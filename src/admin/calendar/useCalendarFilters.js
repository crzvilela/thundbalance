import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { KINDS } from './calendarConfig'

// The filters (and the view and day being looked at) live in the URL, so a reload or a
// shared link shows the same calendar:  ?q=ana@x.com&trainers=1,3&kind=trials&cancelled=1&view=timeGridWeek&date=2026-10-19
export function useCalendarFilters() {
  const [params, setParams] = useSearchParams()

  const filters = useMemo(() => ({
    email: (params.get('q') || '').trim().toLowerCase(),
    trainers: (params.get('trainers') || '').split(',').map(Number).filter(id => Number.isInteger(id) && id > 0),
    kind: KINDS.includes(params.get('kind')) ? params.get('kind') : 'all',
    cancelled: params.get('cancelled') === '1'
  }), [params])

  const update = useCallback((patch) => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '' || value === undefined) next.delete(key)
        else next.set(key, String(value))
      }
      return next
    }, { replace: true })
  }, [setParams])

  const setFilters = useCallback((patch) => update({
    ...('email' in patch ? { q: patch.email } : {}),
    ...('trainers' in patch ? { trainers: patch.trainers.length ? patch.trainers.join(',') : null } : {}),
    ...('kind' in patch ? { kind: patch.kind === 'all' ? null : patch.kind } : {}),
    ...('cancelled' in patch ? { cancelled: patch.cancelled ? '1' : null } : {})
  }), [update])

  const clear = useCallback(() => update({ q: null, trainers: null, kind: null, cancelled: null }), [update])
  const active = !!(filters.email || filters.trainers.length || filters.kind !== 'all' || filters.cancelled)

  return {
    filters, setFilters, clear, active,
    view: params.get('view'), date: params.get('date'),
    setPosition: (view, date) => update({ view, date })
  }
}
