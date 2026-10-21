import { createContext, useContext } from 'react'

// What the server says about the signed-in account (GET /me/roles):
//   status: 'signed-out' | 'loading' | 'ready' | 'error'
//   roles:  { is_admin, is_trainer, trainer_id, trainer_name, trainer_color } (null until it is known)
//   isTrainer:     the account has an active trainer access (the administrator may have one too)
//   isTrainerOnly: a trainer who is NOT the administrator: they get the small trainer menu and no client pages
export const NO_ROLES = { status: 'signed-out', roles: null, isTrainer: false, isTrainerOnly: false, reload: () => {} }

export const RolesContext = createContext(NO_ROLES)

export function useRoles() {
  return useContext(RolesContext)
}
