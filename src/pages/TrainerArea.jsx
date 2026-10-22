import { useMemo } from 'react'
import Navbar from '../components/Navbar'
import { authFetch } from '../api/authFetch'
import { useRoles } from '../roles/rolesContext'
import TrainerPanel from '../trainer/TrainerPanel'
import { trainerSource } from '../trainer/trainerSource'

// /trainer: the trainer's own panel. Only an active trainer gets here (TrainerRoute); the server decides again on
// every request and sends nothing but this trainer's sessions. Read only.
export default function TrainerArea() {
  const { roles } = useRoles()
  const source = useMemo(() => trainerSource(authFetch, '/trainer-area/me'), [])
  return (
    <div className="min-h-screen overflow-x-hidden bg-black text-white">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-32 sm:px-6 sm:pt-40">
        <TrainerPanel source={source} trainerName={roles?.trainer_name || ''} color={roles?.trainer_color} />
      </main>
    </div>
  )
}
