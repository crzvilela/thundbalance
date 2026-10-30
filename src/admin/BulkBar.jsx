import { useEffect, useRef, useState } from 'react'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { useFocusTrap } from './useFocusTrap'
import { Button, Icon } from './ui'
import { fill, summarize } from './bulk'

// Select several rows and act once, in every admin list that can delete, archive or cancel.
//   <SelectAllRow selection={sel} />                   "Seleccionar todo" (the visible, filtered rows only)
//   <RowCheck selection={sel} id={row.id} label="…"/>   the checkbox of a row (a comfortable touch area)
//   <BulkBar selection={sel} actions={[…]} labelOf={id => name} onDone={reload} />   the fixed bar + confirmation + result
//
// An action is { key, verb, label, tone: 'danger' | 'neutral', effects: [text], word?: 'ELIMINAR',
//   extraInitial?, renderExtra?(state, setState), run(ids, extraState) -> the server answer }.
// Nothing is sent before the confirmation; the buttons are disabled while a request runs, so a double click does nothing.

export const CHECK = 'h-5 w-5 shrink-0 accent-emerald-400'

export function RowCheck({ selection, id, label }) {
  return (
    <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center" onClick={event => event.stopPropagation()}>
      <input type="checkbox" checked={selection.chosen.has(id)} onChange={() => selection.toggle(id)} className={CHECK} aria-label={label} />
    </label>
  )
}

export function SelectAllRow({ selection }) {
  const { t } = useAdminText()
  if (selection.selectableCount === 0) return null
  return (
    <div className="mb-2 flex min-h-[44px] items-center px-1">
      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-gray-300">
        <input type="checkbox" checked={selection.allSelected} onChange={selection.toggleAll} className={CHECK} />
        {t('bk_select_all')}
        {selection.someSelected && <span className="text-emerald-300" role="status">· {fill(t('bk_selected'), { n: selection.count })}</span>}
      </label>
    </div>
  )
}

function ConfirmBulk({ action, count, busy, onCancel, onConfirm }) {
  const { t } = useAdminText()
  const panel = useRef(null)
  const [extra, setExtra] = useState(action.extraInitial || {})
  const [word, setWord] = useState('')
  useFocusTrap(panel, true)
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onCancel])
  const danger = action.tone === 'danger'
  const ready = !action.word || word.trim().toUpperCase() === action.word
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!busy) onCancel() }} />
      <div ref={panel} role="alertdialog" aria-modal="true" aria-label={t(`bk_title_${action.verb}`)} className="admin-toast relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#0d1110] p-6 shadow-2xl sm:p-8">
        <span className={`mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border ${danger ? 'border-red-400/25 bg-red-400/10 text-red-300' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'}`}><Icon name="alert" /></span>
        <h2 className="text-xl font-semibold text-white sm:text-2xl">{fill(t(`bk_title_${action.verb}`), { n: count })}</h2>
        {(action.effects || []).filter(Boolean).map(effect => <p key={effect} className="mt-2 text-base text-gray-400">{effect}</p>)}
        {action.renderExtra && <div className="mt-4">{action.renderExtra(extra, setExtra, busy)}</div>}
        {action.word && (
          <label className="mt-4 block text-sm text-gray-300">
            {fill(t('bk_type_word'), { word: action.word })}
            <input value={word} onChange={event => setWord(event.target.value)} disabled={busy} autoComplete="off"
              className="mt-2 min-h-[44px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-white outline-none focus:border-emerald-400/60" />
          </label>
        )}
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="min-h-[44px] flex-1" onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} className="min-h-[44px] flex-1" onClick={() => onConfirm(extra, word)} loading={busy} disabled={!ready}>{action.label}</Button>
        </div>
      </div>
    </div>
  )
}

function ResultDialog({ summary, labelOf, onClose }) {
  const { t } = useAdminText()
  const panel = useRef(null)
  useFocusTrap(panel, true)
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div ref={panel} role="alertdialog" aria-modal="true" aria-label={t('bk_result_title')} className="admin-toast relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#0d1110] p-6 shadow-2xl sm:p-8">
        <h2 className="text-xl font-semibold text-white sm:text-2xl">{t('bk_result_title')}</h2>
        <p className="mt-2 text-base text-gray-300">{fill(t('bk_result'), { done: summary.done, failed: summary.failed })}</p>
        <ul className="mt-4 divide-y divide-white/[0.06] rounded-xl border border-white/10">
          {summary.errors.map(item => (
            <li key={item.id} className="px-4 py-3 text-sm">
              <span className="block break-words text-white">{labelOf(item.id)}</span>
              <span className="block break-words text-red-300">{item.error}</span>
            </li>
          ))}
        </ul>
        <div className="mt-6"><Button variant="secondary" className="min-h-[44px] w-full" onClick={onClose}>{t('bk_close')}</Button></div>
      </div>
    </div>
  )
}

export function BulkBar({ selection, actions, labelOf = id => `#${id}`, onDone }) {
  const { t } = useAdminText()
  const toast = useToast()
  const [pending, setPending] = useState(null)       // the action waiting for the confirmation
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState(null)
  const working = useRef(false)                      // blocks a second click before React re-renders

  const run = async (action, extra) => {
    if (working.current) return
    working.current = true
    setBusy(true)
    try {
      const answer = summarize(await action.run(selection.ids, extra))
      setPending(null)
      toast.push(fill(t('bk_result'), { done: answer.done, failed: answer.failed }), answer.failed ? 'warning' : 'success')
      if (answer.failed) setSummary(answer)
      selection.clear()
      onDone?.(answer)
    } catch (error) {
      toast.push(error.message, 'error')            // the whole request was refused: nothing was done
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  return (
    <>
      {selection.someSelected && (
        <div className="fixed inset-x-0 bottom-0 z-[55] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" role="region" aria-label={fill(t('bk_selected'), { n: selection.count })}>
          <div className="admin-toast flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-white/15 bg-[#0d1110]/95 p-3 shadow-2xl backdrop-blur sm:px-5">
            <span className="min-w-0 flex-1 basis-full text-base font-medium text-white sm:basis-auto" role="status">{fill(t('bk_selected'), { n: selection.count })}</span>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              {actions.map(action => (
                <Button key={action.key} variant={action.tone === 'danger' ? 'danger' : 'secondary'} className="min-h-[44px] flex-1 sm:flex-none" disabled={busy} onClick={() => setPending(action)}>{action.label}</Button>
              ))}
              <Button variant="ghost" className="min-h-[44px] flex-1 sm:flex-none" disabled={busy} onClick={selection.clear}>{t('bk_clear')}</Button>
            </div>
          </div>
        </div>
      )}
      {pending && selection.someSelected && (
        <ConfirmBulk action={pending} count={selection.count} busy={busy} onCancel={() => setPending(null)} onConfirm={(extra, word) => run(pending, { ...extra, word })} />
      )}
      {summary && <ResultDialog summary={summary} labelOf={labelOf} onClose={() => setSummary(null)} />}
    </>
  )
}
