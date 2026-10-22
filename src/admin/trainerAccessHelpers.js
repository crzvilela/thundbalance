// Pure helpers of "Acceso al área de entrenadores" (Admin > Entrenadores).
// Tested with: node --test src/admin/trainerAccessHelpers.test.js

// The trainer's own panel as the admin sees it (/admin/trainers/{id}/panel). The page is built in the
// trainer-area prompt: while it does not exist the "Ver panel" button stays disabled ("Próximamente").
// Switch this to true when the route is added to AppRoutes.
export const TRAINER_PANEL_ROUTE_READY = true
export const trainerPanelPath = (trainerId) => `/admin/trainers/${trainerId}/panel`

// What /admin/trainer-access/check answers when the email can NOT be used: reason -> admin text key.
export const REASON_KEY = {
  no_account: 'ta_r_no_account',
  email_not_verified: 'ta_r_email_not_verified',
  is_admin: 'ta_r_is_admin',
  already_assigned_to_other_trainer: 'ta_r_other_trainer',
  already_granted: 'ta_r_already_granted',
  trainer_has_access: 'ta_r_trainer_has_access',
  is_client_with_activity: 'ta_r_client_activity',
}
export const reasonKey = (reason) => REASON_KEY[reason] || 'ta_r_generic'

// "2026-10-21T09:30:00" -> "21 oct 2026" in the admin's language
export function grantedDate(iso, locale) {
  if (!iso) return '—'
  const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' }).format(date)
}
