'use client'

import { useMemo, useState } from 'react'
import { Loader2, Check, RotateCcw, TriangleAlert } from 'lucide-react'
import {
  deriveBrandTokens, contrastRatio, tripletToHex, type BrandKit,
} from '@/lib/brandKit'

/**
 * THE BRAND KIT EDITOR.
 *
 * ── THE PREVIEW RUNS THE SAME DERIVATION THE SERVER STORES ──────────────
 *
 * `deriveBrandTokens` is imported here AND called again in the route. Not a
 * duplicated implementation — the same module, run twice — so the contrast
 * number a studio reads while choosing is the number that ends up in the
 * database. A preview computed by different code from the thing it previews is
 * a promise nobody checks.
 *
 * What is NOT shared is trust: the request carries the colour, never the
 * tokens. A browser that posted a hand-made ramp would be writing CSS variables
 * into every one of this studio's clients' browsers.
 *
 * ── THE NUMBER IS SHOWN, NOT HIDDEN ─────────────────────────────────────
 *
 * Every white-label editor on the market shows a swatch. This shows the
 * measured contrast of the fill against the page and of the label against the
 * fill, in both themes, because the studio is choosing on behalf of people who
 * are not in the room — and because the honest version of "we keep it
 * accessible" is a figure somebody can check.
 */

const SWATCHES = [
  '#C8A24A', '#1D4ED8', '#0F766E', '#B91C1C', '#7C3AED', '#0B1E4B', '#111827',
]

type Theme = 'light' | 'dark'

