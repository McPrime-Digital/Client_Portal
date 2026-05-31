// Instant skeleton shown while a portal page's server data loads — makes
// navigation feel immediate instead of blank/stalled.
export default function Loading() {
  return (
    <div className="space-y-6 w-full animate-pulse">
      <div className="h-8 w-48 rounded-lg" style={{ backgroundColor: 'hsl(var(--secondary))' }} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl"
            style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl"
              style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
          ))}
        </div>
        <div className="h-64 rounded-xl"
          style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
      </div>
    </div>
  )
}
