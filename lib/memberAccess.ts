import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Keeping a member's JWT claims in step with their roster status.
 *
 * THE PROBLEM. Pausing or revoking a member updated only their roster row.
 * Their `app_metadata` kept `role: 'admin'` (crew) or `role: 'client'` +
 * `client_id` (portal), and `is_admin()` reads that claim — so RLS went on
 * answering yes. Harness assertion 6 measures exactly this.
 *
 * WHAT THIS ACTUALLY BUYS, precisely, because the two halves differ:
 *
 *   • App-level gates are immediate. proxy.ts and every route call
 *     `auth.getUser()`, which revalidates against the auth server and returns
 *     the CURRENT app_metadata — not the copy baked into the token. Studio and
 *     portal access is cut on the next request.
 *
 *   • RLS is not. Policies read `auth.jwt()`, which is the token's own claims.
 *     Those stay stale until the access token is refreshed (Supabase default
 *     TTL is one hour), so a paused member holding a live token keeps whatever
 *     database access `is_admin()` grants until then.
 *
 * There is no way to close that window with supabase-js 2.105.1:
 * `auth.admin.signOut(jwt, scope)` takes the USER'S OWN JWT, which a server
 * acting on someone else's behalf does not have, and the SDK exposes no
 * revoke-sessions-by-user-id call (createUser · deleteUser · generateLink ·
 * getUserById · inviteUserByEmail · listUsers · signOut · updateUserById).
 *
 * So this is a stopgap, exactly as S2 §9 frames it. The real fix is Class A/B
 * policies predicated on `is_org_member()` / `is_client_member()` — which read
 * the roster, where status lives, and therefore need no token refresh at all.
 * Batch 4. The Custom Access Token Hook (S2 §8) plus a short TTL shrinks the
 * residual window in the meantime.
 *
 * Errors are RETURNED, never swallowed (I-10): a claim strip that failed
 * silently would leave a paused member fully active with a success response on
 * screen.
 */

/** Statuses that must not carry an access-granting claim. */
export function statusCutsAccess(status: string | null | undefined): boolean {
  return status === 'paused' || status === 'revoked'
}

/**
 * Strip the claims that grant access, on both sides of the house.
 *
 * `organization_id` is deliberately left in place: it is a tenant identity
 * claim rather than an access grant, and `current_org()` returning null would
 * change how every Class A/D policy fails rather than whether it does. Without
 * `role` there is no studio, and without `client_id` there is no portal.
 */
export async function cutMemberAccess(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    app_metadata: { role: null, org_role: null, client_id: null },
  })
  return error ? error.message : null
}

/** Reinstate a crew member: studio access plus their stored org role. */
export async function restoreOrgAccess(
  userId: string | null | undefined,
  orgRole: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    app_metadata: { role: 'admin', org_role: orgRole ?? 'member' },
  })
  return error ? error.message : null
}

/** Reinstate a client teammate: portal access, rebound to their company. */
export async function restoreClientAccess(
  userId: string | null | undefined,
  clientId: string,
  orgId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    app_metadata: { role: 'client', client_id: clientId, ...(orgId ? { organization_id: orgId } : {}) },
  })
  return error ? error.message : null
}
