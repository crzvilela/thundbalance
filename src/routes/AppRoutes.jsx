import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { LazyMotion } from 'framer-motion'

import Home from '../pages/Home'
const Login = lazy(() => import('../pages/Login'))
import ConsentBanner from '../components/ConsentBanner'
import SkipLink from '../components/SkipLink'
import BottomNav from '../components/BottomNav'
import { NotForTrainers, TrainerRoute } from '../roles/RoleGuards'
import UnknownOrAdmin from './UnknownOrAdmin'
const Register = lazy(() => import('../pages/Register'))
const Dashboard = lazy(() => import('../pages/Dashboard'))
const MySessions = lazy(() => import('../pages/MySessions'))
const ClientMessages = lazy(() => import('../pages/ClientMessages'))
const Profile = lazy(() => import('../pages/Profile'))
const TrainingTips = lazy(() => import('../pages/TrainingTips'))
const TrainerArea = lazy(() => import('../pages/TrainerArea'))
const TrialSession = lazy(() => import('../pages/Trialsession'))
const TrialConfirm = lazy(() => import('../pages/TrialConfirm'))
const RescheduleResponse = lazy(() => import('../pages/RescheduleResponse'))
const TrainingRequest = lazy(() => import('../pages/TrainingRequest'))
const LegalPage = lazy(() => import('../pages/LegalPage'))

// the animation code is a separate file that arrives after the first paint; until then the elements are drawn in their start state
const loadMotion = () => import('../components/motionFeatures').then(module => module.default)

function AppRoutes() {
  return (
    <BrowserRouter>
      <LazyMotion features={loadMotion} strict>

      <SkipLink />
      <Suspense fallback={<div className="min-h-dvh bg-black" aria-busy="true" />}>
      <Routes>

        <Route path="/" element={<Home />} />

        <Route path="/login" element={<Login />} />

        <Route path="/register" element={<Register />} />

        <Route path="/dashboard" element={<NotForTrainers><Dashboard /></NotForTrainers>} />

        
        
        <Route path="/my-sessions" element={<NotForTrainers><MySessions /></NotForTrainers>} />

        <Route path="/messages" element={<ClientMessages />} />

        
        <Route path="/profile" element={<Profile />} />
      
        <Route path="/training-tips" element={<TrainingTips />} />
      

        <Route path="/trial-session" element={<NotForTrainers><TrialSession /></NotForTrainers>}/>

        <Route path="/trial-session/confirm/:token" element={<TrialConfirm />}/>
        <Route path="/reschedule-response/:token" element={<RescheduleResponse />}/>

        <Route path="/training-request" element={<NotForTrainers><TrainingRequest /></NotForTrainers>}/>

        <Route path="/trainer" element={<TrainerRoute><TrainerArea /></TrainerRoute>} />

        <Route path="/privacy" element={<LegalPage page="privacy" />} />
        <Route path="/cookies" element={<LegalPage page="cookies" />} />
        <Route path="/legal-notice" element={<LegalPage page="legal" />} />
        <Route path="/terms" element={<LegalPage page="terms" />} />
        <Route path="/cancellations" element={<LegalPage page="cancellations" />} />
        {/* every other address: the ordinary 404, or (for the signed-in administrator only) the admin panel under its secret path */}
        <Route path="*" element={<UnknownOrAdmin />} />
      
      </Routes>
      </Suspense>
      <BottomNav />
      <ConsentBanner />
      </LazyMotion>

    </BrowserRouter>
  )
}

export default AppRoutes
