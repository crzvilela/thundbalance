// Notice for the top of a page or of the "Change password" card, e.g. to tell
// an account created by the studio that it must pick its own password. Use it
// as <ChangePassword banner={<PasswordBanner message={...} />} /> or, via
// TempPasswordNotice, at the top of the client pages.
export default function PasswordBanner({ message, action = null }) {
  if (!message) return null
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
      <span>{message}</span>
      {action}
    </div>
  )
}