export default function BrandKitEditor(
  { initial, studioName }: { initial: BrandKit | null; studioName: string }
) {
  const [colour, setColour] = useState(initial?.input.colour ?? '#C8A24A')
  const [accent, setAccent] = useState(initial?.input.accent ?? '')
  const [label, setLabel] = useState(initial?.approveLabel ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [live, setLive] = useState<BrandKit | null>(initial)

  const tokens = useMemo(
    () => deriveBrandTokens({ colour, accent: accent.trim() || null }),
    [colour, accent],
  )

  async function save(clear = false) {
    setBusy(true); setErr(null); setSaved(false)
    try {
      const r = await fetch('/api/studio/organization/brand', {
        method: clear ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: clear ? undefined : JSON.stringify({
          colour, accent: accent.trim() || null, approveLabel: label.trim() || null,
        }),
      })
      const j = (await r.json().catch(() => null)) as { error?: string; kit?: BrandKit } | null
      if (!r.ok) { setErr(j?.error ?? 'Could not save.'); return }
      setLive(clear ? null : (j?.kit ?? null))
      if (clear) { setColour('#C8A24A'); setAccent(''); setLabel('') }
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      <section className="squircle border border-border bg-card p-5">
        <h2 className="text-[13px] font-semibold text-foreground">Your colour</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          Pick one. Everything else — the hover state, the focus ring, the text
          that sits on a button, and a second version for dark mode — is worked
          out from it, so there is no combination you can choose that leaves a
          client unable to read their own Approve button.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="color" aria-label="Brand colour"
            value={/^#[0-9a-f]{6}$/i.test(colour) ? colour : '#C8A24A'}
            onChange={(e) => setColour(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-transparent p-1"
          />
          <input
            value={colour} onChange={(e) => setColour(e.target.value)}
            aria-label="Brand colour value" maxLength={64} spellCheck={false}
            className="squircle w-44 border border-border bg-background px-2.5 py-1.5 font-mono text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap gap-1.5">
            {SWATCHES.map((s) => (
              <button
                key={s} type="button" onClick={() => setColour(s)} title={s}
                aria-label={`Use ${s}`}
                className="h-7 w-7 rounded-full border border-border outline-none transition-transform duration-[--dur-pop] hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring"
                style={{ background: s }}
              />
            ))}
          </div>
        </div>

        {!tokens && (
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-destructive">
            <TriangleAlert size={13} />
            That is not a colour this can read. Try a hex value like #C8A24A.
          </p>
        )}

        <div className="mt-5">
          <label className="block text-[12px] font-medium text-foreground" htmlFor="bk-accent">
            Second colour <span className="font-normal text-muted-foreground">optional</span>
          </label>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Used for the glass panels and the background wash. Most studios leave
            this empty and everything takes the colour above.
          </p>
          <input
            id="bk-accent" value={accent} onChange={(e) => setAccent(e.target.value)}
            placeholder="Same as your colour" maxLength={64} spellCheck={false}
            className="squircle mt-1.5 w-44 border border-border bg-background px-2.5 py-1.5 font-mono text-[13px] text-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="mt-5">
          <label className="block text-[12px] font-medium text-foreground" htmlFor="bk-label">
            What your clients call approving
          </label>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            &ldquo;Approve&rdquo; and &ldquo;Sign off&rdquo; are different words to a legal team.
          </p>
          <input
            id="bk-label" value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="Approve" maxLength={24}
            className="squircle mt-1.5 w-44 border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </section>

      {tokens && (
        <section>
          <h2 className="text-[13px] font-semibold text-foreground">
            What {studioName} looks like to a client
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(['light', 'dark'] as Theme[]).map((theme) => (
              <Preview key={theme} theme={theme} tokens={tokens} label={label.trim() || 'Approve'} />
            ))}
          </div>
        </section>
      )}

      {err && <p className="text-[12px] text-destructive">{err}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button" disabled={!tokens || busy} onClick={() => void save(false)}
          className="squircle inline-flex items-center gap-2 bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground outline-none transition-opacity duration-[--dur-pop] hover:opacity-90 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
          {saved ? 'Saved' : 'Save brand'}
        </button>
        {live && (
          <button
            type="button" disabled={busy} onClick={() => void save(true)}
            className="squircle inline-flex items-center gap-2 border border-border px-3.5 py-2 text-[13px] text-muted-foreground outline-none transition-colors duration-[--dur-pop] hover:text-foreground disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw size={14} />
            Back to the default palette
          </button>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        This changes what your clients see — their portal, the review pages you
        send them, the guest screening links, the signing pages, and the emails
        that go out in your name. It does not change the studio side you are
        looking at now.
      </p>
    </div>
  )
}

/** A real button on a real surface, at the real token values — because a
 *  swatch grid cannot show you that your label has gone grey on gold. */
function Preview(
  { theme, tokens, label }:
  { theme: Theme; tokens: NonNullable<ReturnType<typeof deriveBrandTokens>>; label: string }
) {
  const ramp = tokens[theme]
  const page = theme === 'light' ? '#ffffff' : '#0b1020'
  const fill = tripletToHex(ramp.primary) ?? '#888'
  const on = tripletToHex(ramp.primaryForeground) ?? '#fff'
  const vsPage = contrastRatio(fill, page)
  const vsFill = contrastRatio(on, fill)

  return (
    <div
      className="squircle overflow-hidden border border-border"
      style={{ background: page, color: theme === 'light' ? '#0a0e1a' : '#e8ecf5' }}
    >
      <div className="px-4 py-5">
        <p className="text-[11px] uppercase tracking-wider" style={{ opacity: 0.55 }}>
          {theme === 'light' ? 'Light' : 'Dark'}
        </p>
        <p className="mt-2 text-[13px]" style={{ opacity: 0.8 }}>
          Cut 04 is ready for your review.
        </p>
        <button
          type="button" tabIndex={-1}
          className="mt-3 rounded-lg px-4 py-2 text-[13px] font-semibold"
          style={{ background: fill, color: on }}
        >
          {label}
        </button>
        <div
          className="mt-4 h-px w-full"
          style={{ background: tripletToHex(ramp.glow) ?? fill, opacity: 0.45 }}
        />
        {/* The measurement, in the open. */}
        <dl className="mt-3 space-y-1 text-[11px]" style={{ opacity: 0.62 }}>
          <div className="flex justify-between gap-3">
            <dt>Button against the page</dt>
            <dd className="font-mono">{vsPage.toFixed(2)}:1</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Label against the button</dt>
            <dd className="font-mono">{vsFill.toFixed(2)}:1</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
