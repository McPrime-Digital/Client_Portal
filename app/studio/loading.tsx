// Paints the instant a navigation starts, inside the main panel, while the
// destination's server work streams in — the difference between "4 seconds of
// nothing" and a shell that answers in under a frame.
export default function StudioLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        <div className="squircle-sm h-8 w-52 max-w-full bg-secondary/70" />
        <div className="squircle-sm h-4 w-96 max-w-full bg-secondary/50" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="squircle h-36 bg-secondary/40" />
        ))}
      </div>
    </div>
  )
}
