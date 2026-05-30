'use client'

import { useEffect, useState } from 'react'

type Props = {
  firstName: string
  summary: string
}

export default function OverviewGreeting({ firstName, summary }: Props) {
  // Time-based greeting computed client-side so it reflects the viewer's
  // local time (initial 'Welcome' matches SSR → no hydration mismatch).
  const [greeting, setGreeting] = useState('Welcome')
  useEffect(() => {
    const h = new Date().getHours()
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening')
  }, [])

  return (
    <div className="min-w-0">
      <h1 className="font-display text-2xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
        {greeting}{firstName ? `, ${firstName}` : ''} 👋
      </h1>
      <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
        {summary}
      </p>
    </div>
  )
}
