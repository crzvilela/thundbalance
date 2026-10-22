import { useEffect, useRef } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase/auth'
import { useI18n } from '../i18n/I18nContext'
import { saveMyLanguage } from '../api/language'

// Invisible. When a client is signed in, sends the site language to the server once per (account, language): on sign-in and
// each time they change it. Infrequent by construction (no repeated calls while nothing changes) and it never blocks the page.
export default function LanguageSync() {
  const { language } = useI18n()
  const sent = useRef('')
  const latest = useRef(language)

  useEffect(() => {
    latest.current = language
    const user = auth.currentUser
    if (!user) return
    const key = `${user.uid}:${language}`
    if (sent.current === key) return
    sent.current = key
    saveMyLanguage(language)
  }, [language])

  useEffect(() => onAuthStateChanged(auth, user => {
    if (!user) { sent.current = ''; return }
    const key = `${user.uid}:${latest.current}`
    if (sent.current === key) return
    sent.current = key
    saveMyLanguage(latest.current)
  }), [])

  return null
}
