'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * THE CALL SHEET — what needs this person today.
 *
 * ── WHY IT IS A SENTENCE AND NOT THREE STAT CARDS ──────────────────────────
 *
 * The default treatment for this row is three identical rounded cards, each with
 * a big number, a small grey label and the same soft shadow. It is the commonest
 * tell in generated dashboards, and it is also wrong for the job: a studio owner
 * opening this is asking one question — "is anything waiting on me" — and three
 * equal cards answer it by making them read and compare three things.
 *
 * So the answer is written as a line of type, the way a call sheet states the
 * day. The numbers are the typographic feature; the words carry the meaning; and
 * when nothing is waiting it says so in one quiet sentence instead of rendering
 * three zeroes, which is the same information presented as failure.
 *
 * Film vernacular is deliberate. A studio's morning question is "what's on
 * today", and the surface should sound like the building it serves.
 *
 * ── EVERY ITEM IS CHOSEN SERVER-SIDE ───────────────────────────────────────
 *
 * This renders what it is given and gates nothing. A COUNT is itself a
 * disclosure — "how much is overdue" is information even without the rows behind
 * it — so the capability decision lives in the page, next to the resolver.
 *
 * ── IT ADDS NO REALTIME CHANNEL (I-2) ──────────────────────────────────────
 *
 * I-2 is violated at ~6 subscriptions per hub session and S-R §7 makes a seventh
 * a stop-and-report. This listens on `badges:org:<id>` — the topic the rail and
 * the hubs already broadcast on — and refetches through the capability-gated
 * route. A session that never opens a hub simply keeps the server-rendered
 * numbers, which are correct on arrival.
 */

export type CallSheetItem = { key: string; label: string; n: number; href: string }

export default function StudioHomeAttention({
  items, orgId,
}: {
  items: CallSheetItem[]
  orgId: string | null
}) {
  const [counts, setCounts] = useState<Record<string, number>>(
    () => Object.fromEntries(items.map((i) => [i.key, i.n])),
  )

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/badge-counts')
      if (!res.ok) return
      const j = await res.json()
      setCounts((c) => ({
        ...c,
        messages: j.unreadClientMessages ?? c.messages,
        review: j.changesRequested ?? c.review,
        invoices: j.overdueInvoices ?? c.invoices,
      }))
    } catch { /* a failed refresh keeps the server-rendered numbers */ }
  }, [])

  useEffect(() => {
    if (!orgId) return
    const supabase = createClient()
    const ch = supabase.channel(`badges:org:${orgId}`)
      .on('broadcast', { event: 'badges' }, () => { void refresh() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [orgId, refresh])

  if (items.length === 0) return null

  const live = items.map((i) => ({ ...i, n: counts[i.key] ?? 0 })).filter((i) => i.n > 0)

  if (live.length === 0) {
    return (
      <p className="mb-9 text-[15px] text-muted-foreground">
        Nothing needs you right now.
      </p>
    )
  }

  return (
    <p className="mb-9 text-[15px] leading-relaxed text-muted-foreground">
      {live.map((i, idx) => (
        <span key={i.key}>
          {idx > 0 && <span className="text-faint">{idx === live.length - 1 ? ' and ' : ', '}</span>}
          <Link
            href={i.href}
            className="group whitespace-nowrap rounded-sm underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline"
          >
            <span className="font-display text-[22px] font-semibold tabular-nums text-foreground align-baseline">
              {i.n}
            </span>
            <span className="ml-1.5 text-foreground/85 group-hover:text-foreground">{i.label}</span>
          </Link>
        </span>
      ))}
      <span className="text-faint">.</span>
    </p>
  )
}
