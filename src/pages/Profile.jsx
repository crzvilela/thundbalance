import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { onAuthStateChanged, updateProfile } from 'firebase/auth'
import { auth } from '../firebase/auth'
import Navbar from '../components/Navbar'
import ChangePassword from '../components/ChangePassword'
import TempPasswordNotice from '../components/TempPasswordNotice'
import { markPasswordChanged } from '../api/account'
import { LandingContentProvider } from '../content/LandingContentContext'
import { API_URL, ADMIN_EMAIL } from '../config'
import { authFetch } from '../api/authFetch'
import { resolveImageUrl } from '../api/landingPage'
import { uploadProfilePhoto } from '../api/profilePhoto'
import { useI18n } from '../i18n/I18nContext'
import { DEFAULT_TAX_ID_TYPE, normalizeTaxId } from '../utils/taxId'
import FormField from '../components/forms/FormField'
import { INPUT_CLASS, inputBorder } from '../components/forms/inputStyles'
import PhoneInput from '../components/forms/PhoneInput'
import PostalCodeInput from '../components/forms/PostalCodeInput'
import TaxIdInput from '../components/forms/TaxIdInput'
import { focusFirstInvalid } from '../components/forms/focusFirstInvalid'
import { formText, serverFieldError } from '../i18n/formText'
import { callingCodeOf, documentProblem, formatPhone, phoneProblem, postalCodeProblem, regionOfPhone } from '../utils/validators'

// [field, label key, placeholder (key, or literal when it has no key), autocomplete]
const fields = [
  ['telefone', 'pf_f_phone', 'pf_p_phone', 'tel-national'],
  ['cidade', 'pf_f_city', 'pf_p_city', 'address-level2'],
  ['cep', 'pf_f_postal', 'pf_p_postal', 'postal-code'],
  ['morada', 'pf_f_address', 'pf_p_address', 'street-address'],
  ['country', 'pf_f_nation', 'pf_p_nation', 'country-name'],
  ['tax_id_type', 'pf_f_doctype', '', 'off'],
  ['tax_id', 'pf_f_taxid', 'pf_p_taxid', 'off'],
]
const button = 'rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-wait'

