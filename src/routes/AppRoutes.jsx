import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

import Home from '../pages/Home'
import Login from '../pages/Login'
import Register from '../pages/Register'
import Dashboard from '../pages/Dashboard'
import MySessions from '../pages/MySessions'
import Profile from '../pages/Profile'
import LandingPageEditor from '../pages/admin/LandingPageEditor'
import AdminLayout from '../admin/AdminLayout'
import Overview from '../admin/pages/Overview'
import Requests from '../admin/pages/Requests'
import Clients from '../admin/pages/Clients'
import TrialSessions from '../admin/pages/TrialSessions'
import Calendar from '../admin/pages/Calendar'
import Trainers from '../admin/pages/Trainers'
import Plans from '../admin/pages/Plans'
import Videos from '../admin/pages/Videos'
import TrainingTips from '../pages/TrainingTips'
import TrialSession from '../pages/Trialsession'
import TrialConfirm from '../pages/TrialConfirm'
import TrainingRequest from '../pages/TrainingRequest'
import AdminLogin from '../pages/admin/AdminLogin'
import RequireAdmin from '../components/admin/RequireAdmin'

function AppRoutes() {
  return (
    <BrowserRouter>

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
        </Route>


        <Route path="/admin/landing-editor" element={<RequireAdmin><LandingPageEditor /></RequireAdmin>} />

        <Route path="/admin/training-videos" element={<Navigate to="/admin/videos" replace />} />

        <Route path="/training-tips" element={<TrainingTips />} />
      

        <Route path="/trial-session" element={<TrialSession />}/>

        <Route path="/trial-session/confirm/:token" element={<TrialConfirm />}/>

        <Route path="/training-request" element={<TrainingRequest />}/>
      
      </Routes>

    </BrowserRouter>
  )
}

export default AppRoutes
