// The top of a client page: a green eyebrow, the title (Bebas Neue), a subtitle and, if the page has one, an action on the right.
//   <PageHeader eyebrow={t('dash_client_space')} title={t('in_title')} subtitle={t('in_intro')} actions={<Button …/>} />
// `tone="muted"` is the quieter version some pages still use (stronger eyebrow, grey subtitle, a little more space): it exists only so that
// moving a page here does not change how it looks; the pages will converge on the default one.
export default function PageHeader({ eyebrow, title, subtitle, actions, tone = 'default', className = '' }) {
  const muted = tone === 'muted'
  const text = (
    <>
      {eyebrow && <p className={`mb-3 text-eyebrow font-semibold uppercase tracking-[0.3em] ${muted ? 'text-accent' : 'text-accent-text'}`}>{eyebrow}</p>}
      <h1 className="text-display md:text-display-lg" style={{ fontFamily: 'Bebas Neue' }}>{title}</h1>
      {subtitle && <p className={`mt-3 text-sm ${muted ? 'text-gray-400' : 'max-w-xl text-gray-300'}`}>{subtitle}</p>}
    </>
  )
  return (
    <header className={`relative ${muted ? 'mb-9' : 'mb-8'} ${actions ? 'flex flex-wrap items-end justify-between gap-4' : ''} ${className}`.trim()}>
      {actions ? <div>{text}</div> : text}
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </header>
  )
}
