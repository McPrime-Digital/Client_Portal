import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import AdminFileVault, { type AdminFileRow } from '@/components/admin/AdminFileVault'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'
import StorageMeter from '@/components/shared/StorageMeter'

const GB = 1024 ** 3
// Soft storage quota guide for the whole workspace (overridable via env).
const ADMIN_QUOTA = (Number(process.env.NEXT_PUBLIC_STORAGE_QUOTA_GB) || 250) * GB

// Embedded one-to-one relations come back as an object (or, in some
// shapes, a single-element array) — normalise both.
function rel<T>(x: T | T[] | null): T | null {
  if (Array.isArray(x)) return x[0] ?? null
  return x ?? null
}

export default async function AdminFilesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') redirect('/login')

  const { data } = await supabaseAdmin
    .from('files')
    .select(
      '*, projects(title), clients(name, company)'
    )
    .order('created_at', { ascending: false })

  const rows: AdminFileRow[] = (data ?? [])
    .filter((f) => f.client_id)
    .map((f) => {
      const project = rel(f.projects as { title: string } | { title: string }[] | null)
      const client = rel(f.clients as { name: string; company: string | null } | { name: string; company: string | null }[] | null)
      return {
        id: f.id,
        project_id: f.project_id,
        client_id: f.client_id,
        file_name: f.file_name,
        file_size: f.file_size,
        file_type: f.file_type,
        mime_type: f.mime_type,
        category: (f as { category?: string | null }).category ?? null,
        folder: (f as { folder?: string | null }).folder ?? null,
        task_id: (f as { task_id?: string | null }).task_id ?? null,
        is_final: f.is_final,
        direction: f.direction,
        created_at: f.created_at,
        client_name: client?.name ?? 'Unknown client',
        client_company: client?.company ?? null,
        project_title: project?.title ?? 'Unassigned',
      }
    })

  const allRaw = data ?? []
  const r2Bytes = allRaw.filter((f) => (f as { bucket?: string }).bucket === 'r2').reduce((a, f) => a + (f.file_size || 0), 0)
  const supabaseBytes = allRaw.filter((f) => (f as { bucket?: string }).bucket !== 'r2').reduce((a, f) => a + (f.file_size || 0), 0)

  return (
    <>
      {/* Live: new task media / deliverables / uploads appear without a reload. */}
      <RealtimeRefresh tables={['files']} pollMs={15000} />
      <div className="mb-6">
        <StorageMeter
          r2Bytes={r2Bytes}
          supabaseBytes={supabaseBytes}
          fileCount={allRaw.filter((f) => f.client_id).length}
          quotaBytes={ADMIN_QUOTA}
        />
      </div>
      <AdminFileVault files={rows} />
    </>
  )
}
