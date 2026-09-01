import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Room resolution — Batch 13 item 3 (S3-core §1.2, §9.1).
 *
 * Given an organization and a client company, return the live room or create
 * it. Creation is idempotent BECAUSE OF 0027's partial unique indexes, not
 * because of a pre-check: two concurrent first-sends both insert, one hits
 * 23505, and the loser re-selects the winner's row. Check-then-insert without
 * the index is the race this shape exists to avoid.
 *
 * Crew rooms: one per organization for now — "build for many, ship one"
 * (S3-core §9.1). The one-crew-room index in 0027 is what makes
 * ensureCrewRoom race-free; when channels ship, that index drops and this
 * helper grows a name parameter.
 *
 * Tenancy (T-5): `orgId` must be resolved by the CALLER from the verified
 * session (userOrgId / the roster) — never from the request body. The helper
 * stamps it explicitly on every insert; message_rooms.organization_id has no
 * column DEFAULT to fall back on, deliberately.
 *
 * The `db` client is a parameter rather than an import so this module adds
 * no entry to the I-8 allowlist. Today's callers (the item-5 send paths) pass
 * `supabaseAdmin` from routes that are already allowlisted; under RLS a crew
 * session could create rooms itself (0027's crew_all policy), a client
 * session could not (SELECT-only) — so any path where a client member's
 * first send creates the room must run server-side.
 */

const UNIQUE_VIOLATION = '23505'

export type MessageRoom = {
  id: string
  organization_id: string
  kind: 'client' | 'crew'
  client_id: string | null
  name: string | null
}

const ROOM_COLUMNS = 'id, organization_id, kind, client_id, name'

async function selectLiveRoom(
  db: SupabaseClient,
  orgId: string,
  kind: 'client' | 'crew',
  clientId: string | null
): Promise<MessageRoom | null> {
  let q = db
    .from('message_rooms')
    .select(ROOM_COLUMNS)
    .eq('organization_id', orgId)
    .eq('kind', kind)
    .is('deleted_at', null)
  q = kind === 'client' ? q.eq('client_id', clientId) : q.is('client_id', null)
  // maybeSingle throws on >1 row — impossible once 0027's indexes are
  // applied, and exactly the loud failure we want if they are not.
  const { data, error } = await q.maybeSingle()
  if (error) {
    throw new Error(`message_rooms lookup failed (org ${orgId}, kind ${kind}): ${error.message}`)
  }
  return (data as MessageRoom | null) ?? null
}

async function ensureRoom(
  db: SupabaseClient,
  orgId: string,
  kind: 'client' | 'crew',
  clientId: string | null,
  name: string | null,
  createdBy: string | null
): Promise<MessageRoom> {
  const existing = await selectLiveRoom(db, orgId, kind, clientId)
  if (existing) return existing

  const { data: inserted, error } = await db
    .from('message_rooms')
    .insert({
      organization_id: orgId, // stamped, never defaulted (T-5)
      kind,
      client_id: clientId,
      name,
      created_by: createdBy,
    })
    .select(ROOM_COLUMNS)
    .single()

  if (!error) return inserted as MessageRoom

  // A concurrent writer won the insert race; 0027's partial unique index is
  // the guarantee that their row is the one live room. Read it.
  if (error.code === UNIQUE_VIOLATION) {
    const winner = await selectLiveRoom(db, orgId, kind, clientId)
    if (winner) return winner
    // 23505 with no live row means the conflict came from something other
    // than the live-room index (or the row was deleted mid-race) — surface
    // it rather than looping (I-10).
    throw new Error(
      `message_rooms insert conflicted but no live room found (org ${orgId}, kind ${kind}): ${error.message}`
    )
  }

  throw new Error(`message_rooms insert failed (org ${orgId}, kind ${kind}): ${error.message}`)
}

/** The live room for a client company, created on first use. */
export async function ensureClientRoom(
  db: SupabaseClient,
  orgId: string,
  clientId: string,
  createdBy: string | null = null
): Promise<MessageRoom> {
  if (!orgId) throw new Error('ensureClientRoom: orgId is required')
  if (!clientId) throw new Error('ensureClientRoom: clientId is required')
  // Client rooms take the company name at render time (0027) — name stays null.
  return ensureRoom(db, orgId, 'client', clientId, null, createdBy)
}

/** The organization's crew room (one per org until channels ship), created on first use. */
export async function ensureCrewRoom(
  db: SupabaseClient,
  orgId: string,
  createdBy: string | null = null
): Promise<MessageRoom> {
  if (!orgId) throw new Error('ensureCrewRoom: orgId is required')
  return ensureRoom(db, orgId, 'crew', null, 'General', createdBy)
}
