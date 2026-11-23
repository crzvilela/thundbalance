import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './fonts.css'
import './index.css'
import { installKeyboardScroll } from './utils/keyboardScroll'

installKeyboardScroll()          // a phone's keyboard never covers the field being typed in

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)