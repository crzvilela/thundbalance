// What the studio wrote about a pack (objective, benefits): drawn only when it exists, so a pack without them looks as it always did.
// The text is plain text (React escapes it) and is shown as written (one language, whatever the admin typed).
// tone: 'light' = on a light card, 'dark' = on a black one, 'site' = the dark request page.
const TONES = {
  light: { goal: 'text-gray-600', label: 'text-gray-500', item: 'text-gray-700' },
  dark: { goal: 'text-gray-300', label: 'text-gray-400', item: 'text-gray-300' },
  site: { goal: 'text-gray-300', label: 'text-gray-500', item: 'text-gray-300' },
}

function PackExtras({ pack, t, tone = 'light', className = '' }) {
  const objective = pack?.objective
  const benefits = Array.isArray(pack?.benefits) ? pack.benefits : []
  if (!objective && benefits.length === 0) return null
  const colors = TONES[tone] || TONES.light
  return (
    <div className={className}>
      {objective && <p className={`text-sm leading-6 ${colors.goal}`}><span className="sr-only">{t('pk_goal')}: </span>{objective}</p>}
      {benefits.length > 0 && (
        <>
          <p className={`mt-3 text-xs uppercase tracking-wider ${colors.label}`}>{t('pk_includes')}</p>
          <ul className={`mt-1 space-y-1 text-sm ${colors.item}`}>
            {benefits.map((item, index) => <li key={index} className="flex gap-2"><span aria-hidden="true">{'\u2713'}</span><span className="break-words">{item}</span></li>)}
          </ul>
        </>
      )}
    </div>
  )
}

export default PackExtras
