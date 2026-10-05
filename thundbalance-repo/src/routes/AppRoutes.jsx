import { BrowserRouter, Routes, Route } from 'react-router-dom'

import Home from '../pages/Home'
import Login from '../pages/Login'
import Register from '../pages/Register'
import Dashboard from '../pages/Dashboard'
import BookSession from '../pages/BookSession'
import MySessions from '../pages/MySessions'
import Profile from '../pages/Profile'
import Admin from '../pages/Admin'
import ChoosePlan from '../pages/ChoosePlan'
import TrialSession from '../pages/Trialsession'
import TrainingRequest from '../pages/TrainingRequest'

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
      
        <Route path="/admin" element={<Admin />} />
      
        <Route path="/choose-plan" element={<ChoosePlan />} />

        <Route path="/trial-session" element={<TrialSession />}/>

        <Route path="/training-request" element={<TrainingRequest />}/>
      
      </Routes>

    </BrowserRouter>
  )
}

export default AppRoutes