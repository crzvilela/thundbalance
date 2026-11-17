import Card from './Card'

// Placeholders while something loads. They pulse, and stop pulsing for whoever asks for less motion (the global prefers-reduced-motion rule
// of index.css sets every animation to 0.01 ms). Mark the region that holds them with role="status" and a label.
export default function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-white/[0.06] ${className}`.trim()} />
}

export function SkeletonLine({ className = 'h-4 w-2/3' }) {
  return <Skeleton className={className} />
}

// the shape of a card of the client area (a message, a session)
export function SkeletonCard({ className = 'h-40' }) {
  return <Card plain aria-hidden="true" className={`animate-pulse bg-white/[0.04] ${className}`.trim()} />
}

export function SkeletonList({ count = 3, className = 'h-40', label }) {
  return (
    <div role="status" aria-label={label} className="relative space-y-4">
      {Array.from({ length: count }, (_, index) => <SkeletonCard key={index} className={className} />)}
    </div>
  )
}
