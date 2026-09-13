import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { can } from '@/lib/capabilities.server'
import { rosterName } from '@/lib/team'
import { recordActivity } from '@/lib/logActivity.server'

/**
 * AI SPEND LIMITS — per person and per seat class (0063).
 *
 * GET    the org's seat-class policy and every member row
 * PUT    set or clear one member's limit
 * PATCH  set or clear a seat-class DEFAULT
 *
 * ── GATED ON money.costs, NOT people.manage ────────────────────────────────
 *
 * Capping what somebody may spend is a MONEY decision, not a roster one. It
 * rides the same capability that opens Control Tower, where the consequence is
 * visible — a person who can set limits should be looking at the spend they are
 * limiting. `people.manage` would hand it to whoever runs invites, which is a
 * different job.
 *
 * ── WRITES RUN ON THE USER CLIENT ──────────────────────────────────────────
 *
 * 0063's policies carry has_cap('money.costs') on both tables, so the POLICY is
 * the control and this route is the message (R-5). The service role appears
 * nowhere here; lib/budgets.ts holds the only service-role path, and that is
 * ENFORCEMENT before a call runs rather than administration.
 *
 * ── EVERY CHANGE IS A LEDGER ROW ───────────────────────────────────────────
 *
 * A spending limit is exactly the fact somebody needs a record of when a call
 * was refused and nobody remembers setting the cap (R-8).
 */

const PERIODS = ['day', 'week', 'month'] as const

const MemberSchema = z.object({
  userId: z.string().uuid(),
  period: z.enum(PERIODS).default('month'),
  // null is MEANINGFUL: an explicit "no cap for this person", which overrides a
  // seat-class default. Clearing the limit entirely is a DELETE, not a null.
  limitCents: z.number().int().min(0).max(100_000_000).nullable(),
  hardStop: z.boolean().default(true),
  clear: z.boolean().optional(),
})

const SeatSchema = z.object({
  seatClass: z.enum(['staff', 'contractor']),
  period: z.enum(PERIODS).default('month'),
  limitCents: z.number().int().min(0).max(100_000_000),
  hardStop: z.boolean().default(true),
  clear: z.boolean().optional(),
})

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!(await can(user, 'money.budget.write'))) {
    return {
      error: NextResponse.json(
        { error: 'You do not have permission for this. Required: money.costs.' },
        { status: 403 },
      ),
    }
  }
  return { user, supabase, orgId: userOrgId(user) }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const [{ data: seats }, { data: members }] = await Promise.all([
    g.supabase.from('org_seat_budgets').select('seat_class, period, limit_cents, hard_stop'),
    g.supabase.from('member_budgets').select('user_id, period, limit_cents, hard_stop, note'),
  ])
  return NextResponse.json({ seats: seats ?? [], members: members ?? [] })
}

export async function PUT(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const parsed = MemberSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 })
  }
  const b = parsed.data

  // The target must be in THIS org, read on the user client so RLS is the
  // predicate. Without it, a uuid in the body could set a limit on another
  // studio's member — and confirm they exist, one probe at a time (T-2).
  const { data: target } = await g.supabase
    .from('organization_members').select('user_id, name').eq('user_id', b.userId).maybeSingle()
  if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })

  const actorName = (await rosterName(g.user)) ?? g.user.email?.split('@')[0] ?? 'Member'
  const who = target.name ? `“${target.name}”` : 'a member'

  if (b.clear) {
    const { error } = await g.supabase.from('member_budgets').delete()
      .eq('organization_id', g.orgId).eq('user_id', b.userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await recordActivity({
      projectId: null, clientId: null, organizationId: g.orgId,
      actorId: g.user.id, actorName, actorRole: 'admin',
      eventType: 'member_budget_changed',
      title: `Removed ${who}'s AI spend limit`,
      body: null, meta: { user_id: b.userId, cleared: true },
    })
    return NextResponse.json({ success: true })
  }

  const { data: written, error } = await g.supabase.from('member_budgets').upsert({
    organization_id: g.orgId,
    user_id: b.userId,
    period: b.period,
    limit_cents: b.limitCents,
    hard_stop: b.hardStop,
    set_by: g.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,user_id' }).select('user_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // A policy refusal matches zero rows and returns no error (§12 lesson 6).
  if ((written ?? []).length === 0) {
    return NextResponse.json({ error: 'Refused by policy — money.costs is required.' }, { status: 403 })
  }

  await recordActivity({
    projectId: null, clientId: null, organizationId: g.orgId,
    actorId: g.user.id, actorName, actorRole: 'admin',
    eventType: 'member_budget_changed',
    title: b.limitCents === null
      ? `Gave ${who} no AI spend limit`
      : `Set ${who}'s AI limit to $${(b.limitCents / 100).toFixed(2)} per ${b.period}`,
    body: null,
    meta: { user_id: b.userId, period: b.period, limit_cents: b.limitCents, hard_stop: b.hardStop },
  })
  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const parsed = SeatSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 })
  }
  const b = parsed.data
  const actorName = (await rosterName(g.user)) ?? g.user.email?.split('@')[0] ?? 'Member'

  if (b.clear) {
    const { error } = await g.supabase.from('org_seat_budgets').delete()
      .eq('organization_id', g.orgId).eq('seat_class', b.seatClass)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await recordActivity({
      projectId: null, clientId: null, organizationId: g.orgId,
      actorId: g.user.id, actorName, actorRole: 'admin',
      eventType: 'member_budget_changed',
      title: `Removed the default AI limit for ${b.seatClass}`,
      body: null, meta: { seat_class: b.seatClass, cleared: true },
    })
    return NextResponse.json({ success: true })
  }

  const { data: written, error } = await g.supabase.from('org_seat_budgets').upsert({
    organization_id: g.orgId,
    seat_class: b.seatClass,
    period: b.period,
    limit_cents: b.limitCents,
    hard_stop: b.hardStop,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,seat_class' }).select('seat_class')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if ((written ?? []).length === 0) {
    return NextResponse.json({ error: 'Refused by policy — money.costs is required.' }, { status: 403 })
  }

  await recordActivity({
    projectId: null, clientId: null, organizationId: g.orgId,
    actorId: g.user.id, actorName, actorRole: 'admin',
    eventType: 'member_budget_changed',
    // Policy, not a person: says how many it reaches, because that is the
    // difference between this and setting one limit.
    title: `Set the default AI limit for every ${b.seatClass} to $${(b.limitCents / 100).toFixed(2)} per ${b.period}`,
    body: null,
    meta: { seat_class: b.seatClass, period: b.period, limit_cents: b.limitCents, hard_stop: b.hardStop },
  })
  return NextResponse.json({ success: true })
}
