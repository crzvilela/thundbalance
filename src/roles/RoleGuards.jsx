import { Navigate } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext'
import { useRoles } from './rolesContext'

function Waiting({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center gap-3 bg-black text-gray-300" role="status">
      <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-emerald-400" />
      {children}
    </div>
  )
}

// /trainer: only an active trainer. A signed-out visitor or any other account goes to the home page.
// If the server can not be reached to know, the person can try again instead of being sent away.
export function TrainerRoute({ children }) {
  const { status, isTrainer, reload } = useRoles()
  const { t } = useI18n()
  if (status === 'loading') return <Waiting>{t('tr_checking')}</Waiting>
  if (status === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 text-center text-gray-200">
        <p>{t('tr_error_network')}</p>
        <button type="button" onClick={reload} className="min-h-[44px] rounded-xl border border-white/25 px-6 text-sm font-semibold uppercase tracking-wider hover:bg-white hover:text-black">{t('tr_retry')}</button>
      </div>
    )
  }
  return isTrainer ? children : <Navigate to="/" replace />
}

// The pages of a client (My Sessions, Dashboard, trial and pack requests): a trainer is sent to their panel.
// Everybody else, signed in or not, sees the page as before; while the answer of /me/roles is on its way for a
// signed-in person the page waits a moment (so a trainer never sees a flash of the client page).
export function NotForTrainers({ children }) {
  const { status, isTrainer } = useRoles()
  if (status === 'loading') return <Waiting>{null}</Waiting>
  if (isTrainer) return <Navigate to="/trainer" replace />
  return children
}
