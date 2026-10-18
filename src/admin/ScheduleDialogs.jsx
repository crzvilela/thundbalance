import { useRef, useState } from 'react'
import { API_URL } from '../config'
import { useAdminText } from './useAdminText'
import { dayKey, madridWallClock } from './calendar/calendarConfig'
import { NOTE_MAX } from './scheduleRequests'
import { Button, Drawer, Field, TextArea, TextInput } from './ui'

const subtitleOf = (item) => `${item.client_email} · ${item.number || ''}`.replace(/ · $/, '')

function NoteField({ value, onChange, busy, focus = false }) {
  const { t } = useAdminText()
  return (
    <Field label={t('sch_note_label')}>
      <TextArea rows={4} maxLength={NOTE_MAX} value={value} onChange={event => onChange(event.target.value)} placeholder={t('sch_note_ph')} disabled={busy} autoFocus={focus} />
      <p className="mt-1.5 text-right text-xs tabular-nums text-gray-500" aria-live="polite">{value.length}/{NOTE_MAX}</p>
    </Field>
  )
}

function ErrorLine({ message }) {
  return message ? <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{message}</p> : null
}

// "Rechazar": an optional note (up to 300 characters) the client reads in their email.
// Like the counter-proposal below, the body is mounted only while open, so every opening starts clean.
function RejectBody({ item, busy, error, onClose, onConfirm }) {
  const { t } = useAdminText()
  const [note, setNote] = useState('')
  return (
    <Drawer
      open onClose={onClose} busy={busy} title={t('sch_reject_title')} subtitle={item ? subtitleOf(item) : ''}
      footer={<>
        <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button variant="danger" className="flex-[2]" onClick={() => onConfirm(note.trim())} loading={busy}>{busy ? t('sch_rejecting') : t('sch_reject_do')}</Button>
      </>}
    >
      <p className="mb-6 text-sm text-gray-400">{t('sch_reject_sub')}</p>
      <NoteField value={note} onChange={setNote} busy={busy} focus />
      <ErrorLine message={error} />
    </Drawer>
  )
}

export function RejectDrawer({ item, ...rest }) {
  return item ? <RejectBody key={item.id} item={item} {...rest} /> : null
}

function CounterBody({ item, busy, error, onClose, onConfirm }) {
  const { t } = useAdminText()
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [times, setTimes] = useState([])
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState('')
  const [note, setNote] = useState('')
  const latest = useRef(0)

  const pickDate = async (value) => {
    setDate(value); setTime(''); setTimes([]); setProblem('')
    const mine = ++latest.current                       // a slow answer for an older date is ignored
    if (!value) return
    setLoading(true)
    try {
      // the trainer's free hours, straight from the database (the server checks again when sending)
      const response = await fetch(`${API_URL}/trainer/${item.trainer_id}/available-times/${value}`)
      const list = response.ok ? await response.json() : []
      if (mine !== latest.current) return
      const today = dayKey(madridWallClock())
      const nowTime = madridWallClock().toISOString().slice(11, 16)
      const free = list.map(entry => String(entry).slice(0, 5)).filter(entry => value !== today || entry > nowTime)
      setTimes(free)
      if (!free.length) setProblem(t('ac_no_times'))
    } catch {
      if (mine === latest.current) setProblem(t('ac_times_error'))
    } finally {
      if (mine === latest.current) setLoading(false)
    }
  }

  return (
    <Drawer
      open onClose={onClose} busy={busy} title={t('sch_counter_title')} subtitle={subtitleOf(item)}
      footer={<>
        <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button variant="primary" className="flex-[2]" onClick={() => onConfirm(date, time, note.trim())} loading={busy} disabled={!date || !time}>
          {busy ? t('sch_counter_sending') : t('sch_counter_do')}
        </Button>
      </>}
    >
      <p className="mb-6 text-sm text-gray-400">{t('sch_counter_sub').replace('{trainer}', item.trainer || '')}</p>
      <Field label={t('sch_pick_date')}>
        <TextInput type="date" min={dayKey(madridWallClock())} value={date} onChange={event => pickDate(event.target.value)} disabled={busy} autoFocus />
      </Field>
      {date && (
        <div className="mb-6">
          <p className="mb-2 text-sm font-medium text-gray-300">{t('sch_pick_time')}{loading && ` · ${t('ac_loading_times')}`}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('sch_pick_time')}>
            {times.map(entry => (
              <button key={entry} type="button" onClick={() => setTime(entry)} aria-pressed={time === entry} disabled={busy}
                className={`min-h-[44px] rounded-xl border px-4 py-2 text-sm tabular-nums transition ${time === entry ? 'border-emerald-400 bg-emerald-400 font-semibold text-black' : 'border-white/15 text-gray-200 hover:border-white/40'}`}>{entry}</button>
            ))}
          </div>
          {problem && <p className="mt-2 text-sm text-amber-300">{problem}</p>}
        </div>
      )}
      <NoteField value={note} onChange={setNote} busy={busy} />
      <ErrorLine message={error} />
    </Drawer>
  )
}

// "Proponer otra hora": a date, one of the trainer's free hours and an optional note.
export function CounterDrawer({ item, ...rest }) {
  return item ? <CounterBody key={item.id} item={item} {...rest} /> : null
}
