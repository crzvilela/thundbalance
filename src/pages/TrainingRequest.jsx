import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from '../firebase/auth'
import Navbar from '../components/Navbar'
import TempPasswordNotice from '../components/TempPasswordNotice'
import PackSchedulePicker from '../components/forms/PackSchedulePicker'
import PackScheduleSummary from '../components/forms/PackScheduleSummary'
import { isComplete, toBody } from '../utils/packSchedule'
import { usePackAvailability } from '../utils/usePackAvailability'
import { API_URL } from '../config'
import { useI18n } from '../i18n/I18nContext'
import SessionTypeSection, { PriceSummary } from '../components/forms/SessionTypeSection'
import { formatMoney, packQuote, packsOfType, sessionTypeBody } from '../utils/pricing'
import { secondPersonProblems, usePricing } from '../utils/usePricing'
import { formText } from '../i18n/formText'

function TrainingRequest() {
  const navigate = useNavigate()
  const { t, language } = useI18n()
  const { prices } = usePricing()
  const [kind, setKind] = useState({ type: 'individual', name: '', email: '' })
  const [kindErrors, setKindErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [packId, setPackId] = useState('')                 // a pack of the catalogue (the first one of the type until another is chosen)

  const [sessionsPerWeek, setSessionsPerWeek] = useState('1')

  // The schedule: ONE ENTRY PER TRAINING DAY, each with its own hour (only free hours) and its own trainer (optional here: the
  // studio assigns it when approving). There is no single hour for the whole pack.
  const [entries, setEntries] = useState([])
  const availability = usePackAvailability()
  const [problem, setProblem] = useState('')                    // a translation key, shown in the page (no alert boxes)

  // Only the packs ON SALE of the chosen type (the catalogue, edited in Admin > Packs); the sessions per week are the ones the pack offers.
  const typePacks = packsOfType(prices, kind.type)
  const chosenPack = typePacks.find(pack => String(pack.id) === packId) || typePacks[0] || null
  const perWeekOptions = chosenPack ? chosenPack.sessions_per_week_options : []
  const effectivePerWeek = perWeekOptions.includes(Number(sessionsPerWeek)) ? sessionsPerWeek : String(perWeekOptions[0] || 1)

  // What the pack would cost: preview only, the server works the price out again
  const quote = packQuote(chosenPack, effectivePerWeek)
  const sessions = quote.sessions

  const handleSubmit = async () => {

    if (!auth.currentUser) { navigate('/login'); return }
    setProblem('')
    if (!isComplete(entries, effectivePerWeek, { trainerRequired: false })) { setProblem('ps_choose_hours'); return }
    const second = secondPersonProblems(kind)
    if (second.name || second.email) {
      setKindErrors({ name: second.name && formText(language, second.name), email: second.email && formText(language, second.email) })
      return
    }
    if (!chosenPack || quote.perSession == null) { setProblem('st_no_price'); return }
    setSubmitting(true)

    try {
      const token = await auth.currentUser.getIdToken()

      const response = await fetch(
        `${API_URL}/client-requests`,
        {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },

          body: JSON.stringify({

            pack_id: chosenPack.id,

            sessions_per_week: parseInt(effectivePerWeek),

            // one entry per day: weekday, hour and (optionally) trainer
            schedule: toBody(entries),
            // only the kind of session: the server works the price out itself
            ...sessionTypeBody(kind)

          })

        }
      )

      if (!response.ok) {

        const body = await response.json().catch(() => ({}))

        if (response.status === 409 && body.detail?.code === 'schedule_unavailable') {
          availability.reload()                      // somebody took an hour or a trainer a moment ago: read the free ones again
          setProblem('ps_race')
          return
        }
        const field = body.detail?.field
        if (field === 'second_person_name' || field === 'second_person_email') {
          setKindErrors({ [field === 'second_person_name' ? 'name' : 'email']: String(body.detail.message || '') })
          return
        }
        setProblem(typeof body.detail === 'string' ? `msg:${body.detail}` : 'tr_err_send')

        return

      }

      await response.json()

      navigate('/dashboard')

    } catch (error) {

      console.log(error)

      setProblem(error instanceof TypeError ? 'tr_err_generic' : `msg:${error.message || t('tr_err_generic')}`)

    } finally {
      setSubmitting(false)
    }

  }

  return (

    <div className="min-h-screen bg-black text-white">

      <Navbar />

      <div className="max-w-4xl mx-auto pt-28 sm:pt-36 px-5 sm:px-6 pb-16">

        <TempPasswordNotice />

        <h1
          style={{ fontFamily: 'Bebas Neue' }}
          className="text-4xl sm:text-6xl mb-8 sm:mb-12"
        >
          {t('tr_title')}
        </h1>

        <div className="border border-white/10 p-5 sm:p-10 rounded-2xl">

          <div className="mb-8">
            <SessionTypeSection
              value={kind} errors={kindErrors} disabled={submitting}
              onChange={patch => { setKind(current => ({ ...current, ...patch })); setKindErrors({}) }}
            />
          </div>

          <div className="mb-8">

            <label className="block mb-2 text-gray-400">
              {t('tr_package')}
            </label>

            <select
              value={chosenPack ? String(chosenPack.id) : ''}
              onChange={(e) =>
                setPackId(e.target.value)
              }
              className="w-full bg-black border border-white/20 p-4"
            >
              {typePacks.map(pack => <option key={pack.id} value={pack.id}>{pack.name}</option>)}

            </select>


          </div>

          <div className="mb-8">

            <label className="block mb-2 text-gray-400">
              {t('tr_sessions_week')}
            </label>

            <select
              value={effectivePerWeek}
              onChange={(e) =>
                setSessionsPerWeek(
                  e.target.value
                )
              }
              className="w-full bg-black border border-white/20 p-4"
            >
              {(perWeekOptions.length ? perWeekOptions : [1]).map(value => <option key={value} value={value}>{value}</option>)}
            </select>

          </div>

          <div className="mb-8">

            <PackSchedulePicker
              value={entries} onChange={setEntries} perWeek={Number(effectivePerWeek)} availability={availability}
              text={t} dayLabel={day => t(`wd_${day}`)} variant="site" trainerRequired={false} disabled={submitting}
            />

            <PackScheduleSummary
              className="mt-6 rounded-xl border border-white/10 p-4" value={entries} availability={availability.data}
              text={t} dayLabel={day => t(`wd_${day}`)} locale={language}
            />
            {entries.length > 0 && <p className="mt-2 text-sm text-gray-500">{t('ps_note')}</p>}

          </div>

          <div className="mb-8">
            <PriceSummary
              title={t('st_summary')}
              rows={[
                { label: t('st_package'), value: chosenPack?.name || '—' },
                { label: t('st_type_row'), value: t(kind.type === 'dual' ? 'st_dual' : 'st_individual') },
                { label: t('st_sessions'), value: sessions },
                { label: t('st_price_session'), value: formatMoney(quote.perSession) },
                { label: t('st_price_total'), value: formatMoney(quote.total), strong: true }
              ]}
              note={quote.perSession == null && prices ? t('st_no_price') : (kind.type === 'dual' ? t('st_price_both') : undefined)}
            />
          </div>

          {problem && (
            <p role="alert" className="mb-6 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{problem.startsWith('msg:') ? problem.slice(4) : t(problem)}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || !chosenPack}
            className="w-full sm:w-auto bg-white text-black px-8 py-4 uppercase tracking-[3px] hover:bg-gray-300 transition duration-300"
          >
            {submitting ? t('tr_submitting') : chosenPack ? t('tr_submit') : t('tr_unavailable')}
          </button>

        </div>

      </div>

    </div>

  )

}

export default TrainingRequest
