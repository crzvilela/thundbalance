import { createContext, useContext } from 'react'

// What the server says about the signed-in account (GET /me/roles):
//   status: 'signed-out' | 'loading' | 'ready' | 'error'
//   roles:  { is_admin, is_trainer, trainer_id, trainer_name } (null until it is known)
export const NO_ROLES = { status: 'signed-out', roles: null, isTrainer: false, reload: () => {} }

export const RolesContext = createContext(NO_ROLES)

export function useRoles() {
  return useContext(RolesContext)
}
