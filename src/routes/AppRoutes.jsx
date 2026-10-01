import { BrowserRouter, Routes, Route } from 'react-router-dom'

import Home from '../pages/Home'
import Login from '../pages/Login'
import Register from '../pages/Register'
import Dashboard from '../pages/Dashboard'
import BookSession from '../pages/BookSession'
import MySessions from '../pages/MySessions'
import Profile from '../pages/Profile'
import Admin from '../pages/Admin'
import FooterEditor from '../pages/admin/FooterEditor'
import LandingPageEditor from '../pages/admin/LandingPageEditor'
import TrainingVideosManager from '../pages/admin/TrainingVideosManager'
import TrainingTips from '../pages/TrainingTips'
import ChoosePlan from '../pages/ChoosePlan'
import TrialSession from '../pages/Trialsession'
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

        <Route path="/book-session" element={<BookSession />} />
        
        
        <Route path="/my-sessions" element={<MySessions />} />

        
        <Route path="/profile" element={<Profile />} />
      
        <Route path="/admin/login" element={<AdminLogin />} />

        <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />

        <Route path="/admin/footer" element={<RequireAdmin><FooterEditor /></RequireAdmin>} />

        <Route path="/admin/landing-editor" element={<RequireAdmin><LandingPageEditor /></RequireAdmin>} />

        <Route path="/admin/training-videos" element={<RequireAdmin><TrainingVideosManager /></RequireAdmin>} />

        <Route path="/training-tips" element={<TrainingTips />} />
      
        <Route path="/choose-plan" element={<ChoosePlan />} />

        <Route path="/trial-session" element={<TrialSession />}/>

        <Route path="/training-request" element={<TrainingRequest />}/>
      
      </Routes>

    </BrowserRouter>
  )
}

export default AppRoutes
