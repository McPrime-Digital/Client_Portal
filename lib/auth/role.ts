// Centralised, secure role / identity reads.
//
// SECURITY: `role` and `client_id` live in `app_metadata`, which ONLY the
// service-role key can write. They must NEVER be read from `user_metadata`,
// which the end user can edit themselves via `supabase.auth.updateUser({ data })`.
// Trusting user_metadata for authorization is a privilege-escalation hole
// (any client could set role=admin). Every role/client_id check in the app
// goes through these helpers so the trust anchor stays in one place.

// The index signature keeps this assignable from Supabase's `User`
// (whose app_metadata is `{ provider?; providers?; [k]: any }`) and
// avoids TS's weak-type check.
type WithAppMetadata =
  | { app_metadata?: { role?: string | null; client_id?: string | null; organization_id?: string | null; [key: string]: unknown } | null }
  | null
  | undefined

export type Role = 'admin' | 'client'

// Sentinel id of the default "McPrime" org (single-tenant mode). Matches the
// fixed id seeded in 0001_multitenancy.sql and the organization_id column default.
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001'

/** The user's role, sourced from the tamper-proof app_metadata. Defaults to 'client'. */
export function userRole(user: WithAppMetadata): Role {
  return user?.app_metadata?.role === 'admin' ? 'admin' : 'client'
}

/** True only when the verified app_metadata role is 'admin'. */
export function isAdmin(user: WithAppMetadata): boolean {
  return user?.app_metadata?.role === 'admin'
}

/** The client_id the user is bound to, from app_metadata. */
export function userClientId(user: WithAppMetadata): string | null {
  return user?.app_metadata?.client_id ?? null
}

/** The org the user belongs to, from app_metadata. Falls back to the default
 *  (McPrime) org while single-tenant. Consumed by tenant-aware writes + (later) RLS. */
export function userOrgId(user: WithAppMetadata): string {
  return user?.app_metadata?.organization_id ?? DEFAULT_ORG_ID
}
