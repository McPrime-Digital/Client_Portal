import { portalClientIdByUserId } from '@/lib/team'
import 'server-only'

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
  | { clientId: string | null; prefix: string; orgId?: string | null; roomId?: string | null }
  | { error: string; status: number }

export async function resolveUploadScope(
  role: string,
  userId: string,
  projectId: string | undefined,
  bodyClientId: string | undefined,
  roomId?: string | undefined,
): Promise<Scope> {
  // ── ROOM-SCOPED (Batch 24) ──────────────────────────────────────────────
  // A channel, group, DM or broadcast has no project and often no client, so
  // neither existing branch could scope it — which is the whole reason chat
  // attachments were disabled in the new room kinds. MEMBERSHIP is the
  // authorization (MD-1): a live `room_members` seat, checked here, is
  // exactly the right to post into that room's log.
  //
  // The prefix keys on the ROOM, so an object can never be reached by
  // guessing a client or project id, and a client room's files still land
  // under the company's own prefix — the vault keeps working unchanged.
  if (roomId) {
    const { data: seat } = await supabaseAdmin
      .from('room_members')
      .select('room_id')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .is('left_at', null)
      .maybeSingle()
    if (!seat) return { error: 'Not a member of this room.', status: 403 }

    const { data: room } = await supabaseAdmin
      .from('message_rooms')
      .select('id, organization_id, client_id, archived_at, deleted_at')
      .eq('id', roomId)
      .maybeSingle()
    if (!room || room.deleted_at) return { error: 'Room not found.', status: 404 }
    if (room.archived_at) return { error: 'This room is archived — read-only.', status: 403 }

    return {
      clientId: (room.client_id as string) ?? null,
      orgId: room.organization_id as string,
      roomId,
      prefix: room.client_id
        ? `${room.client_id}/_room/${roomId}`
        : `_org/${room.organization_id}/_room/${roomId}`,
    }
  }

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
        .from('clients').select('id').eq('id', await portalClientIdByUserId(userId)).single()
      if (!clientRow || clientRow.id !== project.client_id) {
        return { error: 'Access denied.', status: 403 }
      }
      clientId = clientRow.id
    }
    return { clientId, prefix: clientId ? `${clientId}/${projectId}` : projectId }
  }

  if (role !== 'admin') {
    const { data: clientRow } = await supabaseAdmin
      .from('clients').select('id').eq('id', await portalClientIdByUserId(userId)).single()
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