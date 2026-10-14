// One look for every input of the site and of the admin panel: same height,
// corner radius, text size and focus colour. `invalid` turns the border red.
export const INPUT_CLASS =
  'w-full rounded-xl border bg-black/40 px-4 py-3.5 text-base text-white outline-none transition placeholder:text-gray-500 ' +
  'focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60'

export const inputBorder = (invalid) =>
  invalid
    ? 'border-red-400/70 focus:border-red-400 focus:ring-red-400/20'
    : 'border-white/15 focus:border-emerald-400/70 focus:ring-emerald-400/20'
