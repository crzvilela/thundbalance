import { useEffect, useRef, useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { useFocusTrap } from './useFocusTrap'
import { loadDay } from '../api/schedule'
import { loadAvailableTrainers } from '../api/trainers'
import { Button, Icon } from './ui'

const fill = (text, values) => Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), text)
const todayKey = () => new Date().toISOString().slice(0, 10)

// "Restaurar sesión": puts a cancelled session of a pack back (POST /admin/sessions/{id}/restore). It keeps its number x/y.
//  1. confirm → the original day, hour and trainer are tried first;
//  2. if that hour is taken (or already past) the server says why and the admin picks ANOTHER day, hour and trainer
//     (only the trainers who are free then are offered) and restores there;
//  3. if the client already has another session at that hour the admin can confirm and restore anyway.
// session = { id, number, date: 'YYYY-MM-DD', time: 'HH:MM', trainer }
export default function RestoreSessionDialog({ session, onClose, onRestored }) {
  const { t } = useAdminText()
  const toast = useToast()
  const panel = useRef(null)
  const [step, setStep] = useState('confirm')            // confirm | choose
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')               // why the original slot does not work (the server's words, translated by code)
  const [overlap, setOverlap] = useState(false)          // the client has another session then: ask before restoring anyway
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [times, setTimes] = useState([])
  const [free, setFree] = useState(null)                 // trainers free at date + time, or null while it is not known
  const [trainer, setTrainer] = useState('')
  const [loading, setLoading] = useState(false)
  const working = useRef(false)

  useFocusTrap(panel, true)
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const pickDate = async (value) => {
    setDate(value); setTime(''); setTimes([]); setFree(null); setTrainer(''); setReason(r => r)
    if (!value) return
    setLoading(true)
    try {
      const list = await loadDay(value, { force: true })           // the hours when ANY trainer is free that day
      setTimes(list.map(item => String(item).slice(0, 5)))
    } catch {
      setTimes([])
    } finally {
      setLoading(false)
    }
  }

  const pickTime = async (value) => {
    setTime(value); setFree(null); setTrainer('')
    setLoading(true)
    try {
      const list = await loadAvailableTrainers({ date, time: value, excludeSessionId: session.id })
      setFree(list)
      const same = list.find(item => item.name === session.trainer)
      setTrainer(String((same || list[0])?.id || ''))               // the same trainer when he or she is free
    } catch {
      setFree([])
    } finally {
      setLoading(false)
    }
  }

  const send = async (body = {}) => {
    if (working.current) return
    working.current = true
    setBusy(true)
    try {
      const result = await adminRequest('POST', `/admin/sessions/${session.id}/restore`, body)
      if (result.restored === false) toast.push(t('rs_already'))
      else if (result.calendar && result.calendar.ok === false) toast.push(t('rs_google_failed'), 'warning')
      else toast.push(t('rs_done'))
      onRestored()
    } catch (error) {
      if (error.code === 'client_busy') { setOverlap(true); setReason(t('rs_client_busy')) }
      else if (error.code === 'past') { setReason(t('rs_past')); setStep('choose'); setOverlap(false) }
      else if (error.code === 'trainer_unavailable') { setReason(t('rs_taken')); setStep('choose'); setOverlap(false) }
      else toast.push(error.message, 'error')
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  const chosen = step === 'choose' ? { date, time, trainer_id: Number(trainer) } : {}
  const restoreHere = () => send({ ...chosen, ...(overlap ? { confirm_client_overlap: true } : {}) })
  const canRestore = step === 'confirm' || (date && time && trainer)
  const original = `${session.date.split('-').reverse().join('/')} · ${session.time}`
  const field = 'mt-2 min-h-[44px] w-full rounded-xl border border-white/15 bg-black/40 px-4 text-white outline-none focus:border-emerald-400/70'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!busy) onClose() }} />
      <div ref={panel} role="alertdialog" aria-modal="true" aria-label={t('rs_title')}
        className="admin-toast relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#0d1110] p-6 shadow-2xl sm:p-8">
        <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"><Icon name="refresh" /></span>
        <h2 className="text-xl font-semibold text-white sm:text-2xl">{t('rs_title')}</h2>
        <p className="mt-2 text-base text-gray-300">{fill(t('rs_text'), { number: session.number || '—', when: original })}</p>
        <p className="mt-1 text-sm text-gray-500">{t('rs_note')}</p>

        {reason && <p role="alert" className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/[0.08] px-4 py-3 text-sm text-amber-100">{reason}</p>}

        {step === 'choose' && (
          <div className="mt-4 space-y-4">
            <label className="block text-sm text-gray-300">{t('rs_new_date')}
              <input type="date" min={todayKey()} value={date} onChange={event => pickDate(event.target.value)} disabled={busy} style={{ colorScheme: 'dark' }} className={field} />
            </label>
            {date && (
              <div>
                <p className="mb-2 text-sm text-gray-300">{t('rs_new_time')}{loading && ' …'}</p>
                <div className="flex flex-wrap gap-2">
                  {times.map(value => (
                    <button key={value} type="button" onClick={() => pickTime(value)} aria-pressed={time === value} disabled={busy}
                      className={`min-h-[44px] rounded-xl border px-4 text-sm tabular-nums transition ${time === value ? 'border-emerald-400 bg-emerald-400 font-semibold text-black' : 'border-white/15 text-gray-200 hover:border-white/40'}`}>{value}</button>
                  ))}
                  {!loading && times.length === 0 && <p className="text-sm text-gray-500">{t('rs_no_times')}</p>}
                </div>
              </div>
            )}
            {time && free !== null && (free.length === 0
              ? <p role="alert" className="text-sm text-amber-200">{t('rs_none_free')}</p>
              : (
                <label className="block text-sm text-gray-300">{t('rs_trainer')}
                  <select value={trainer} onChange={event => setTrainer(event.target.value)} disabled={busy} className={field}>
                    {free.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
              ))}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="secondary" className="min-h-[44px] flex-1" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
          <Button variant="primary" className="min-h-[44px] flex-1" onClick={step === 'confirm' && !overlap ? () => send({}) : restoreHere} loading={busy} disabled={!canRestore}>
            {overlap ? t('rs_anyway') : t('rs_do')}
          </Button>
        </div>
      </div>
    </div>
  )
}
