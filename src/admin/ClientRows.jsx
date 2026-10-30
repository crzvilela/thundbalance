import { resolveImageUrl } from '../api/landingPage'
import { Icon } from './ui'
import { TypeBadge } from './SessionKind'

// A colour for every client, always the same one, derived from the email (hue 0-359)
function hueOf(text) {
  let hue = 0
  for (const letter of String(text || '').toLowerCase()) hue = (hue * 31 + letter.charCodeAt(0)) % 360
  return hue
}

// "AM" from the name, or from the start of the email when there is no name
function initialsOf(client) {
  const source = String(client.name || '').trim() || String(client.email || '').split('@')[0]
  const parts = source.split(/[\s._-]+/).filter(Boolean)
  return `${parts[0]?.[0] || '?'}${parts.length > 1 ? parts[1][0] : ''}`.toUpperCase()
}

// The Google / Firebase photo when there is one, otherwise the initials on a colour taken from the email.
export function ClientAvatar({ client, size = 'h-10 w-10 text-sm' }) {
  const photo = resolveImageUrl(client.photo)
  const hue = hueOf(client.email)
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold`}
      style={photo ? undefined : { background: `hsl(${hue} 45% 26%)`, color: `hsl(${hue} 85% 88%)` }}
    >
      {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initialsOf(client)}
    </span>
  )
}

// One client: avatar, email and an arrow, nothing else (no warnings, no badges). A real button, so Enter and Space open it.
// `check` (optional) is the checkbox of the bulk selection (RowCheck), drawn in front of the row.
export function ClientRow({ client, onOpen, label, check = null, selected = false }) {
  return (
    <li className={`flex items-stretch ${selected ? 'bg-emerald-400/[0.05]' : ''}`}>
      {check && <span className="flex w-12 shrink-0 items-center justify-center pl-1 sm:w-14">{check}</span>}
      <button
        type="button" onClick={() => onOpen(client.id)} aria-label={label}
        className={`group flex min-h-[64px] min-w-0 flex-1 items-center gap-4 py-3 pr-4 text-left transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-400 sm:pr-5 ${check ? '' : 'pl-4 sm:pl-5'}`}
      >
        <ClientAvatar client={client} />
        <span className="min-w-0 flex-1 truncate text-base text-white">{client.email}</span>
        {client.session_type === 'dual' && <TypeBadge type="dual" />}
        <Icon name="arrow" className="h-4 w-4 shrink-0 text-gray-600 transition group-hover:translate-x-0.5 group-hover:text-emerald-300" />
      </button>
    </li>
  )
}