function Profile() {
  const navigate = useNavigate()
  const { t, language } = useI18n()
  const [fieldErrors, setFieldErrors] = useState({})
  const formRef = useRef(null)
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
        const response = await authFetch(`${API_URL}/users/email/${encodeURIComponent(currentUser.email)}`)
        if (!response.ok) throw new Error('pf_err_account')
        const account = await response.json()
        const result = await authFetch(`${API_URL}/profile/${account.id}`)
        if (!result.ok) throw new Error('pf_err_profile')
        const data = await result.json()
        if (!data.id) throw new Error('pf_err_unavailable')
        if (active) { setProfile(data); setDraft(data) }
      } catch (err) { if (active) setError(err.message) }
      finally { if (active) setLoading(false) }
    })
    return () => { active = false; unsubscribe() }
  }, [navigate])

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const save = async event => {
    event.preventDefault()
    setError(''); setNotice('')
    if (saving) return
    // The same checks the server makes, so the answer comes before sending. A
    // phone or postal code left exactly as it was saved is not checked again
    // (old records keep saving without errors).
    const found = {}
    if ((draft.telefone || '') !== (profile.telefone || '')) {
      const code = phoneProblem(draft.telefone)
      if (code) found.telefone = formText(language, code)
    }
    if ((draft.cep || '') !== (profile.cep || '')) {
      const code = postalCodeProblem(draft.cep, regionOfPhone(draft.telefone) || 'ES', { required: false })
      if (code) found.cep = formText(language, code)
    }
    const document = documentProblem(draft.tax_id_type || DEFAULT_TAX_ID_TYPE, draft.tax_id)
    if (document) found.tax_id = formText(language, document)
    setFieldErrors(found)
    if (Object.keys(found).length) { focusFirstInvalid(formRef.current); return }
    setSaving(true)
    try {
      const token = await auth.currentUser.getIdToken()
      const response = await fetch(`${API_URL}/profile/${profile.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...Object.fromEntries(fields.map(([key]) => [key, draft[key] || ''])),
          // E.164 numbers carry their own country code; an untouched old number keeps the saved one
          codigo_pais: String(draft.telefone || '').startsWith('+') ? callingCodeOf(draft.telefone) : (draft.codigo_pais || ''),
          tax_id_type: draft.tax_id_type || DEFAULT_TAX_ID_TYPE,
          tax_id: normalizeTaxId(draft.tax_id),
        })
      })
      const result = await response.json().catch(() => ({}))
      const fieldError = response.status === 422 ? serverFieldError(result.detail, language) : null
      const fieldKey = fieldError && { phone: 'telefone', postal_code: 'cep', tax_id: 'tax_id' }[fieldError.field]
      if (fieldKey) {
        setFieldErrors({ [fieldKey]: fieldError.message })
        focusFirstInvalid(formRef.current)
        return
      }
      if (!response.ok || result.error) {
        // the server answers a bad document with a code the site translates
        const code = typeof result.detail === 'string' && result.detail.startsWith('tax_id_') ? `pf_${result.detail}` : 'pf_err_save'
        throw new Error(code)
      }
      const saved = { ...draft, tax_id: normalizeTaxId(draft.tax_id) || null, tax_id_type: normalizeTaxId(draft.tax_id) ? (draft.tax_id_type || DEFAULT_TAX_ID_TYPE) : null }
      if (String(saved.telefone || '').startsWith('+')) saved.codigo_pais = callingCodeOf(saved.telefone)
      setProfile(saved); setDraft(saved); setEditing(false); setFieldErrors({}); setNotice('pf_updated')
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const uploadPhoto = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(''); setNotice('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('pf_err_image'); return
    }
    setPreview(URL.createObjectURL(file)); setUploading(true)
    try {
      const currentUser = auth.currentUser
      if (!currentUser) throw new Error('pf_err_signin')
      const token = await currentUser.getIdToken()
      const photoUrl = await uploadProfilePhoto({
        apiUrl: API_URL, userId: profile.id, token, file,
      })
      setProfile(previous => ({ ...previous, foto: photoUrl }))
      setDraft(previous => ({ ...previous, foto: photoUrl }))
      try {
        await updateProfile(currentUser, { photoURL: resolveImageUrl(photoUrl) })
        window.dispatchEvent(new Event('profile-photo-updated'))
        setNotice('pf_photo_updated')
      } catch {
        setNotice('pf_photo_saved')
      }
    } catch (err) { setError(err.message) }
    finally { setUploading(false); setPreview('') }
  }

  const isAdmin = user?.email?.trim().toLowerCase() === ADMIN_EMAIL
  const name = profile?.nome || user?.displayName || t('pf_your_profile')
  const photo = preview || resolveImageUrl(profile?.foto) || user?.photoURL

  return <LandingContentProvider mode="view" version="published">
    <div className="min-h-screen bg-[#080a09] text-white">
      <Navbar />
      <main className="relative mx-auto max-w-6xl px-5 pb-20 pt-36 md:pt-44">
        <div className="pointer-events-none absolute left-0 top-20 h-64 w-64 rounded-full bg-emerald-500/5 blur-3xl" />
        <TempPasswordNotice showLink={false} />
        <header className="relative mb-9">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">{t('pf_eyebrow')}</p>
          <h1 className="text-5xl md:text-6xl" style={{ fontFamily: 'Bebas Neue' }}>{t('pf_title')}</h1>
          <p className="mt-3 text-sm text-gray-400">{t('pf_intro')}</p>
        </header>
        {error && <div role="alert" className="mb-6 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{t(error)}{!profile && !loading && <button onClick={() => window.location.reload()} className="ml-4 underline">{t('pg_try_again')}</button>}</div>}
        {notice && <div role="status" className="mb-6 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">{t(notice)}</div>}
        {loading && <div role="status" className="rounded-2xl border border-white/10 p-10 text-gray-400">{t('pf_loading')}</div>}
        {profile && <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className="self-start overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]">
            <div className="h-24 bg-gradient-to-br from-emerald-500/25 via-emerald-800/15 to-transparent" />
            <div className="px-7 pb-8 text-center">
              <div className="relative mx-auto -mt-14 mb-5 flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-[#101512] bg-emerald-950 text-3xl font-semibold text-emerald-200">
                {photo ? <img src={photo} alt={name} className="h-full w-full object-cover" /> : name.split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase()}
              </div>
              <h2 className="break-words text-2xl font-semibold">{name}</h2>
              <p className="mt-2 break-all text-sm text-gray-400">{profile.email || user?.email}</p>
              <span className="mt-4 inline-block rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">{isAdmin ? t('pf_admin') : t('pf_member')}</span>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPhoto} aria-label={t('pf_upload_aria')} className="hidden" />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading || saving} className={`${button} mt-6 w-full border border-white/15 hover:bg-white/10`}>{uploading ? t('pf_uploading') : t('pf_change_photo')}</button>
              <p className="mt-3 text-xs text-gray-500">{t('pf_photo_hint')}</p>
              <div className="mt-7 border-t border-white/10 pt-6 text-left">
                <p className="text-xs uppercase tracking-wider text-gray-500">{t('pf_current_plan')}</p>
                <p className="mt-2 text-sm font-medium">{profile.plano || t('pf_no_plan')}</p>
                <p className="mt-4 text-xs text-gray-500">{t('pf_member_no', { id: profile.id })}</p>
              </div>
              {isAdmin && <Link to="/admin" className={`${button} mt-6 block bg-emerald-400 text-black hover:bg-emerald-300`}>{t('pf_admin_link')}</Link>}
            </div>
          </aside>
          <div className="min-w-0 space-y-6 self-start">
          <form ref={formRef} onSubmit={save} noValidate className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 md:p-9">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
              <div><h2 className="text-xl font-semibold">{t('pf_details')}</h2><p className="mt-2 text-sm text-gray-500">{t('pf_details_text')}</p></div>
              {!editing && <button type="button" onClick={() => { setDraft(profile); setEditing(true); setNotice('') }} className={`${button} border border-white/15 hover:bg-white/10`}>{t('pf_edit')}</button>}
            </div>
            {editing ? <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {fields.map(([key, label, placeholder, autoComplete]) => {
                const set = value => { setDraft(previous => ({ ...previous, [key]: value })); if (fieldErrors[key]) setFieldErrors(previous => ({ ...previous, [key]: undefined })) }
                if (key === 'tax_id_type') return null
                if (key === 'telefone') return <div key={key} className="sm:col-span-2">
                  <PhoneInput label={t(label)} required language={language} value={draft.telefone || ''} fallbackCode={draft.codigo_pais || '+34'}
                    validate={(draft.telefone || '') !== (profile.telefone || '')} error={fieldErrors.telefone} disabled={saving} onChange={set} />
                </div>
                if (key === 'cep') return <div key={key}>
                  <PostalCodeInput label={t(label)} language={language} country={regionOfPhone(draft.telefone) || 'ES'} value={draft.cep || ''}
                    validate={(draft.cep || '') !== (profile.cep || '')} error={fieldErrors.cep} disabled={saving} onChange={set} />
                </div>
                if (key === 'tax_id') return <div key={key} className="sm:col-span-2">
                  <TaxIdInput label={t(label)} language={language} type={draft.tax_id_type || DEFAULT_TAX_ID_TYPE} value={draft.tax_id || ''}
                    error={fieldErrors.tax_id} disabled={saving} onChange={set}
                    onTypeChange={type => setDraft(previous => ({ ...previous, tax_id_type: type }))} />
                </div>
                return <div key={key} className={key === 'morada' ? 'sm:col-span-2' : ''}>
                  <FormField label={t(label)}>
                    {({ id, describedBy, invalid }) => <input id={id} autoComplete={autoComplete} type="text" maxLength={key === 'morada' ? 200 : 80}
                      value={draft[key] || ''} onChange={event => set(event.target.value)} placeholder={t(placeholder)} disabled={saving}
                      aria-describedby={describedBy} aria-invalid={invalid || undefined} className={`${INPUT_CLASS} ${inputBorder(invalid)}`} />}
                  </FormField>
                </div>
              })}
            </div> : <div className="grid gap-6 sm:grid-cols-2">
              {fields.map(([key, label]) => <div key={key} className={key === 'morada' ? 'sm:col-span-2' : ''}>
                <p className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">{t(label)}</p>
                <p className={`min-h-12 rounded-xl bg-white/[0.025] px-4 py-3 text-sm ${profile[key] ? 'text-gray-200' : 'text-gray-500'}`}>
                  {key === 'tax_id_type' ? (profile.tax_id_type ? t(`pf_doc_${profile.tax_id_type}`) : t('pf_not_provided'))
                    : key === 'telefone' ? (profile.telefone ? formatPhone(profile.telefone, profile.codigo_pais) : t('pf_not_provided'))
                      : (profile[key] || t('pf_not_provided'))}
                </p>
              </div>)}
            </div>}
            {editing && <div className="mt-8 flex justify-end gap-3 border-t border-white/10 pt-6">
              <button type="button" disabled={saving} onClick={() => { setDraft(profile); setEditing(false); setFieldErrors({}) }} className={`${button} border border-white/15 hover:bg-white/10`}>{t('pf_cancel')}</button>
              <button type="submit" disabled={saving || uploading} className={`${button} bg-emerald-400 text-black hover:bg-emerald-300`}>{saving ? t('pf_saving') : t('pf_save')}</button>
            </div>}
          </form>
          <ChangePassword user={user} onChanged={markPasswordChanged} />
          </div>
        </div>}
      </main>
    </div>
  </LandingContentProvider>
}

export default Profile
