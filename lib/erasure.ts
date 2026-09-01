import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Person-level data erasure — AD-003's second half, built.
 *
 * AD-003 decided "tombstone, never cascade": deleting a person never deletes
 * their work. Migration 0016 delivered the cascade half (every auth.users FK
 * is ON DELETE SET NULL), but the tombstone half — replacing the denormalized
 * display names with a stable pseudonym — stayed unbuilt, which S0-conformance
 * marks PARTIAL and which made a right-to-erasure request (S0 §5: honoured
 * within 30 days) unanswerable. This module is the answer:
 *
 *   1. refuse while the person still holds any roster row or is a company's
 *      contact address — erasure is for people who have already left;
 *   2. rewrite every denormalized display name to one stable pseudonym
 *      (threads stay readable, attribution structure survives, the person is
 *      gone — AD-003's exact wording);
 *   3. scrub the raw address out of notification copy and activity metadata;
 *   4. delete the leftover 'revoked' membership tombstones that still carry
 *      the address;
 *   5. delete the auth account (FKs SET NULL; push subscriptions cascade).
 *
 * IDEMPOTENT BY ORDER: the auth delete comes last, so a failure partway
 * leaves the user id resolvable and a re-run completes the remainder. Every
 * step surfaces its error (I-10) — a half-silent erasure is worse than none.
 *
 * SERVICE ROLE, deliberately, and cross-tenant by nature: a person's rows may
 * span tenants (S1 §2), so this cannot run under one tenant's RLS. That is
 * why the ROUTE gates it to the platform operator (plan feature
 * 'platform.erasure'); per-tenant self-serve erasure is S3's schema work.
 */

export type ErasureOutcome =
  | { erased: true; pseudonym: string; touched: Record<string, number>; warnings: string[] }
  | { erased: false; reason: string }

async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  // The admin API has no email filter in this SDK version — paginate.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email)
    if (hit) return { id: hit.id }
    if (data.users.length < 1000) break
  }
  return null
}

