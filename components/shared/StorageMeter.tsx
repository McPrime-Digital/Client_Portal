'use client'

import { HardDrive, Cloud, Database } from 'lucide-react'
import { formatBytes } from '@/lib/fileCategories'

// A storage usage meter shown at the top of the File Vault. Usage is computed
// from the `files` table (the bytes the app tracks), split by backend — R2
// (admin deliverables / chat / task media) vs Supabase Storage (uploads,
// avatars) — so users can see what's consuming space and when they're nearing
// the plan limit. Quota is a soft guide (overridable via env).
export default function StorageMeter({
  r2Bytes,
  supabaseBytes,
  fileCount,
  quotaBytes,
}: {
  r2Bytes: number
  supabaseBytes: number
  fileCount: number
  quotaBytes: number
}) {
  const used = r2Bytes + supabaseBytes
  const pct = quotaBytes > 0 ? Math.min(100, (used / quotaBytes) * 100) : 0
  const r2Pct = quotaBytes > 0 ? (r2Bytes / quotaBytes) * 100 : 0
  const supaPct = quotaBytes > 0 ? (supabaseBytes / quotaBytes) * 100 : 0
  const near = pct >= 80
  const barColor = near ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'

  return (
    <div
      className="rounded-xl p-4 sm:p-5"
      style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'hsl(var(--primary) / 0.1)' }}
          >
            <HardDrive size={18} style={{ color: 'hsl(var(--primary))' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
              Storage
            </p>
            <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {fileCount} file{fileCount !== 1 ? 's' : ''} · {formatBytes(used)} of {formatBytes(quotaBytes)}
            </p>
          </div>
        </div>
        <span
          className="text-sm font-bold tabular-nums px-2.5 py-1 rounded-full"
          style={{
            backgroundColor: near ? 'hsl(var(--destructive) / 0.12)' : 'hsl(var(--primary) / 0.1)',
            color: near ? 'hsl(var(--destructive))' : 'hsl(var(--primary))',
          }}
        >
          {Math.round(pct)}%
        </span>
      </div>

      {/* Stacked usage bar — R2 then Supabase */}
      <div className="h-2.5 rounded-full overflow-hidden flex" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
        <div className="h-full transition-all duration-500" style={{ width: `${r2Pct}%`, backgroundColor: barColor }} />
        <div className="h-full transition-all duration-500" style={{ width: `${supaPct}%`, backgroundColor: 'hsl(var(--status-blue))' }} />
      </div>

      {/* Legend / per-backend breakdown */}
      <div className="flex items-center gap-4 mt-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Cloud size={13} style={{ color: barColor }} />
          <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Cloudflare R2 · <span className="font-medium tabular-nums" style={{ color: 'hsl(var(--foreground))' }}>{formatBytes(r2Bytes)}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Database size={13} style={{ color: 'hsl(var(--status-blue))' }} />
          <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Supabase · <span className="font-medium tabular-nums" style={{ color: 'hsl(var(--foreground))' }}>{formatBytes(supabaseBytes)}</span>
          </span>
        </div>
      </div>

      {near && (
        <p className="text-xs mt-3" style={{ color: 'hsl(var(--destructive))' }}>
          You&apos;re running low on storage. Archive or remove old files, or contact us to upgrade your plan.
        </p>
      )}
    </div>
  )
}
