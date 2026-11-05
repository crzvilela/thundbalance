import { resolveImageUrl } from '../api/landingPage'
import { useAdminText } from './useAdminText'
import { parseDateKey } from './requests'
import { Badge } from './ui'
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

// One client of the list: avatar, name and email, the labels of their ACTIVE packs and the next session. The secondary
// actions live in the "···" menu (`menu`), hidden while the rows are being selected. The row itself is a real button:
// Enter and Space open the file. `check` (optional) is the checkbox of the bulk selection (RowCheck).
export function ClientRow({ client, onOpen, label, check = null, selected = false, menu = null }) {
  const { t, language } = useAdminText()
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const packs = client.packs_active || 0
  const next = client.next_session ? parseDateKey(client.next_session).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : ''
  return (
    <li className={`flex items-stretch ${selected ? 'bg-emerald-400/[0.05]' : ''}`}>
      {check && <span className="flex w-12 shrink-0 items-center justify-center pl-1 sm:w-14">{check}</span>}
      <button
        type="button" onClick={() => onOpen(client.id)} aria-label={label}
        className={`group flex min-h-[72px] min-w-0 flex-1 items-center gap-3 py-3 pr-2 text-left transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-400 sm:gap-4 ${check ? '' : 'pl-4 sm:pl-5'}`}
      >
        <ClientAvatar client={client} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium text-white">{client.name || client.email}</span>
          <span className="block truncate text-sm text-gray-400">{client.name ? client.email : ''}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {packs > 0
              ? <><Badge tone="emerald">{client.plan}</Badge>{packs > 1 && <Badge>+{packs - 1}</Badge>}</>
              : <Badge>{t('cl_no_plan')}</Badge>}
            {client.session_type === 'dual' && <TypeBadge type="dual" />}
            {(client.pack_status === 'expiring' || client.pack_status === 'expired') && <Badge tone={client.pack_status === 'expired' ? 'red' : 'amber'}>{t(`pk_status_${client.pack_status}`)}</Badge>}
            {client.has_pending_request && <Badge tone="amber">{t('cl_pending')}</Badge>}
            {next && <span className="text-xs text-gray-400 sm:hidden">{t('fx_next_session')}: {next}</span>}
          </span>
        </span>
        <span className="hidden shrink-0 text-right sm:block">
          <span className="block text-xs text-gray-500">{t('fx_next_session')}</span>
          <span className="block text-sm tabular-nums text-gray-200">{next || '—'}</span>
        </span>
      </button>
      {menu && <span className="flex shrink-0 items-center pr-1 sm:pr-3">{menu}</span>}
    </li>
  )
}
