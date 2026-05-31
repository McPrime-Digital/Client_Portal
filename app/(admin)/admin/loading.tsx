// Instant skeleton shown while an admin page's server data loads.
export default function Loading() {
  return (
    <div className="space-y-6 w-full animate-pulse">
      <div className="h-8 w-56 rounded-lg" style={{ backgroundColor: 'hsl(var(--secondary))' }} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl"
            style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-44 rounded-xl"
            style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
        ))}
      </div>
    </div>
  )
}
