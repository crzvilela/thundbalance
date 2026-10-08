import { useCallback, useEffect, useState } from 'react'
import { signOut } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import ClientNotices from '../components/ClientNotices'
import TempPasswordNotice from '../components/TempPasswordNotice'
import { auth } from '../firebase/auth'
import { API_URL } from '../config'
import { useI18n } from '../i18n/I18nContext'

const card = 'border border-white/10 bg-white/[0.03] p-6 rounded-2xl'

function Dashboard() {
  const navigate = useNavigate()
  const { t, locale } = useI18n()
  const [workflow, setWorkflow] = useState(null)
  const [error, setError] = useState('')

  const loadWorkflow = useCallback(async () => {
    const user = auth.currentUser
    if (!user) { navigate('/login'); return }
    try {
      const token = await user.getIdToken()
      const response = await fetch(`${API_URL}/client/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error(response.status === 404 ? 'dash_err_profile' : 'dash_err_status')
      setWorkflow(await response.json())
      setError('')
    } catch (err) { setError(err.message || 'dash_err_generic') }
  }, [navigate])

  useEffect(() => {
    loadWorkflow()
    const refresh = () => loadWorkflow()
    const timer = window.setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [loadWorkflow])

  const logout = async () => { await signOut(auth); navigate('/login') }
  const nowStamp = (() => {
    const now = new Date()
    const pad = (number) => String(number).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  })()
  // Only sessions that have not started yet count as upcoming.
  const upcoming = workflow?.sessions?.filter(session => session.status === 'Booked' && `${session.date} ${String(session.time).slice(0, 5)}` >= nowStamp) || []
  const nextSession = upcoming[0]
  const state = workflow?.state

  return <div className="min-h-screen bg-black text-white"><Navbar />
    <main className="max-w-7xl mx-auto px-5 sm:px-6 pt-28 sm:pt-36 pb-20">
      <TempPasswordNotice />
      <header className="flex flex-wrap justify-between items-center gap-4 mb-8 sm:mb-10">
        <div><p className="text-green-400 uppercase tracking-[3px] text-sm">{t('dash_client_space')}</p><h1 style={{ fontFamily: 'Bebas Neue' }} className="text-5xl sm:text-6xl">{t('dash_title')}</h1></div>
        <button onClick={logout} className="border border-white/20 px-5 py-3 rounded-lg">{t('dash_logout')}</button>
      </header>
      <section className="mb-8">
        <p className="text-gray-400">{t('dash_welcome', { name: auth.currentUser?.displayName || auth.currentUser?.email })}</p>
      </section>

      {!workflow && !error && <div className={card} role="status">{t('dash_loading')}</div>}
      {error && <div className={`${card} border-amber-500/40`} role="alert"><h2 className="text-2xl mb-2">{t('dash_unavailable')}</h2><p className="text-gray-300 mb-5">{t(error)}</p><button onClick={loadWorkflow} className="bg-white text-black px-5 py-3 rounded-lg">{t('pg_try_again')}</button></div>}

      {workflow && state === 'new' && <section className={`${card} p-6! sm:p-10! md:p-14!`}>
        <p className="text-green-400 uppercase tracking-[3px] text-sm mb-3">{t('dash_next_step')}</p><h2 style={{ fontFamily: 'Bebas Neue' }} className="text-4xl sm:text-5xl md:text-6xl mb-4">{t('dash_choose_plan')}</h2>
        <p className="text-gray-300 max-w-2xl mb-8">{t('dash_choose_plan_text')}</p>
        <button onClick={() => navigate('/training-request')} className="w-full sm:w-auto bg-green-500 text-black font-semibold px-8 py-4 rounded-lg">{t('dash_start_request')} <span aria-hidden="true">→</span></button>
      </section>}

      {workflow && state === 'pending' && <section className={`${card} p-6! sm:p-10! md:p-14!`}>
        <p className="text-amber-300 uppercase tracking-[3px] text-sm mb-3">{t('dash_request_no', { id: workflow.request?.id })}</p><h2 style={{ fontFamily: 'Bebas Neue' }} className="text-4xl sm:text-5xl md:text-6xl mb-4">{t('dash_req_status')}</h2>
        <div className="inline-flex items-center gap-3 rounded-full border border-amber-300/30 bg-amber-300/10 px-5 py-3 mb-5"><span className="w-2.5 h-2.5 bg-amber-300 rounded-full"/><strong>{t('dash_pending')}</strong></div>
        <p className="text-gray-300 max-w-2xl">{t('dash_pending_text')}</p>
        <div className="mt-8 text-gray-400">{workflow.request?.package} · {t('dash_sessions_week', { n: workflow.request?.sessions_per_week })}</div>
      </section>}

      {workflow && state === 'rejected' && <section className={`${card} p-6! sm:p-10! md:p-14!`}>
        <p className="text-gray-400 uppercase tracking-[3px] text-sm mb-3">{t('dash_update')}</p><h2 style={{ fontFamily: 'Bebas Neue' }} className="text-4xl sm:text-5xl md:text-6xl mb-4">{t('dash_declined')}</h2>
        <p className="text-gray-300 max-w-2xl">{workflow.request?.reason || t('dash_declined_default')}</p>
        <button onClick={() => navigate('/training-request')} className="mt-8 w-full sm:w-auto bg-white text-black font-semibold px-8 py-4 rounded-lg">{t('dash_submit_new')}</button>
      </section>}

      {workflow && (state === 'active' || state === 'approved') && <>
        <ClientNotices workflow={workflow} />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <article className={card}><p className="text-gray-400 mb-2">{t('dash_trainer')}</p><h2 className="text-2xl">{workflow.plan?.trainer || workflow.request?.trainer || t('dash_being_assigned')}</h2></article>
          <article className={card}><p className="text-gray-400 mb-2">{t('dash_next_session')}</p><h2 className="text-xl">{nextSession ? new Date(`${nextSession.date}T00:00:00`).toLocaleDateString(locale) : t('dash_to_schedule')}</h2><p className="text-gray-400">{nextSession?.time || ''}</p></article>
          <article className={card}><p className="text-gray-400 mb-2">{t('dash_package')}</p><h2 className="text-2xl">{workflow.plan?.name || workflow.request?.package || t('dash_assigned_plan')}</h2></article>
          <article className={card}><p className="text-gray-400 mb-2">{t('dash_remaining')}</p><h2 className="text-3xl">{workflow.sessions_remaining}</h2></article>
        </div>
        <section className={card}><h2 style={{ fontFamily: 'Bebas Neue' }} className="text-4xl mb-5">{t('dash_upcoming')}</h2>
          {upcoming.length ? <div className="divide-y divide-white/10">{upcoming.map(session => <div key={session.id} className="py-4 flex flex-wrap justify-between gap-2"><span>{new Date(`${session.date}T00:00:00`).toLocaleDateString(locale)}</span><span className="text-gray-400">{session.time}</span><span className="text-gray-400">{session.trainer || workflow.plan?.trainer || t('dash_trainer_word')}</span><span className="text-green-400">{session.status === 'Booked' ? t('dash_booked') : session.status}</span></div>)}</div> : <p className="text-gray-400">{t('dash_preparing')}</p>}
          <button onClick={() => navigate('/my-sessions')} className="mt-6 border border-white/20 px-5 py-3 rounded-lg">{t('dash_view_all')}</button>
        </section>
      </>}
    </main>
  </div>
}

export default Dashboard
