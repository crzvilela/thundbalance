import { useCallback, useEffect, useState } from 'react'
import { signOut } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { auth } from '../firebase/auth'
import { API_URL } from '../config'

const card = 'border border-white/10 bg-white/[0.03] p-6 rounded-2xl'

function Dashboard() {
  const navigate = useNavigate()
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
      if (!response.ok) throw new Error(response.status === 404 ? 'Your client profile is still being created. Please refresh in a moment.' : 'We could not load your training status. Please try again.')
      setWorkflow(await response.json())
      setError('')
    } catch (err) { setError(err.message || 'Could not load your dashboard.') }
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
  const upcoming = workflow?.sessions?.filter(session => session.status === 'Booked') || []
  const nextSession = upcoming[0]
  const state = workflow?.state

  return <div className="min-h-screen bg-black text-white"><Navbar />
    <main className="max-w-7xl mx-auto px-6 pt-36 pb-20">
      <header className="flex justify-between items-center mb-10">
        <div><p className="text-green-400 uppercase tracking-[3px] text-sm">Client space</p><h1 style={{ fontFamily: 'Bebas Neue' }} className="text-6xl">Dashboard</h1></div>
        <button onClick={logout} className="border border-white/20 px-5 py-3 rounded-lg">Log out</button>
      </header>
      <section className="mb-8">
        <p className="text-gray-400">Welcome back, {auth.currentUser?.displayName || auth.currentUser?.email}</p>
      </section>

      {!workflow && !error && <div className={card} role="status">Loading your training journey…</div>}
      {error && <div className={`${card} border-amber-500/40`} role="alert"><h2 className="text-2xl mb-2">Your dashboard is temporarily unavailable</h2><p className="text-gray-300 mb-5">{error}</p><button onClick={loadWorkflow} className="bg-white text-black px-5 py-3 rounded-lg">Try again</button></div>}

      {workflow && state === 'new' && <section className={`${card} p-10 md:p-14`}>
        <p className="text-green-400 uppercase tracking-[3px] text-sm mb-3">Your next step</p><h2 style={{ fontFamily: 'Bebas Neue' }} className="text-5xl md:text-6xl mb-4">Choose your plan</h2>
        <p className="text-gray-300 max-w-2xl mb-8">Tell us what package and schedule work for you. Our team will review your training request and match you with a trainer.</p>
        <button onClick={() => navigate('/training-request')} className="bg-green-500 text-black font-semibold px-8 py-4 rounded-lg">Start your training request <span aria-hidden="true">→</span></button>
      </section>}

      {workflow && state === 'pending' && <section className={`${card} p-10 md:p-14`}>
        <p className="text-amber-300 uppercase tracking-[3px] text-sm mb-3">Request #{workflow.request?.id}</p><h2 style={{ fontFamily: 'Bebas Neue' }} className="text-5xl md:text-6xl mb-4">Training request status</h2>
        <div className="inline-flex items-center gap-3 rounded-full border border-amber-300/30 bg-amber-300/10 px-5 py-3 mb-5"><span className="w-2.5 h-2.5 bg-amber-300 rounded-full"/><strong>Pending approval</strong></div>
        <p className="text-gray-300 max-w-2xl">Your request is with our team. We’ll confirm your trainer and schedule once it’s reviewed. You don’t need to submit anything else right now.</p>
        <div className="mt-8 text-gray-400">{workflow.request?.package} · {workflow.request?.sessions_per_week} sessions per week</div>
      </section>}

      {workflow && state === 'rejected' && <section className={`${card} p-10 md:p-14`}>
        <p className="text-gray-400 uppercase tracking-[3px] text-sm mb-3">Request update</p><h2 style={{ fontFamily: 'Bebas Neue' }} className="text-5xl md:text-6xl mb-4">Your request was declined.</h2>
        <p className="text-gray-300 max-w-2xl">{workflow.request?.reason || 'Our team could not approve this request at this time. You can submit a new request with a different schedule or package.'}</p>
        <button onClick={() => navigate('/training-request')} className="mt-8 bg-white text-black font-semibold px-8 py-4 rounded-lg">Submit new request</button>
      </section>}

      {workflow && (state === 'active' || state === 'approved') && <>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <article className={card}><p className="text-gray-400 mb-2">Your trainer</p><h2 className="text-2xl">{workflow.plan?.trainer || workflow.request?.trainer || 'Being assigned'}</h2></article>
          <article className={card}><p className="text-gray-400 mb-2">Next session</p><h2 className="text-xl">{nextSession ? new Date(`${nextSession.date}T00:00:00`).toLocaleDateString() : 'To be scheduled'}</h2><p className="text-gray-400">{nextSession?.time || ''}</p></article>
          <article className={card}><p className="text-gray-400 mb-2">Package</p><h2 className="text-2xl">{workflow.plan?.name || workflow.request?.package || 'Assigned plan'}</h2></article>
          <article className={card}><p className="text-gray-400 mb-2">Sessions remaining</p><h2 className="text-3xl">{workflow.sessions_remaining}</h2></article>
        </div>
        <section className={card}><h2 style={{ fontFamily: 'Bebas Neue' }} className="text-4xl mb-5">Upcoming sessions</h2>
          {upcoming.length ? <div className="divide-y divide-white/10">{upcoming.map(session => <div key={session.id} className="py-4 flex flex-wrap justify-between gap-2"><span>{new Date(`${session.date}T00:00:00`).toLocaleDateString()}</span><span className="text-gray-400">{session.time}</span><span className="text-gray-400">{session.trainer || workflow.plan?.trainer || 'Trainer'}</span><span className="text-green-400">{session.status}</span></div>)}</div> : <p className="text-gray-400">Your trainer is preparing your upcoming sessions. They’ll appear here as soon as they’re scheduled.</p>}
          <button onClick={() => navigate('/my-sessions')} className="mt-6 border border-white/20 px-5 py-3 rounded-lg">View all sessions</button>
        </section>
      </>}
    </main>
  </div>
}

export default Dashboard
