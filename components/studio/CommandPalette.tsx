'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, CornerDownLeft } from 'lucide-react'

/**
 * ⌘K — the studio command palette.
 *
 * ── IT HAS NO OPEN/CLOSE ANIMATION, AND THAT IS THE DESIGN ─────────────────
 *
 * The animation decision framework starts with frequency, not aesthetics: an
 * action performed 100+ times a day gets no animation, ever. A palette is the
 * most-repeated interaction in a keyboard-driven app, and motion on a
 * keyboard-initiated action reads as lag — the interface hesitating before it
 * answers. Raycast ships none for exactly this reason. Neither does this.
 *
 * The backdrop does not fade, the panel does not scale, the list does not
 * stagger. What it does instead is appear on the same frame as the keystroke.
 *
 * ── IT CANNOT LEAK A SURFACE (S-R §8 S-2, for free) ────────────────────────
 *
 * Its entire contents are `heldSurfaces()`, resolved server-side and passed in.
 * There is no client-side filter deciding what you may see, so a person cannot
 * discover a surface they do not hold by typing its name — and a new capability
 * produces new palette entries with no work here. That is S-1's projection rule
 * applied to navigation rather than to a dashboard.
 *
 * ── KEYBOARD IS THE PRIMARY INPUT, NOT A SHORTCUT ──────────────────────────
 *
 * ⌘K / Ctrl-K opens. ↑↓ move, ⏎ navigates, Esc closes. The list scrolls the
 * active row into view with `block: 'nearest'` so holding ↓ walks the list
 * without the viewport jumping. Typing always refocuses the input.
 */

export type PaletteItem = {
  id: string
  label: string
  group: string
  href: string
  built: boolean
}

export default function CommandPalette({ items }: { items: PaletteItem[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Subsequence match, not substring: "csm" finds "Client · Messages" the way a
  // fuzzy finder does. Ranked so a prefix hit beats a scattered one, because
  // typing the first letters is what people actually do.
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items
    const scored: { item: PaletteItem; score: number }[] = []
    for (const item of items) {
      const hay = `${item.group} ${item.label}`.toLowerCase()
      let i = 0
      let score = 0
      let streak = 0
      for (let j = 0; j < hay.length && i < needle.length; j++) {
        if (hay[j] === needle[i]) {
          streak += 1
          // A match at a word boundary is worth more than one mid-word.
          score += j === 0 || hay[j - 1] === ' ' || hay[j - 1] === '·' ? 12 : 4 + streak
          i += 1
        } else {
          streak = 0
        }
      }
      if (i === needle.length) scored.push({ item, score })
    }
    return scored.sort((a, b) => b.score - a.score).map((s) => s.item)
  }, [items, q])


  const go = useCallback((item: PaletteItem) => {
    setOpen(false)
    setQ('')
    router.push(item.href)
  }, [router])

  // Global hotkey. Bound once, on window, so it works from anywhere in the
  // studio including inside a focused input elsewhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // `nearest` rather than `center`: holding ↓ should walk the list, not jump the
  // viewport under the cursor on every step.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[14vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="glass-panel squircle-lg w-full max-w-lg overflow-hidden border border-border shadow-2xl"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); return }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return }
          if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]) }
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search size={15} className="flex-shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={q}
            // Reset the cursor HERE rather than in an effect on `q`. An effect
            // would set state during render-commit for a value the event already
            // knows, which is a cascading render and a lint error that is right.
            onChange={(e) => { setQ(e.target.value); setActive(0) }}
            placeholder="Go to…"
            aria-label="Search surfaces"
            // COMBOBOX, not a list of buttons. Focus never leaves the input —
            // arrows move a virtual cursor and aria-activedescendant tells a
            // screen reader which row is current, which is why the rows carry
            // tabIndex={-1} and no focus ring: a ring on a row you cannot focus
            // is a lie, and letting Tab walk 30 rows would break the one
            // interaction this surface exists for.
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-autocomplete="list"
            aria-activedescendant={results[active] ? `cmdk-${results[active].id}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-faint"
          />
          <kbd className="hidden flex-shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-faint sm:block">
            esc
          </kbd>
        </div>

        <div
          ref={listRef}
          id="cmdk-list"
          role="listbox"
          aria-label="Surfaces"
          className="max-h-[52vh] overflow-y-auto p-1.5 scrollbar-thin"
        >
          {results.length === 0 ? (
            // Says what happened, not that something is missing. It never
            // suggests a surface exists that this person cannot reach.
            <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
              No surface matches “{q}”.
            </p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                id={`cmdk-${r.id}`}
                type="button"
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                data-active={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(r)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left ${
                  i === active ? 'bg-secondary text-foreground' : 'text-muted-foreground'
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="text-faint">{r.group}</span>
                  <span className="px-1 text-faint">/</span>
                  <span className={i === active ? 'text-foreground' : 'text-muted-foreground'}>{r.label}</span>
                </span>
                {!r.built && <span className="flex-shrink-0 text-[10px] text-faint">soon</span>}
                {i === active && <CornerDownLeft size={12} className="flex-shrink-0 text-faint" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
