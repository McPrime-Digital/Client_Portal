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
  | { app_metadata?: { role?: string | null; client_id?: string | null; [key: string]: unknown } | null }
  | null
  | undefined

export type Role = 'admin' | 'client'

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
