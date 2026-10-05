import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLandingContent } from '../../content/LandingContentContext'
import { useAdminText } from '../../admin/useAdminText'
import ConfirmDialog from './ConfirmDialog'
import { EdIcon } from './editorIcons'
import './EditorChrome.css'

const DEVICES = [
  { key: 'desktop', icon: 'desktop', label: 'ed_desktop' },
  { key: 'tablet', icon: 'tablet', label: 'ed_tablet' },
  { key: 'mobile', icon: 'mobile', label: 'ed_mobile' }
]

const iconButton = 'flex h-9 w-9 items-center justify-center rounded-lg text-gray-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-gray-700 disabled:hover:bg-transparent'

export default function EditorTopbar({ sidebarHidden, onToggleSidebar }) {
  const navigate = useNavigate()
  const { t, language, setLanguage } = useAdminText()
  const {
    device, setDevice,
    undo, redo, canUndo, canRedo,
    save, publish, reset,
    saving, publishing, dirty, lastSavedAt
  } = useLandingContent()

  const [resetOpen, setResetOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    const close = (event) => { if (!menuRef.current?.contains(event.target)) setMenuOpen(false) }
    const onKey = (event) => { if (event.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  const handlePublish = async () => {
    await publish()
    window.open('/', '_blank')
  }

  const status = saving ? t('ed_saving') : dirty ? t('ed_unsaved') : lastSavedAt ? t('ed_saved') : ''

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#0b0b0b] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={() => navigate('/admin')} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-gray-400 transition hover:bg-white/10 hover:text-white">
          <EdIcon name="back" className="h-4 w-4" />{t('ed_back')}
        </button>
        <span className="hidden h-5 w-px bg-white/10 sm:block" />
        <h1 className="hidden truncate text-sm font-semibold text-white sm:block">{t('ed_title')}</h1>
      </div>

      <div className="flex items-center gap-1 rounded-xl bg-white/[0.06] p-1" role="group" aria-label="Device">
        {DEVICES.map((item) => (
          <button
            key={item.key} type="button" onClick={() => setDevice(item.key)} title={t(item.label)} aria-pressed={device === item.key}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${device === item.key ? 'bg-emerald-400 font-semibold text-black' : 'text-gray-400 hover:text-white'}`}
          >
            <EdIcon name={item.icon} />
            <span className="hidden xl:inline">{t(item.label)}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <button type="button" onClick={undo} disabled={!canUndo} title={t('ed_undo')} aria-label={t('ed_undo')} className={iconButton}><EdIcon name="undo" /></button>
        <button type="button" onClick={redo} disabled={!canRedo} title={t('ed_redo')} aria-label={t('ed_redo')} className={iconButton}><EdIcon name="redo" /></button>

        <span className="mx-1 hidden min-w-24 text-right text-xs text-gray-500 lg:block" role="status">
          {dirty && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />}{status}
        </span>

        <button type="button" onClick={() => window.open('/?preview=true', '_blank')} className="rounded-lg px-3 py-2 text-sm text-gray-200 transition hover:bg-white/10">{t('ed_preview')}</button>
        <button type="button" onClick={save} disabled={saving} className="rounded-lg border border-white/15 px-3.5 py-2 text-sm text-white transition hover:bg-white/10 disabled:opacity-50">{saving ? t('ed_saving') : t('ed_save')}</button>
        <button type="button" onClick={handlePublish} disabled={publishing} className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-300 active:scale-[0.97] disabled:opacity-50">{publishing ? t('ed_publishing') : t('ed_publish')}</button>

        <div className="relative" ref={menuRef}>
          <button type="button" onClick={() => setMenuOpen((open) => !open)} aria-haspopup="menu" aria-expanded={menuOpen} title={t('ed_more')} aria-label={t('ed_more')} className={iconButton}><EdIcon name="more" /></button>
          {menuOpen && (
            <div role="menu" className="editor-menu absolute right-0 top-11 z-[80] w-64 rounded-xl border border-white/10 bg-[#111] p-1.5 shadow-2xl">
              <button type="button" role="menuitem" onClick={() => { onToggleSidebar(); setMenuOpen(false) }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-200 hover:bg-white/10">
                <EdIcon name="sidebar" />{sidebarHidden ? t('ed_show_sidebar') : t('ed_hide_sidebar')}
              </button>
              <div className="flex items-center justify-between px-3 py-2.5 text-sm text-gray-200">
                <span className="flex items-center gap-3"><EdIcon name="palette" className="h-[18px] w-[18px] opacity-0" />{language === 'es' ? 'Idioma' : 'Language'}</span>
                <div className="flex rounded-lg border border-white/10 p-0.5">
                  {['en', 'es'].map((code) => (
                    <button key={code} type="button" onClick={() => setLanguage(code)} aria-pressed={language === code} className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase ${language === code ? 'bg-emerald-400 text-black' : 'text-gray-400 hover:text-white'}`}>{code}</button>
                  ))}
                </div>
              </div>
              <div className="my-1 h-px bg-white/10" />
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setResetOpen(true) }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-red-300 hover:bg-red-500/10">
                <EdIcon name="undo" />{t('ed_restore')}
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={resetOpen}
        title={t('ed_restore_title')}
        description={t('ed_restore_text')}
        confirmLabel={t('ed_restore_do')}
        cancelLabel={t('ed_cancel')}
        variant="danger"
        onConfirm={async () => { await reset(); setResetOpen(false) }}
        onCancel={() => setResetOpen(false)}
      />
    </header>
  )
}
