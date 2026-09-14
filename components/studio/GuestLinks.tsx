'use client'

import { useMemo, useState } from 'react'
import {
  Link2, Plus, Copy, Check, EyeOff, ChevronDown, Loader2, ShieldCheck, X,
} from 'lucide-react'

/**
 * THE SCREENING ROOM, studio side.
 *
 * ── WHAT THIS SURFACE IS FOR, AND WHY IT IS NOT AN ANALYTICS DASHBOARD ───
 *
 * Every review tool records views. Frame.io, Dropbox Replay, Filestage, MediaSilo
 * all show you an engagement chart. None of them answers the question a
 * production actually asks, which is not "how engaged were they" but **"did the
 * person who signed off actually watch it?"**
 *
 * So the loudest thing on each view row is the WATCHED BAR, and the sentence
 * beside it is written for a dispute rather than for a marketing page: "reached
 * 8% before approving" is a fact somebody will one day need. The view count is
 * secondary and the chart does not exist.
 */

export type LinkRow = {
  id: string
  title: string | null
  fileName: string | null
  state: 'live' | 'expired' | 'spent' | 'withdrawn'
  expiresAt: string | null
  maxViews: number | null
  viewCount: number
  watermark: boolean
  requireEmail: boolean
  allowDownload: boolean
  hasPasscode: boolean
  createdAt: string
  views: ViewRowView[]
}

export type ViewRowView = {
  id: string
  who: string
  startedAt: string
  secondsWatched: number
  furthestMs: number
  durationMs: number | null
}

type FileOption = { id: string; name: string; project: string | null }

const STATE_STYLE: Record<LinkRow['state'], string> = {
  live: 'bg-[hsl(var(--glow)/0.12)] text-[hsl(var(--glow))]',
  expired: 'bg-muted text-muted-foreground',
  spent: 'bg-muted text-muted-foreground',
  withdrawn: 'bg-destructive/10 text-destructive',
}
const STATE_WORD: Record<LinkRow['state'], string> = {
  live: 'Open', expired: 'Expired', spent: 'Limit reached', withdrawn: 'Withdrawn',
}

const EXPIRY_CHOICES: { label: string; hours: number | null }[] = [
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
  { label: 'No expiry', hours: null },
]

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The sentence a dispute needs. Null duration is an honest gap, not 0%. */
function watchedLine(v: ViewRowView): { share: number | null; text: string } {
  if (!v.durationMs || v.durationMs <= 0) {
    return { share: null, text: `Watched ${mmss(v.secondsWatched)} — length unknown` }
  }
  const share = Math.min(1, v.furthestMs / v.durationMs)
  const pct = Math.round(share * 100)
  if (pct >= 95) return { share, text: 'Watched it through' }
  if (pct <= 10) {
    return { share, text: `Reached only ${pct}% — ${mmss(v.furthestMs / 1000)} in` }
  }
  return { share, text: `Reached ${pct}% — ${mmss(v.furthestMs / 1000)} in` }
}

