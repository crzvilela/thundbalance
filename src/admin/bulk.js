import { useCallback, useMemo, useState } from 'react'

// Selecting several rows of an admin list (see BulkBar.jsx). Pure helpers first, so they can be tested without a page.

export const MAX_BULK = 200            // the server refuses more than this in one request

export const fill = (text, values) => Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), text)

// Only the ids still on screen stay selected (a filter, a search or a reload can remove rows).
export function pruneSelection(selected, visibleIds) {
  const visible = new Set(visibleIds)
  return [...selected].filter(id => visible.has(id))
}

// "Select all" acts on the visible, filtered rows only: everything selected -> none, otherwise all of them.
export function toggleAllIds(selectedIds, visibleIds) {
  const everything = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id))
  return everything ? [] : visibleIds.slice(0, MAX_BULK)
}

// The server answer {total, done, failed, results:[{id, ok, error?}]} as the page shows it.
export function summarize(answer) {
  const results = Array.isArray(answer?.results) ? answer.results : []
  const failed = results.filter(item => !item.ok)
  return { total: answer?.total ?? results.length, done: answer?.done ?? results.length - failed.length, failed: failed.length, errors: failed }
}

// The selected ids of a list. `items` are the rows visible now and `getId` must not change between renders.
export function useBulkSelection(items, getId, isSelectable = () => true) {
  const [picked, setPicked] = useState([])
  const selectable = useMemo(() => items.filter(isSelectable).map(getId), [items, getId, isSelectable])
  const ids = useMemo(() => pruneSelection(picked, selectable), [picked, selectable])
  const chosen = useMemo(() => new Set(ids), [ids])
  const toggle = useCallback((id) => setPicked(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id].slice(0, MAX_BULK))), [])
  const toggleAll = useCallback(() => setPicked(toggleAllIds(ids, selectable)), [ids, selectable])
  const clear = useCallback(() => setPicked([]), [])
  return {
    ids, chosen, toggle, toggleAll, clear,
    count: ids.length,
    allSelected: selectable.length > 0 && ids.length === Math.min(selectable.length, MAX_BULK),
    someSelected: ids.length > 0,
    selectableCount: selectable.length
  }
}
