// Reusable confirmation modal for destructive/important editor actions.
// Renders nothing when `open` is false, so it's safe to always mount.
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default', // 'default' | 'danger'
  onConfirm,
  onCancel
}) {
  if (!open) return null

  const confirmClasses = variant === 'danger'
    ? 'bg-red-500 text-white hover:bg-red-400'
    : 'bg-emerald-500 text-black hover:bg-emerald-400'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />

      <div className="relative bg-[#111] border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <h3 className="text-lg font-semibold text-white mb-3">{title}</h3>

        {description && (
          <p className="text-sm text-gray-400 leading-6 mb-6">{description}</p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs uppercase tracking-wider px-4 py-2 rounded-lg border border-white/15 text-white hover:bg-white/10 transition"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`text-xs uppercase tracking-wider px-4 py-2 rounded-lg transition ${confirmClasses}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