export default function GuestLinks(
  { links, files }: { links: LinkRow[]; files: FileOption[] }
) {
  const [rows, setRows] = useState(links)
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [minted, setMinted] = useState<string | null>(null)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
            <Link2 size={24} className="text-primary" />
            Guest Review Links
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.filter((r) => r.state === 'live').length === 0
              ? 'Nothing is out for viewing.'
              : `${rows.filter((r) => r.state === 'live').length} link${
                  rows.filter((r) => r.state === 'live').length === 1 ? '' : 's'
                } open.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setOpen((o) => !o); setMinted(null) }}
          className="squircle inline-flex items-center gap-2 bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground outline-none transition-opacity duration-[--dur-pop] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? <X size={15} /> : <Plus size={15} />}
          {open ? 'Cancel' : 'New link'}
        </button>
      </div>

      {minted && <MintedLink url={minted} onDismiss={() => setMinted(null)} />}

      {open && (
        <NewLink
          files={files}
          onDone={(url, row) => {
            setMinted(url); setOpen(false); setRows((r) => [row, ...r])
          }}
        />
      )}

      {rows.length === 0 ? (
        <p className="squircle border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
          No links yet. A guest link shows one cut to somebody with no account — a
          colourist, a financier, a festival programmer — and records what they
          actually watched before they said yes.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((l) => (
            <li key={l.id} className="squircle border border-border bg-card">
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setExpanded((e) => (e === l.id ? null : l.id))}
                  className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {l.title || l.fileName || 'Untitled'}
                    </span>
                    <span className={`squircle shrink-0 px-1.5 py-0.5 text-[10px] font-medium ${STATE_STYLE[l.state]}`}>
                      {STATE_WORD[l.state]}
                    </span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
                    <span>
                      {l.viewCount} view{l.viewCount === 1 ? '' : 's'}
                      {l.maxViews !== null && ` of ${l.maxViews}`}
                    </span>
                    {l.expiresAt && (
                      <span>
                        · until {new Date(l.expiresAt).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric',
                        })}
                      </span>
                    )}
                    {l.watermark && (
                      <span className="inline-flex items-center gap-1">
                        · <ShieldCheck size={11} /> watermarked
                      </span>
                    )}
                    {l.hasPasscode && <span>· passcode</span>}
                    {l.allowDownload && <span>· download allowed</span>}
                  </span>
                </button>

                {l.state === 'live' && (
                  <RevokeButton
                    id={l.id}
                    onDone={() => setRows((r) =>
                      r.map((x) => (x.id === l.id ? { ...x, state: 'withdrawn' } : x))
                    )}
                  />
                )}
                <ChevronDown
                  size={15}
                  className={`shrink-0 text-faint transition-transform duration-[--dur-pop] ${
                    expanded === l.id ? 'rotate-180' : ''
                  }`}
                />
              </div>

              {expanded === l.id && (
                <div className="border-t border-border px-4 py-3">
                  {l.views.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">
                      Nobody has opened this yet.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {l.views.map((v) => {
                        const w = watchedLine(v)
                        return (
                          <li key={v.id}>
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="text-[13px] text-foreground">{v.who}</span>
                              <span className="text-[11px] text-faint">
                                {new Date(v.startedAt).toLocaleString('en-US', {
                                  month: 'short', day: 'numeric',
                                  hour: 'numeric', minute: '2-digit',
                                })}
                              </span>
                            </div>
                            {/* THE DIFFERENTIATOR, and the loudest thing here. */}
                            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-[hsl(var(--glow))]"
                                style={{ width: `${Math.round((w.share ?? 0) * 100)}%` }}
                              />
                            </div>
                            <p className="mt-1 text-[12px] text-muted-foreground">{w.text}</p>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The URL exists in one place and one moment. Saying so is kinder than letting
 *  somebody find out by closing the panel. */
function MintedLink({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="squircle mb-4 border border-[hsl(var(--glow)/0.4)] bg-[hsl(var(--glow)/0.06)] px-4 py-3">
      <p className="text-[13px] font-medium text-foreground">
        Copy this now — it is not shown again.
      </p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        Only a one-way hash of the link is stored, so nobody, including this
        studio, can recover it later. Withdraw it and mint a new one instead.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="squircle min-w-0 flex-1 truncate border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground">
          {url}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true); setTimeout(() => setCopied(false), 2000)
            })
          }}
          className="squircle inline-flex shrink-0 items-center gap-1.5 border border-border px-2.5 py-1.5 text-[12px] text-foreground outline-none transition-[border-color] duration-[--dur-pop] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button" onClick={onDismiss}
          className="shrink-0 text-faint outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Dismiss"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}

function RevokeButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <button
      type="button"
      title={err ?? 'Withdraw this link'}
      disabled={busy}
      onClick={async () => {
        setBusy(true); setErr(null)
        try {
          const r = await fetch('/api/studio/share-links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'revoke', id }),
          })
          if (!r.ok) {
            // I-10: the failure reaches the person who asked for it. A link
            // that looks withdrawn and is not is the worst outcome available.
            setErr(((await r.json().catch(() => null)) as { error?: string } | null)?.error
              ?? 'Could not withdraw that.')
            return
          }
          onDone()
        } finally { setBusy(false) }
      }}
      className={`squircle inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 text-[12px] outline-none transition-colors duration-[--dur-pop] focus-visible:ring-2 focus-visible:ring-ring ${
        err ? 'border-destructive text-destructive' : 'border-border text-muted-foreground hover:border-destructive hover:text-destructive'
      }`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <EyeOff size={13} />}
      {err ? 'Failed' : 'Withdraw'}
    </button>
  )
}

function NewLink(
  { files, onDone }: { files: FileOption[]; onDone: (url: string, row: LinkRow) => void }
) {
  const [q, setQ] = useState('')
  const [fileId, setFileId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [hours, setHours] = useState<number | null>(168)
  const [passcode, setPasscode] = useState('')
  const [maxViews, setMaxViews] = useState('')
  const [watermark, setWatermark] = useState(true)
  const [requireEmail, setRequireEmail] = useState(true)
  const [allowDownload, setAllowDownload] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? files.filter((f) => f.name.toLowerCase().includes(needle)
          || (f.project ?? '').toLowerCase().includes(needle))
      : files
    return list.slice(0, 8)
  }, [files, q])

  const chosen = files.find((f) => f.id === fileId) ?? null

  async function submit() {
    if (!fileId) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/studio/share-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          fileId,
          title: title.trim() || null,
          expiresInHours: hours,
          passcode: passcode.trim() || null,
          maxViews: maxViews.trim() ? Number(maxViews.trim()) : null,
          watermark, requireEmail, allowDownload,
        }),
      })
      const j = (await r.json().catch(() => null)) as { url?: string; id?: string; error?: string } | null
      if (!r.ok || !j?.url || !j?.id) {
        setErr(j?.error ?? 'Could not create that link.')
        return
      }
      onDone(j.url, {
        id: j.id,
        title: title.trim() || null,
        fileName: chosen?.name ?? null,
        state: 'live',
        expiresAt: hours === null ? null : new Date(Date.now() + hours * 3_600_000).toISOString(),
        maxViews: maxViews.trim() ? Number(maxViews.trim()) : null,
        viewCount: 0,
        watermark, requireEmail, allowDownload,
        hasPasscode: !!passcode.trim(),
        createdAt: new Date().toISOString(),
        views: [],
      })
    } finally { setBusy(false) }
  }

  return (
    <div className="squircle mb-4 border border-border bg-card px-4 py-4">
      <label className="block text-[12px] font-medium text-foreground" htmlFor="gl-file">
        Which cut
      </label>
      {chosen ? (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="squircle min-w-0 flex-1 truncate border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground">
            {chosen.name}
            {chosen.project && (
              <span className="text-muted-foreground"> · {chosen.project}</span>
            )}
          </span>
          <button
            type="button" onClick={() => { setFileId(null); setQ('') }}
            className="shrink-0 text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            id="gl-file" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search the vault"
            className="squircle mt-1.5 w-full border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
          />
          <ul className="mt-1.5 space-y-1">
            {shown.length === 0 && (
              <li className="px-1 text-[12px] text-muted-foreground">
                No video in the vault matches that.
              </li>
            )}
            {shown.map((f) => (
              <li key={f.id}>
                <button
                  type="button" onClick={() => setFileId(f.id)}
                  className="squircle w-full truncate px-2 py-1.5 text-left text-[13px] text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {f.name}
                  {f.project && <span className="text-muted-foreground"> · {f.project}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-[12px] font-medium text-foreground" htmlFor="gl-title">
            What the viewer sees it called
          </label>
          <input
            id="gl-title" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={chosen?.name ?? 'Optional'}
            className="squircle mt-1.5 w-full border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <span className="block text-[12px] font-medium text-foreground">Open for</span>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {EXPIRY_CHOICES.map((c) => (
              <button
                key={c.label} type="button" onClick={() => setHours(c.hours)}
                className={`squircle border px-2 py-1 text-[12px] outline-none transition-colors duration-[--dur-pop] focus-visible:ring-2 focus-visible:ring-ring ${
                  hours === c.hours
                    ? 'border-[hsl(var(--glow)/0.5)] bg-[hsl(var(--glow)/0.1)] text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-medium text-foreground" htmlFor="gl-pass">
            Passcode <span className="font-normal text-muted-foreground">optional</span>
          </label>
          <input
            id="gl-pass" value={passcode} onChange={(e) => setPasscode(e.target.value)}
            placeholder="At least 4 characters"
            className="squircle mt-1.5 w-full border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-foreground" htmlFor="gl-max">
            View limit <span className="font-normal text-muted-foreground">optional</span>
          </label>
          <input
            id="gl-max" inputMode="numeric" value={maxViews}
            onChange={(e) => setMaxViews(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Unlimited"
            className="squircle mt-1.5 w-full border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <Toggle
          on={watermark} set={setWatermark}
          label="Burn the viewer's details across the picture"
          hint="On by default. Frame.io charges Enterprise for this. It moves, so a screen recording carries it and cropping destroys the frame."
        />
        <Toggle
          on={requireEmail} set={setRequireEmail}
          label="Ask for an email before playing"
          hint="It is not verified, and the product does not pretend it is — but a watermark reading “anonymous” identifies nobody."
        />
        <Toggle
          on={allowDownload} set={setAllowDownload}
          label="Allow the file to be downloaded"
          hint="Off by default: a screener is for watching, and a downloaded file carries no watermark of any kind."
        />
      </div>

      {err && <p className="mt-3 text-[12px] text-destructive">{err}</p>}

      <div className="mt-4 flex justify-end">
        <button
          type="button" disabled={!fileId || busy} onClick={() => void submit()}
          className="squircle inline-flex items-center gap-2 bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground outline-none transition-opacity duration-[--dur-pop] hover:opacity-90 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          Create link
        </button>
      </div>
    </div>
  )
}

function Toggle(
  { on, set, label, hint }:
  { on: boolean; set: (v: boolean) => void; label: string; hint: string }
) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox" checked={on} onChange={(e) => set(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--glow))]"
      />
      <span className="min-w-0">
        <span className="block text-[13px] text-foreground">{label}</span>
        <span className="block text-[12px] leading-relaxed text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}
