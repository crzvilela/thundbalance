import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { useEditMode } from './editModeContext'
import { Button, ConfirmDialog } from './ui'
import { MENU_ITEMS } from './uiRegistry'
import { pageIsCustomised } from './uiSettings'

// The bar that appears only while the panel is being edited: Save, Cancel, "Reset everything" (asks first) and the link to the advanced
// editor. It also says why a save was refused (409: somebody changed the panel meanwhile; 422: a text is not valid), always in ES / EN.
export default function EditBar() {
  const { t } = useAdminText()
  const toast = useToast()
  const edit = useEditMode()
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const { pathname } = useLocation()
  if (!edit?.isEditing) return null
  // the page the admin is on (to reset its blocks): the menu item whose route it is
  const pageKey = MENU_ITEMS.find(item => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)))?.key

  const message = (() => {
    if (edit.warning) return t(edit.warning)
    if (!edit.error) return ''
    const key = `ui_err_${edit.error.code}`
    return t(key) !== key ? t(key) : t('ui_err_generic')
  })()

  const save = async () => { if (await edit.save()) toast.push(t('ui_saved')) }
  const reset = async () => { const ok = await edit.resetAll(); setConfirmReset(false); if (ok) toast.push(t('ui_reset_ok')) }
  const cancel = () => { if (edit.dirty) setConfirmCancel(true); else edit.cancel() }

  return (
    <>
      <div role="region" aria-label={t('ui_editing')} className="fixed inset-x-0 bottom-0 z-[45] border-t border-emerald-400/30 bg-[#06100c]/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-[12rem] flex-1">
            <p className="text-sm font-semibold text-emerald-300">{t('ui_editing')}{edit.dirty && <span className="ml-2 text-amber-300" title={t('ui_unsaved')}>● {t('ui_unsaved')}</span>}</p>
            <p className="hidden text-xs text-gray-400 sm:block">{t('ui_editing_hint')}</p>
          </div>
          {message && (
            <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-100">
              {message}
              {edit.error?.code === 'version_conflict' && <button type="button" className="underline underline-offset-4" onClick={edit.reload}>{t('ui_reload')}</button>}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {pageKey && <Button variant="secondary" onClick={() => edit.resetPage(pageKey)} disabled={edit.saving || !pageIsCustomised(edit.draft, pageKey)}>{t('ui_page_reset')}</Button>}
            <button type="button" onClick={edit.openAdvanced} className="inline-flex min-h-[44px] items-center px-2 text-sm text-gray-300 underline underline-offset-4 hover:text-white">{t('ui_advanced')}</button>
            <Button variant="danger" onClick={() => setConfirmReset(true)} disabled={edit.saving}>{t('ui_reset_all')}</Button>
            <Button variant="secondary" onClick={cancel} disabled={edit.saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={save} loading={edit.saving}>{t('ui_save')}</Button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmReset} title={t('ui_reset_title')} text={t('ui_reset_text')} confirmLabel={t('ui_reset_yes')} cancelLabel={t('cancel')}
        busy={edit.saving} onConfirm={reset} onCancel={() => setConfirmReset(false)}
      />
      <ConfirmDialog
        open={confirmCancel} tone="neutral" icon="alert" title={t('ui_leave_title')} text={t('ui_leave_text')}
        confirmLabel={t('ui_leave_yes')} cancelLabel={t('ui_leave_stay')}
        onConfirm={() => { setConfirmCancel(false); edit.cancel() }} onCancel={() => setConfirmCancel(false)}
      />
    </>
  )
}
