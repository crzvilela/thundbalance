import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { downloadMyData, getDeletionRequest, requestDeletion } from '../api/privacy'

// "Mis datos" in the profile: a copy of the person's data (a JSON file) and the request to delete the account. The request deletes
// nothing: the studio reviews it and answers (pending / completed / rejected). A login whose e-mail is not verified is sent to the
// verification screen by the API layer, so nothing is shown here for that case.
const BUTTON = 'min-h-11 rounded-xl px-5 py-3 text-sm font-medium transition disabled:opacity-50'

export default function MyData() {
  const { t, language } = useI18n()
  const [request, setRequest] = useState(null)             // { status, created_at, reason } | null while it loads
  const [busy, setBusy] = useState('')                      // 'download' | 'delete'
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState({ tone: '', key: '' })

  useEffect(() => {
    let active = true
    getDeletionRequest().then(state => { if (active) setRequest(state) }).catch(() => { if (active) setRequest({ status: 'none' }) })
    return () => { active = false }
  }, [])

  const download = async () => {
    setBusy('download')
    setMessage({ tone: '', key: '' })
    try {
      await downloadMyData()
      setMessage({ tone: 'ok', key: 'pv_download_ok' })
    } catch (error) {
      if (error.code !== 'email_not_verified') setMessage({ tone: 'error', key: error.code === 'too_many_exports' ? 'pv_err_many' : 'pv_err_generic' })
    } finally {
      setBusy('')
    }
  }

  const ask = async () => {
    setBusy('delete')
    setMessage({ tone: '', key: '' })
    try {
      setRequest(await requestDeletion())
      setConfirming(false)
    } catch (error) {
      if (error.code !== 'email_not_verified') setMessage({ tone: 'error', key: 'pv_err_generic' })
    } finally {
      setBusy('')
    }
  }

  const status = request?.status || 'none'
  const pending = status === 'pending'
  const date = request?.created_at ? new Date(request.created_at).toLocaleDateString(language === 'es' ? 'es-ES' : language === 'ca' ? 'ca-ES' : 'en-GB') : ''

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 md:p-9" aria-labelledby="my-data-title">
      <h2 id="my-data-title" className="text-2xl font-semibold">{t('pv_title')}</h2>
      <p className="mt-2 text-sm text-gray-400">{t('pv_intro')}</p>

      <div className="mt-6">
        <button type="button" onClick={download} disabled={busy !== ''} className={`${BUTTON} border border-white/15 hover:bg-white/10`}>
          {busy === 'download' ? t('pv_working') : t('pv_download')}
        </button>
      </div>

      <div className="mt-8 border-t border-white/10 pt-6">
        <h3 className="text-sm font-medium uppercase tracking-wider text-gray-400">{t('pv_status_title')}</h3>
        {status !== 'none' && (
          <p role="status" className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            {status === 'rejected' ? t('pv_status_rejected', { reason: request.reason || '' }) : t(`pv_status_${status}`)}
            {date && <span className="mt-1 block text-xs text-amber-200/70">{t('pv_requested_on', { date })}</span>}
          </p>
        )}
        {!pending && !confirming && (
          <button type="button" onClick={() => setConfirming(true)} disabled={busy !== '' || request === null}
            className={`${BUTTON} mt-4 border border-red-400/30 text-red-200 hover:bg-red-500/10`}>
            {t('pv_delete_btn')}
          </button>
        )}
        {confirming && !pending && (
          <div role="alertdialog" aria-labelledby="my-data-confirm" className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/5 p-5">
            <p id="my-data-confirm" className="font-medium text-red-100">{t('pv_confirm_title')}</p>
            <p className="mt-2 text-sm leading-6 text-gray-300">{t('pv_delete_warn')}</p>
            <p className="mt-2 text-sm text-gray-400">{t('pv_deadline')}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => setConfirming(false)} disabled={busy !== ''} className={`${BUTTON} border border-white/15 hover:bg-white/10`}>{t('pv_cancel')}</button>
              <button type="button" onClick={ask} disabled={busy !== ''} className={`${BUTTON} bg-red-500 text-white hover:bg-red-400`}>
                {busy === 'delete' ? t('pv_working') : t('pv_confirm_yes')}
              </button>
            </div>
          </div>
        )}
      </div>

      {message.key && (
        <p role={message.tone === 'error' ? 'alert' : 'status'}
          className={`mt-6 rounded-xl border px-4 py-3 text-sm ${message.tone === 'error' ? 'border-red-400/25 bg-red-400/10 text-red-200' : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'}`}>
          {t(message.key)}
        </p>
      )}
    </section>
  )
}
