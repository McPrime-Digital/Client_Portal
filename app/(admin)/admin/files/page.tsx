import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import AdminFileVault, { type AdminFileRow } from '@/components/admin/AdminFileVault'

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
      'id, project_id, client_id, file_name, file_size, file_type, mime_type, is_final, direction, created_at, projects(title), clients(name, company)'
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
        is_final: f.is_final,
        direction: f.direction,
        created_at: f.created_at,
        client_name: client?.name ?? 'Unknown client',
        client_company: client?.company ?? null,
        project_title: project?.title ?? 'Unassigned',
      }
    })

  return <AdminFileVault files={rows} />
}
