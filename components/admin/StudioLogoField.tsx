'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Upload, Trash2, AlertCircle } from 'lucide-react'
import TenantLogo from '@/components/TenantLogo'

type Props = {
  /** The studio's name — the initial fallback when there is no logo. */
  studioName: string
  initialLogoUrl: string | null
}

/**
 * Upload the STUDIO's own logo (S-C §6, `organizations.logo_url`).
 *
 * The column has existed since migration 0001 and nothing ever wrote it, so
 * every row was null and the portal rendered an initial for every tenant. This
 * is the writer. Not to be confused with the client-company avatar
 * (`/api/portal/avatar`) — different owner, different table.
 */
export default function StudioLogoField({ studioName, initialLogoUrl }: Props) {
  const router = useRouter()
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/studio/organization/logo', { method: 'POST', body })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed.')
      setLogoUrl(json.logo_url)
      // The field updates from local state, but the sidebar, the topbar and
      // every email preview read the logo from the SERVER on render — so
      // without this the new mark only appeared after a manual reload.
      // router.refresh() re-runs the server components in place, keeping the
      // page and its scroll position.
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/studio/organization/logo', { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not remove the logo.')
      setLogoUrl(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the logo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sm:col-span-2">
      <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
        Studio logo
      </label>
      <div className="flex items-center gap-4">
        <TenantLogo name={studioName} logoUrl={logoUrl} height={56} rounded="rounded-xl" />
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {logoUrl ? 'Replace' : 'Upload'}
            </button>
            {logoUrl && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              >
                <Trash2 size={14} />
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-faint">
            Shown to your clients in their portal and on emails you send them.
            PNG or SVG, under 2 MB. Without one they see your initial.
          </p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        onChange={upload}
        className="hidden"
      />
      {error && (
        <div className="mt-2 flex items-center gap-2">
          <AlertCircle size={13} style={{ color: 'hsl(var(--destructive))' }} />
          <p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>{error}</p>
        </div>
      )}
    </div>
  )
}