export async function erasePerson(rawEmail: string): Promise<ErasureOutcome> {
  const email = rawEmail.trim().toLowerCase()

  const authUser = await findAuthUserByEmail(email)

  // ── refusals: erasure is for the departed ─────────────────────────────────
  const { data: company, error: companyErr } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .eq('email', email)
    .limit(1)
    .maybeSingle()
  if (companyErr) throw new Error(`clients check: ${companyErr.message}`)
  if (company) {
    return {
      erased: false,
      reason: `This address is the contact email of the company "${company.name}". Edit or delete the company first.`,
    }
  }

  const membershipFilter = authUser
    ? `email.eq.${email},user_id.eq.${authUser.id}`
    : `email.eq.${email}`
  const { data: clientRows, error: cmErr } = await supabaseAdmin
    .from('client_members')
    .select('id, status')
    .or(membershipFilter)
  if (cmErr) throw new Error(`client_members check: ${cmErr.message}`)
  if ((clientRows ?? []).some((r) => r.status !== 'revoked')) {
    return { erased: false, reason: 'This person is still on a client team. Remove them from the roster first.' }
  }

  const { data: orgRows, error: omErr } = await supabaseAdmin
    .from('organization_members')
    .select('id, status')
    .or(membershipFilter)
  if (omErr) throw new Error(`organization_members check: ${omErr.message}`)
  if ((orgRows ?? []).some((r) => r.status !== 'revoked')) {
    return { erased: false, reason: 'This person is still on a crew roster. Revoke their seat first.' }
  }

  const warnings: string[] = []
  const { data: bizRows } = await supabaseAdmin
    .from('business_settings')
    .select('id')
    .eq('business_email', email)
  if ((bizRows ?? []).length > 0) {
    warnings.push('The address is also a business_settings.business_email — clear it in Settings if it should go too.')
  }

  const touched: Record<string, number> = {}
  const count = (table: string, n: number | null) => {
    touched[table] = (touched[table] ?? 0) + (n ?? 0)
  }

  // ── the tombstone: one stable pseudonym everywhere the person spoke ───────
  if (authUser) {
    const uid = authUser.id
    const pseudonym = `Former member ${uid.slice(0, 8)}`

    const nameSweeps = [
      { table: 'messages', run: () => supabaseAdmin.from('messages').update({ sender_name: pseudonym }, { count: 'exact' }).eq('sender_id', uid) },
      // files carries two author columns from different eras — sweep both.
      { table: 'files', run: () => supabaseAdmin.from('files').update({ uploaded_by_name: pseudonym }, { count: 'exact' }).or(`uploaded_by.eq.${uid},uploaded_by_id.eq.${uid}`) },
      { table: 'activity_log', run: () => supabaseAdmin.from('activity_log').update({ actor_name: pseudonym }, { count: 'exact' }).eq('actor_id', uid) },
      { table: 'document_versions', run: () => supabaseAdmin.from('document_versions').update({ created_by_name: pseudonym }, { count: 'exact' }).eq('created_by', uid) },
      { table: 'document_comments', run: () => supabaseAdmin.from('document_comments').update({ author_name: pseudonym }, { count: 'exact' }).eq('author_id', uid) },
    ]
    for (const sweep of nameSweeps) {
      const { count: n, error } = await sweep.run()
      if (error) throw new Error(`${sweep.table} tombstone: ${error.message}`)
      count(sweep.table, n)
    }

    // ── the raw address, scrubbed from copy that embedded it ────────────────
    // Invite events wrote the address into notification bodies
    // (app/api/portal/team, app/api/admin/client-team) — rewrite in place.
    const likePattern = `%${email.replace(/([%_\\])/g, '\\$1')}%`
    const emailRe = new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const hits = new Map<string, { title: string; body: string | null }>()
    for (const col of ['title', 'body'] as const) {
      const { data, error } = await supabaseAdmin
        .from('notifications')
        .select('id, title, body')
        .ilike(col, likePattern)
      if (error) throw new Error(`notifications scan: ${error.message}`)
      for (const n of data ?? []) hits.set(n.id, { title: n.title, body: n.body })
    }
    for (const [id, n] of hits) {
      const { error } = await supabaseAdmin
        .from('notifications')
        .update({
          title: n.title.replace(emailRe, pseudonym),
          body: n.body ? n.body.replace(emailRe, pseudonym) : n.body,
        })
        .eq('id', id)
      if (error) throw new Error(`notifications scrub: ${error.message}`)
    }
    count('notifications', hits.size)

    // Invite metadata (app/api/admin/invite-client wrote { email } into meta).
    const { data: metaRows, error: metaErr } = await supabaseAdmin
      .from('activity_log')
      .select('id, meta')
      .eq('meta->>email', email)
    if (metaErr) throw new Error(`activity_log meta scan: ${metaErr.message}`)
    for (const row of metaRows ?? []) {
      const { error } = await supabaseAdmin
        .from('activity_log')
        .update({ meta: { ...(row.meta as Record<string, unknown>), email: pseudonym } })
        .eq('id', row.id)
      if (error) throw new Error(`activity_log meta scrub: ${error.message}`)
    }
    count('activity_log_meta', (metaRows ?? []).length)

    // ── revoked membership tombstones still naming the address ──────────────
    for (const table of ['client_members', 'organization_members'] as const) {
      const { count: n, error } = await supabaseAdmin
        .from(table)
        .delete({ count: 'exact' })
        .or(membershipFilter)
      if (error) throw new Error(`${table} delete: ${error.message}`)
      count(table, n)
    }

    // ── last: the account itself (FKs SET NULL; push subs cascade — 0016) ───
    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(uid)
    if (delErr) throw new Error(`deleteUser: ${delErr.message}`)
    count('auth_user', 1)

    return { erased: true, pseudonym, touched, warnings }
  }

  // No auth account (never invited, or already erased) — there may still be
  // revoked membership rows carrying the address. Take those and finish.
  for (const table of ['client_members', 'organization_members'] as const) {
    const { count: n, error } = await supabaseAdmin
      .from(table)
      .delete({ count: 'exact' })
      .eq('email', email)
    if (error) throw new Error(`${table} delete: ${error.message}`)
    count(table, n)
  }
  const anyRows = Object.values(touched).some((n) => n > 0)
  if (!anyRows) {
    return { erased: false, reason: 'No account or records found for that address.' }
  }
  return { erased: true, pseudonym: '', touched, warnings }
}
