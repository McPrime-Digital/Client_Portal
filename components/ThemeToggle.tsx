'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === 'dark'

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      title={mounted ? (isDark ? 'Switch to light' : 'Switch to dark') : undefined}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="relative grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {mounted ? (
        <>
          <Sun
            size={16}
            className={`absolute transition-all duration-300 ${
              isDark ? 'scale-0 -rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100'
            }`}
          />
          <Moon
            size={16}
            className={`absolute transition-all duration-300 ${
              isDark ? 'scale-100 rotate-0 opacity-100' : 'scale-0 rotate-90 opacity-0'
            }`}
          />
        </>
      ) : (
        <Sun size={16} className="opacity-0" />
      )}
    </button>
  )
}
