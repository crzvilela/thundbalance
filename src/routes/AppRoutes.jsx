import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

import Home from '../pages/Home'
import Login from '../pages/Login'
import RequireAdmin from '../components/admin/RequireAdmin'
const Register = lazy(() => import('../pages/Register'))
const Dashboard = lazy(() => import('../pages/Dashboard'))
const MySessions = lazy(() => import('../pages/MySessions'))
const Profile = lazy(() => import('../pages/Profile'))
const LandingPageEditor = lazy(() => import('../pages/admin/LandingPageEditor'))
const AdminLayout = lazy(() => import('../admin/AdminLayout'))
const Overview = lazy(() => import('../admin/pages/Overview'))
const Requests = lazy(() => import('../admin/pages/Requests'))
const Clients = lazy(() => import('../admin/pages/Clients'))
const TrialSessions = lazy(() => import('../admin/pages/TrialSessions'))
const Calendar = lazy(() => import('../admin/pages/Calendar'))
const Trainers = lazy(() => import('../admin/pages/Trainers'))
const Plans = lazy(() => import('../admin/pages/Plans'))
const Videos = lazy(() => import('../admin/pages/Videos'))
const Messages = lazy(() => import('../admin/pages/Messages'))
const TrainingTips = lazy(() => import('../pages/TrainingTips'))
const TrialSession = lazy(() => import('../pages/Trialsession'))
const TrialConfirm = lazy(() => import('../pages/TrialConfirm'))
const RescheduleResponse = lazy(() => import('../pages/RescheduleResponse'))
const TrainingRequest = lazy(() => import('../pages/TrainingRequest'))
const AdminLogin = lazy(() => import('../pages/admin/AdminLogin'))

function AppRoutes() {
  return (
    <BrowserRouter>

      <Suspense fallback={<div className="min-h-screen bg-black" aria-busy="true" />}>
      <Routes>

        <Route path="/" element={<Home />} />

        <Route path="/login" element={<Login />} />

        <Route path="/register" element={<Register />} />

        <Route path="/dashboard" element={<Dashboard />} />

        
        
        <Route path="/my-sessions" element={<MySessions />} />

        
        <Route path="/profile" element={<Profile />} />
      
        <Route path="/admin/login" element={<AdminLogin />} />

        <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
          <Route index element={<Overview />} />
          <Route path="requests" element={<Requests />} />
          <Route path="trials" element={<TrialSessions />} />
          <Route path="clients" element={<Clients />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="trainers" element={<Trainers />} />
          <Route path="sessions" element={<Navigate to="/admin/calendar" replace />} />
          <Route path="plans" element={<Plans />} />
          <Route path="videos" element={<Videos />} />
          <Route path="messages" element={<Messages />} />
        </Route>


        <Route path="/admin/landing-editor" element={<RequireAdmin><LandingPageEditor /></RequireAdmin>} />

        <Route path="/admin/training-videos" element={<Navigate to="/admin/videos" replace />} />

        <Route path="/training-tips" element={<TrainingTips />} />
      

        <Route path="/trial-session" element={<TrialSession />}/>

        <Route path="/trial-session/confirm/:token" element={<TrialConfirm />}/>
        <Route path="/reschedule-response/:token" element={<RescheduleResponse />}/>

        <Route path="/training-request" element={<TrainingRequest />}/>
      
      </Routes>
      </Suspense>

    </BrowserRouter>
  )
}

export default AppRoutes
