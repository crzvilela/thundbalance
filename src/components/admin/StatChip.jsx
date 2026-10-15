const TONES = {
  neutral: 'border-white/10 bg-white/[0.04] text-white',
  emerald: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  amber: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
}

// Small label + value indicator (sessions done, next session...).
export default function StatChip({ label, value, tone = 'neutral' }) {
  return (
    <div className={`min-w-0 rounded-xl border px-3 py-2 ${TONES[tone]}`}>
      <p className="truncate text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}
