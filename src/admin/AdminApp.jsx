import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { adminUrl, setAdminPath } from './adminUrl.js'

// The whole admin panel, under the secret path (docs/ADMIN_ACCESS.md). This file and everything it loads is a separate chunk that the browser asks for ONLY
// after the server has said that the signed-in person is the administrator (routes/UnknownOrAdmin.jsx): a visitor, a client or a trainer never downloads it.
const LandingPageEditor = lazy(() => import('../pages/admin/LandingPageEditor'))
const AdminLayout = lazy(() => import('./AdminLayout'))
const Overview = lazy(() => import('./pages/Overview'))
const Requests = lazy(() => import('./pages/Requests'))
const Clients = lazy(() => import('./pages/Clients'))
const TrialSessions = lazy(() => import('./pages/TrialSessions'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Schedule = lazy(() => import('./pages/Schedule'))
const SentMessages = lazy(() => import('./pages/SentMessages'))
const Trainers = lazy(() => import('./pages/Trainers'))
const Plans = lazy(() => import('./pages/Plans'))
const Videos = lazy(() => import('./pages/Videos'))
const Messages = lazy(() => import('./pages/Messages'))
const AdminNotFound = lazy(() => import('./AdminNotFound'))
const SystemStatus = lazy(() => import('./pages/SystemStatus'))
const LegalTexts = lazy(() => import('./pages/LegalTexts'))
const TrainerPanelView = lazy(() => import('./pages/TrainerPanelView'))

export default function AdminApp({ base }) {
  setAdminPath(base)                      // before anything of the panel is drawn: every link reads it through adminUrl()

  // the panel is never for search engines (the path is not published anywhere, and this says so as well)
  useEffect(() => {
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    document.head.appendChild(robots)
    return () => { robots.remove(); setAdminPath('') }
  }, [])

  return (
    <Suspense fallback={<div className="min-h-dvh bg-black" aria-busy="true" />}>
      <Routes>
        <Route path={`/${base}`} element={<AdminLayout />}>
          <Route index element={<Overview />} />
          <Route path="requests" element={<Requests />} />
          <Route path="trials" element={<TrialSessions />} />
          <Route path="clients" element={<Clients />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="sent-messages" element={<SentMessages />} />
          <Route path="trainers" element={<Trainers />} />
          <Route path="trainers/:trainerId/panel" element={<TrainerPanelView />} />
          <Route path="sessions" element={<Navigate to={adminUrl('/calendar')} replace />} />
          <Route path="plans" element={<Plans />} />
          <Route path="videos" element={<Videos />} />
          <Route path="messages" element={<Messages />} />
          <Route path="system" element={<SystemStatus />} />
          <Route path="legal" element={<LegalTexts />} />
          <Route path="*" element={<AdminNotFound />} />
        </Route>
        <Route path={`/${base}/landing-editor`} element={<LandingPageEditor />} />
        <Route path={`/${base}/training-videos`} element={<Navigate to={adminUrl('/videos')} replace />} />
      </Routes>
    </Suspense>
  )
}
