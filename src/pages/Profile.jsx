import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { onAuthStateChanged, updateProfile } from 'firebase/auth'
import { auth } from '../firebase/auth'
import Navbar from '../components/Navbar'
import { LandingContentProvider } from '../content/LandingContentContext'
import { API_URL, ADMIN_EMAIL } from '../config'
import { resolveImageUrl } from '../api/landingPage'
import { uploadProfilePhoto } from '../api/profilePhoto'

const fields = [
  ['codigo_pais', 'Country code', '+34', 'tel-country-code'],
  ['telefone', 'Phone number', 'Your phone number', 'tel-national'],
  ['cidade', 'City', 'Your city', 'address-level2'],
  ['cep', 'Postal code', 'Your postal code', 'postal-code'],
  ['morada', 'Address', 'Street and house number', 'street-address'],
]
const button = 'rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-wait'

function Profile() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [draft, setDraft] = useState(null)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fileInput = useRef(null)

  useEffect(() => {
    let active = true
    const unsubscribe = onAuthStateChanged(auth, async currentUser => {
      if (!currentUser) { navigate('/login', { replace: true }); return }
      setUser(currentUser)
      try {
        const response = await fetch(`${API_URL}/users/email/${encodeURIComponent(currentUser.email)}`)
        if (!response.ok) throw new Error('Could not load your account.')
        const account = await response.json()
        const result = await fetch(`${API_URL}/profile/${account.id}`)
        if (!result.ok) throw new Error('Could not load your profile. Please try again.')
        const data = await result.json()
        if (!data.id) throw new Error('Your profile is not available yet.')
        if (active) { setProfile(data); setDraft(data) }
      } catch (err) { if (active) setError(err.message) }
      finally { if (active) setLoading(false) }
    })
    return () => { active = false; unsubscribe() }
  }, [navigate])

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const save = async event => {
    event.preventDefault()
    setSaving(true); setError(''); setNotice('')
    try {
      const token = await auth.currentUser.getIdToken()
      const response = await fetch(`${API_URL}/profile/${profile.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(Object.fromEntries(fields.map(([key]) => [key, draft[key] || ''])))
      })
      const result = await response.json()
      if (!response.ok || result.error) throw new Error('Could not save your changes. Please try again.')
      setProfile(draft); setEditing(false); setNotice('Your profile has been updated.')
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const uploadPhoto = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(''); setNotice('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP image up to 5 MB.'); return
    }
    setPreview(URL.createObjectURL(file)); setUploading(true)
    try {
      const currentUser = auth.currentUser
      if (!currentUser) throw new Error('Inicie sessão novamente para carregar a foto.')
      const token = await currentUser.getIdToken()
      const photoUrl = await uploadProfilePhoto({
        apiUrl: API_URL, userId: profile.id, token, file,
      })
      setProfile(previous => ({ ...previous, foto: photoUrl }))
      setDraft(previous => ({ ...previous, foto: photoUrl }))
      try {
        await updateProfile(currentUser, { photoURL: resolveImageUrl(photoUrl) })
        window.dispatchEvent(new Event('profile-photo-updated'))
        setNotice('Your profile photo has been updated.')
      } catch {
        setNotice('Photo saved. Your menu photo will update when you sign in again.')
      }
    } catch (err) { setError(err.message) }
    finally { setUploading(false); setPreview('') }
  }

  const isAdmin = user?.email?.trim().toLowerCase() === ADMIN_EMAIL
  const name = profile?.nome || user?.displayName || 'Your profile'
  const photo = preview || resolveImageUrl(profile?.foto) || user?.photoURL

  return <LandingContentProvider mode="view" version="published">
    <div className="min-h-screen bg-[#080a09] text-white">
      <Navbar />
      <main className="relative mx-auto max-w-6xl px-5 pb-20 pt-36 md:pt-44">
        <div className="pointer-events-none absolute left-0 top-20 h-64 w-64 rounded-full bg-emerald-500/5 blur-3xl" />
        <header className="relative mb-9">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">Your account</p>
          <h1 className="text-5xl md:text-6xl" style={{ fontFamily: 'Bebas Neue' }}>Profile</h1>
          <p className="mt-3 text-sm text-gray-400">A little about you. Keep your details up to date.</p>
        </header>
        {error && <div role="alert" className="mb-6 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}{!profile && !loading && <button onClick={() => window.location.reload()} className="ml-4 underline">Try again</button>}</div>}
        {notice && <div role="status" className="mb-6 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">{notice}</div>}
        {loading && <div role="status" className="rounded-2xl border border-white/10 p-10 text-gray-400">Loading your profile…</div>}
        {profile && <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className="self-start overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]">
            <div className="h-24 bg-gradient-to-br from-emerald-500/25 via-emerald-800/15 to-transparent" />
            <div className="px-7 pb-8 text-center">
              <div className="relative mx-auto -mt-14 mb-5 flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-[#101512] bg-emerald-950 text-3xl font-semibold text-emerald-200">
                {photo ? <img src={photo} alt={`${name}'s profile`} className="h-full w-full object-cover" /> : name.split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase()}
              </div>
              <h2 className="break-words text-2xl font-semibold">{name}</h2>
              <p className="mt-2 break-all text-sm text-gray-400">{profile.email || user?.email}</p>
              <span className="mt-4 inline-block rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">{isAdmin ? 'Administrator' : 'Member'}</span>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPhoto} aria-label="Upload profile photo" className="hidden" />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading || saving} className={`${button} mt-6 w-full border border-white/15 hover:bg-white/10`}>{uploading ? 'Uploading photo…' : 'Change photo'}</button>
              <p className="mt-3 text-xs text-gray-500">JPG, PNG or WebP · Up to 5 MB</p>
              <div className="mt-7 border-t border-white/10 pt-6 text-left">
                <p className="text-xs uppercase tracking-wider text-gray-500">Current plan</p>
                <p className="mt-2 text-sm font-medium">{profile.plano || 'No plan assigned'}</p>
                <p className="mt-4 text-xs text-gray-500">Member #{profile.id}</p>
              </div>
              {isAdmin && <Link to="/admin" className={`${button} mt-6 block bg-emerald-400 text-black hover:bg-emerald-300`}>Admin →</Link>}
            </div>
          </aside>
          <form onSubmit={save} className="self-start rounded-3xl border border-white/10 bg-white/[0.025] p-6 md:p-9">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
              <div><h2 className="text-xl font-semibold">Personal details</h2><p className="mt-2 text-sm text-gray-500">Your contact and address information.</p></div>
              {!editing && <button type="button" onClick={() => { setDraft(profile); setEditing(true); setNotice('') }} className={`${button} border border-white/15 hover:bg-white/10`}>Edit profile</button>}
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              {fields.map(([key, label, placeholder, autoComplete]) => <div key={key} className={key === 'morada' ? 'sm:col-span-2' : ''}>
                <label htmlFor={`profile-${key}`} className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">{label}</label>
                {editing ? <input id={`profile-${key}`} autoComplete={autoComplete} type={key === 'telefone' || key === 'codigo_pais' ? 'tel' : 'text'} value={draft[key] || ''} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} placeholder={placeholder} disabled={saving} className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/10" /> : <p className={`min-h-12 rounded-xl bg-white/[0.025] px-4 py-3 text-sm ${profile[key] ? 'text-gray-200' : 'text-gray-500'}`}>{profile[key] || 'Not provided'}</p>}
              </div>)}
            </div>
            {editing && <div className="mt-8 flex justify-end gap-3 border-t border-white/10 pt-6">
              <button type="button" disabled={saving} onClick={() => { setDraft(profile); setEditing(false) }} className={`${button} border border-white/15 hover:bg-white/10`}>Cancel</button>
              <button type="submit" disabled={saving || uploading} className={`${button} bg-emerald-400 text-black hover:bg-emerald-300`}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>}
          </form>
        </div>}
      </main>
    </div>
  </LandingContentProvider>
}

export default Profile
