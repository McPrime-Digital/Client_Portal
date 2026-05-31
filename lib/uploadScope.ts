import { supabaseAdmin } from '@/lib/supabase/admin'

// Resolves an upload's client/project scope and the R2 key prefix,
// enforcing that the caller may write there. Shared by /api/files/presign
// and /api/files/commit so the key namespacing and authorization match.
//
// - project-scoped: prefix `<clientId>/<projectId>` (or `<projectId>` if
//   the project has no client) — the common case.
// - client-scoped (no projectId): prefix `<clientId>/_general` — used for
//   things like invoice receipts that aren't tied to a project.
export type Scope =
  | { clientId: string | null; prefix: string }
  | { error: string; status: number }

export async function resolveUploadScope(
  role: string,
  userId: string,
  projectId: string | undefined,
  bodyClientId: string | undefined,
): Promise<Scope> {
  if (projectId) {
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id, client_id')
      .eq('id', projectId)
      .single()
    if (!project) return { error: 'Project not found.', status: 404 }

    let clientId: string | null = project.client_id ?? null
    if (role !== 'admin') {
      const { data: clientRow } = await supabaseAdmin
        .from('clients').select('id').eq('user_id', userId).single()
      if (!clientRow || clientRow.id !== project.client_id) {
        return { error: 'Access denied.', status: 403 }
      }
      clientId = clientRow.id
    }
    return { clientId, prefix: clientId ? `${clientId}/${projectId}` : projectId }
  }

  if (role !== 'admin') {
    const { data: clientRow } = await supabaseAdmin
      .from('clients').select('id').eq('user_id', userId).single()
    if (!clientRow) return { error: 'Client not found.', status: 403 }
    if (bodyClientId && bodyClientId !== clientRow.id) {
      return { error: 'Access denied.', status: 403 }
    }
    return { clientId: clientRow.id, prefix: `${clientRow.id}/_general` }
  }
  if (!bodyClientId) {
    return { error: 'projectId or clientId is required.', status: 400 }
  }
  return { clientId: bodyClientId, prefix: `${bodyClientId}/_general` }
}
