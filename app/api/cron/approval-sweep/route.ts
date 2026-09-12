import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { advanceOnSilence } from '@/lib/approvals'
import { approvalActionCap } from '@/lib/permissions'
import { ORG_ROLE_BASELINE, CLIENT_ROLE_BASELINE, type OrgRole, type ClientRole } from '@/lib/capabilities'
import { recordActivity } from '@/lib/logActivity.server'
import { createNotification, createAdminNotification } from '@/lib/notify'
import { tenantBrand } from '@/lib/tenantBrand'
import { senderForTenant } from '@/lib/mailSender'
import { notificationEmail } from '@/lib/email/messages'
import { sendMail } from '@/lib/email/send'
import { appUrl } from '@/lib/appOrigin'
import { captureError } from '@/lib/errors'

/**
 * The auto-advance sweep and the reminder ladder — Batch 22 item 5 (S3-c §2).
 *
 * ── GET ONLY, AND THAT IS THE POINT ─────────────────────────────────────────
 * There is deliberately NO POST half. HANDOFF §8.3 item 4 records the defect
 * this avoids: the message-nudge cron's POST is called by PresencePulse on
 * every admin page load, so a service-role scan of every unread message runs
 * on a user-session path. The same shape here would be worse — this route
 * WRITES lapses into a contractual record and sends mail on a studio's behalf.
 * A scheduled job is the only caller.
 *
 * The item-0 audit found a SECOND, unrecorded instance of that same defect:
 * app/api/admin/deadline-check/route.ts POST auto-completed stale approval
 * gates on every admin page load. Its auto-proceed half is removed in this
 * same commit — see that file.
 *
 * ── ONE TENANT AT A TIME, EXPLICITLY ────────────────────────────────────────
 * Batch 6.7's lesson: mark_overdue_invoices() had no tenant predicate, so any
 * caller rewrote EVERY tenant's rows — and the caller turned out to be a
 * client viewing their own invoices. So the unit of work here is
 * `sweepOrg(orgId)`, and the cron ITERATES organizations rather than running
 * one unpredicated query. A bug in the scan then costs one tenant, not all of
 * them, and the failure is visible in the per-org result rather than averaged
 * away.
 *
 * ── BOUNDED, WITH THE CAP STATED ────────────────────────────────────────────
 * I-1: no operation may be unbounded, and the cap is written here rather than
 * implied by whatever limit a query happens to carry.
 */

/** Organizations examined per run. */
const MAX_ORGS_PER_RUN = 100
/** Active stages examined per organization per run. */
const MAX_STAGES_PER_ORG = 200
/** Stages actually lapsed per organization per run. A lapse writes into the
 *  permanent record and cannot be undone, so this is deliberately smaller than
 *  the scan: a runaway is capped at a number a human can review. */
const MAX_LAPSES_PER_ORG = 50
/** Reminder emails per organization per run. */
const MAX_REMINDERS_PER_ORG = 100

/**
 * The ladder, as fractions of the review window REMAINING (S3-c §2.4).
 *
 * Reminders are load-bearing here in a way they are nowhere else in the
 * product: proceeding without a response is only defensible if the record
 * proves the response was sought. "You had five days and we reminded you three
 * times" is a position; "your system approved it for us" is not.
 *
 * State is DERIVED from the ledger rather than stored in a column: every
 * reminder already has to write an `approval_reminded` event carrying its
 * channel, recipient and timestamp, so counting those events IS the rung
 * counter. A column would be a second source of truth that could disagree with
 * the evidence.
 */
const LADDER = [0.5, 0.2, 0.05]

type StageRow = {
  id: string
  approval_id: string
  seq: number
  name: string
  deadline_at: string
  status: string
}

type Recipient = { userId: string; email: string; side: 'crew' | 'client'; clientId: string | null }

/** Everyone a stage is addressed to, resolved from the rosters at send time so
 *  a departed member neither blocks nor receives (S3-core §2.4). */
async function recipientsForStage(
  stageId: string,
  orgId: string,
  approvalClientId: string | null
): Promise<Recipient[]> {
  const { data: assignees } = await supabaseAdmin
    .from('approval_assignees')
    .select('user_id, client_id, role')
    .eq('stage_id', stageId)
  if (!assignees?.length) return []

  const out = new Map<string, Recipient>()
  const userIds = assignees.map((a) => a.user_id).filter((v): v is string => !!v)
  const clientIds = assignees.map((a) => a.client_id).filter((v): v is string => !!v)
  const roles = assignees.map((a) => a.role).filter((v): v is string => !!v)

  if (userIds.length) {
    const [{ data: om }, { data: cm }] = await Promise.all([
      supabaseAdmin.from('organization_members').select('user_id, email')
        .eq('organization_id', orgId).eq('status', 'active').in('user_id', userIds),
      supabaseAdmin.from('client_members').select('user_id, email, client_id')
        .eq('organization_id', orgId).eq('status', 'active').in('user_id', userIds),
    ])
    for (const m of om ?? []) if (m.email) out.set(m.user_id, { userId: m.user_id, email: m.email, side: 'crew', clientId: null })
    for (const m of cm ?? []) if (m.email) out.set(m.user_id, { userId: m.user_id, email: m.email, side: 'client', clientId: m.client_id })
  }
  if (clientIds.length) {
    const { data: cm } = await supabaseAdmin.from('client_members').select('user_id, email, client_id')
      .eq('organization_id', orgId).eq('status', 'active').in('client_id', clientIds)
    for (const m of cm ?? []) if (m.email) out.set(m.user_id, { userId: m.user_id, email: m.email, side: 'client', clientId: m.client_id })
  }
  if (roles.length) {
    const { data: om } = await supabaseAdmin.from('organization_members').select('user_id, email, role')
      .eq('organization_id', orgId).eq('status', 'active').in('role', roles)
    for (const m of om ?? []) if (m.email) out.set(m.user_id, { userId: m.user_id, email: m.email, side: 'crew', clientId: null })
    // Role assignees on the client side are scoped to THIS approval's company
    // — never every company holding the role, which would mail other clients.
    if (approvalClientId) {
      const { data: cm } = await supabaseAdmin.from('client_members').select('user_id, email, client_id')
        .eq('organization_id', orgId).eq('client_id', approvalClientId).eq('status', 'active').in('role', roles)
      for (const m of cm ?? []) if (m.email) out.set(m.user_id, { userId: m.user_id, email: m.email, side: 'client', clientId: m.client_id })
    }
  }
  return [...out.values()]
}

/**
 * R-11 — CAN ANY ASSIGNEE STILL DECIDE?
 *
 * S-R R-11: "If a person loses the decide capability while they are the assignee
 * of an active stage, the stage waits on someone who cannot act, the window
 * lapses, and the certificate says *no response was received* about a person who
 * was silently prevented from responding."
 *
 * That is S3-c AP-2's failure mode reached through the permission layer, and it
 * is the thing the whole approvals engine exists to make impossible: the record
 * must never assert silence that was actually a lockout.
 *
 * PER BATCH 24 RULING 1 THIS CHECKS THE **ACTION**, NOT A KEY. There is no
 * `record.approval.decide` capability and there never was — Batch 22
 * deliberately made the five approval concerns ACTIONS resolving onto existing
 * stored caps (lib/permissions.ts:152-158), because every new stored string is a
 * value that can end up in an extra_caps row. So "can this person decide" is
 * orgCanApproval('decide') crew-side and clientCanApproval('decide')
 * client-side, over each assignee's own resolved capability set.
 *
 * The resolution reads the ROSTER per assignee (S-R R-2), including their
 * individual grants and denials — a DENY is exactly how someone loses the
 * ability to decide, so a check that only read role baselines would miss the case
 * this function exists for.
 */
async function anyAssigneeCanDecide(
  stageId: string,
  orgId: string,
  approvalClientId: string | null,
): Promise<{ any: boolean; examined: number }> {
  const recipients = await recipientsForStage(stageId, orgId, approvalClientId)
  if (recipients.length === 0) {
    // No live assignee at all is a DIFFERENT fact and not R-11's: the stage is
    // addressed to nobody, which auto-advance already handles (S3-core §2.4 —
    // "a departed member neither blocks nor receives"). Reporting it as blocked
    // on a permission change would be a wrong diagnosis.
    return { any: true, examined: 0 }
  }
  for (const r of recipients) {
    if (r.side === 'crew') {
      const { data: m } = await supabaseAdmin
        .from('organization_members')
        .select('id, role, roles, extra_caps')
        .eq('user_id', r.userId).eq('organization_id', orgId).eq('status', 'active')
        .maybeSingle()
      if (!m) continue
      const want = approvalActionCap('crew', 'decide')
      const roles = [m.role as OrgRole, ...((m.roles ?? []) as OrgRole[])]
      const base = new Set<string>(roles.flatMap((x) => [...(ORG_ROLE_BASELINE[x] ?? [])]))
      const set = await resolveEffective(base, 'org_member_cap_grants', m.id as string, m.extra_caps as string[] | null)
      if (set.has(want)) return { any: true, examined: recipients.length }
    } else {
      const { data: m } = await supabaseAdmin
        .from('client_members')
        .select('id, role, extra_caps')
        .eq('user_id', r.userId).eq('organization_id', orgId).eq('status', 'active')
        .maybeSingle()
      if (!m) continue
      const want = approvalActionCap('client', 'decide')
      if (want === 'never') continue
      const base = new Set<string>([...(CLIENT_ROLE_BASELINE[m.role as ClientRole] ?? [])])
      const set = await resolveEffective(base, 'client_member_cap_grants', m.id as string, m.extra_caps as string[] | null)
      if (set.has(want)) return { any: true, examined: recipients.length }
    }
  }
  return { any: false, examined: recipients.length }
}

/**
 * A member's EFFECTIVE capability set: role baseline ∪ extra_caps ∪ live grants,
 * MINUS live denials — the same order has_cap() uses, and the order is the rule.
 *
 * DENY SUBTRACTS LAST, and it must subtract from the BASELINE too. The first
 * version of this check handed the extras to clientCanApproval() instead, which
 * ORs the role baseline — so a client owner DENIED portal.approve still read as
 * able to decide, because `owner` carries it by baseline. The probe's negative
 * run caught it: the stage lapsed when it should have been blocked, which is
 * exactly the wrong record R-11 exists to prevent.
 *
 * Not resolveCaps(): that answers for the CALLER through their own session, and
 * this cron has no session and must answer about somebody else.
 */
async function resolveEffective(
  baseline: Set<string>,
  table: 'org_member_cap_grants' | 'client_member_cap_grants',
  memberId: string,
  extraCaps: string[] | null,
): Promise<Set<string>> {
  const set = new Set<string>([...baseline, ...(extraCaps ?? [])])
  const { data } = await supabaseAdmin
    .from(table).select('capability, mode, expires_at')
    .eq('member_id', memberId).is('revoked_at', null)
  const now = Date.now()
  const live = (data ?? []).filter((g) => !g.expires_at || Date.parse(g.expires_at as string) > now)
  for (const g of live) if (g.mode === 'grant') set.add(g.capability as string)
  for (const g of live) if (g.mode === 'deny') set.delete(g.capability as string)
  return set
}

async function sweepOrg(orgId: string) {
  const now = Date.now()
  let reminded = 0
  let lapsed = 0
  let blocked = 0

  // Only 'active' stages with a deadline. AP-3 is enforced by this predicate:
  // 'blocked_on_changes' is NOT silent — someone asked for changes and the
  // work is in flight — so it can never be reached from here.
  const { data: stageData, error } = await supabaseAdmin
    .from('approval_stages')
    .select('id, approval_id, seq, name, deadline_at, status, approvals!inner(id, organization_id, client_id, project_id, title, status, review_window_hours)')
    .eq('status', 'active')
    .not('deadline_at', 'is', null)
    .eq('approvals.organization_id', orgId)   // the tenant predicate (I-9, 6.7)
    .is('approvals.deleted_at', null)
    .in('approvals.status', ['open', 'changes_requested'])
    .order('deadline_at', { ascending: true })
    .limit(MAX_STAGES_PER_ORG)
  if (error) throw new Error(`sweepOrg(${orgId}) stage scan: ${error.message}`)

  const stages = (stageData ?? []) as unknown as (StageRow & {
    approvals: { id: string; organization_id: string; client_id: string | null; project_id: string | null; title: string; review_window_hours: number | null }
  })[]
  if (stages.length === 0) return { reminded: 0, lapsed: 0, blocked: 0, scanned: 0 }

  const brand = await tenantBrand(orgId)
  const sender = senderForTenant(brand)
  const orgWindow = (
    await supabaseAdmin.from('organizations').select('approval_window_hours').eq('id', orgId).maybeSingle()
  ).data?.approval_window_hours ?? 120

  // One query for the whole org's reminder history, grouped in memory — a
  // per-stage query would be N round trips inside a bounded loop, which is the
  // shape I-1 exists to keep out.
  const { data: sentEvents } = await supabaseAdmin
    .from('activity_log')
    .select('meta')
    .eq('organization_id', orgId)
    .eq('event_type', 'approval_reminded')
    .order('created_at', { ascending: false })
    .limit(2000)
  // DISTINCT RUNGS, not event count. There is one event per RECIPIENT, so
  // counting events made a stage with three assignees look like three rungs
  // already sent — and the ladder would then go permanently silent on exactly
  // the approvals with the most people waiting on them. Found by probe.
  // Tracking the highest rung reached also makes the ladder a POSITION rather
  // than a tally: a stage that jumps from "nothing due" to "rung 3 due"
  // between two daily runs sends ONE reminder recorded as rung 3, instead of
  // three reminders on three consecutive days.
  const rungsSent = new Map<string, number>()
  for (const e of sentEvents ?? []) {
    const meta = e.meta as { stage_id?: string; rung?: number } | null
    if (!meta?.stage_id || typeof meta.rung !== 'number') continue
    rungsSent.set(meta.stage_id, Math.max(rungsSent.get(meta.stage_id) ?? 0, meta.rung))
  }

  for (const stage of stages) {
    const approval = stage.approvals
    const deadline = Date.parse(stage.deadline_at)
    const windowMs = (approval.review_window_hours ?? orgWindow) * 3600_000

    // ── past the window: lapse it ──────────────────────────────────────────
    if (deadline <= now) {
      if (lapsed >= MAX_LAPSES_PER_ORG) continue
      try {
        // R-11 FIRST. If nobody the stage is addressed to can still decide, this
        // is NOT silence and must not be recorded as it — the stage is blocked
        // on a permission change, which is our configuration error, not the
        // client's non-response. A silent stall is worse than an error (the
        // reason Batch 22's three triggers exist), and a WRONG RECORD is worse
        // than either: the certificate is the dispute surface.
        const decide = await anyAssigneeCanDecide(stage.id, orgId, approval.client_id)
        if (!decide.any) {
          const { error: blockErr } = await supabaseAdmin
            .from('approval_stages')
            .update({ status: 'blocked_on_permission' })
            .eq('id', stage.id)
            .eq('status', 'active')   // never clobber a stage that just moved
          if (blockErr) throw new Error(`blocked_on_permission: ${blockErr.message}`)
          blocked++
          await recordActivity({
            projectId: approval.project_id, clientId: approval.client_id, organizationId: orgId,
            actorId: null, actorName: 'System', actorRole: null,
            eventType: 'approval_blocked_on_permission',
            title: `Review blocked: nobody assigned to “${approval.title}” can approve it`,
            body: null,
            meta: {
              approval_id: approval.id, stage_id: stage.id, stage_seq: stage.seq,
              assignees_examined: decide.examined, deadline_at: stage.deadline_at,
            },
          })
          // Tell the STUDIO, not the client: this is the studio's configuration
          // to fix, and telling a client their reviewer was locked out is both
          // useless to them and an internal disclosure.
          await createAdminNotification({
            clientId: approval.client_id, projectId: approval.project_id,
            type: 'task_updated',
            title: 'A review is blocked by a permission change',
            body: `Nobody assigned to “${approval.title}” can approve it. Restore their access or reassign the stage.`,
          })
          continue
        }

        // advanceOnSilence writes 'auto_advanced' with NO actor and NO
        // approval_decisions row (AP-2), and its own ledger event carrying the
        // deadline it passed.
        const result = await advanceOnSilence(supabaseAdmin, stage.id)
        if (!result) continue
        lapsed++

        // Tell both sides it happened. An auto-advance nobody saw is the
        // support ticket S3-c §8 q2 warns about.
        const line = `No response was received by the review date on “${approval.title}”. Work has proceeded.`
        await createNotification({
          clientId: approval.client_id, projectId: approval.project_id,
          type: 'task_updated', title: 'A review window closed', body: line,
        })
        await createAdminNotification({
          clientId: approval.client_id, projectId: approval.project_id,
          type: 'task_updated', title: 'Approval auto-advanced (no response)', body: approval.title,
        })
      } catch (e) {
        captureError(e, { where: 'approval-sweep lapse', orgId, stageId: stage.id })
      }
      continue
    }

    // ── inside the window: which rung is due? ──────────────────────────────
    if (reminded >= MAX_REMINDERS_PER_ORG) continue
    const remainingFraction = (deadline - now) / windowMs
    // The HIGHEST rung this stage has reached, not how many have elapsed.
    const dueRung = LADDER.filter((f) => remainingFraction <= f).length
    const highestSent = rungsSent.get(stage.id) ?? 0
    if (dueRung === 0 || highestSent >= dueRung) continue

    const recipients = await recipientsForStage(stage.id, orgId, approval.client_id)
    if (recipients.length === 0) continue

    const hoursLeft = Math.max(1, Math.round((deadline - now) / 3600_000))
    const title = `Review reminder: “${approval.title}”`
    const body =
      `This is waiting on your review. If we do not hear back within about ` +
      `${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}, work will proceed under the ` +
      `review window in our agreement. This is not a request for approval by default — ` +
      `you can approve or request changes at any time before then.`

    for (const r of recipients) {
      // Sender resolved from the TENANT, never configuration (S-C CM-3). The
      // studio is writing to its own client; Genreline never appears.
      const delivered = sender
        ? await sendMail(r.email, notificationEmail(brand, { title, body, url: appUrl('/approvals') }), sender)
        : false

      // THE LEDGER EVENT IS THE PROTECTION, not a log line. Channel, recipient
      // and timestamp, per reminder, because proceeding without a response has
      // to be provable (S3-c §2.4). Written whether or not delivery succeeded,
      // with the outcome recorded — "we tried and it bounced" is a different
      // fact from "we never wrote", and hiding the difference is the failure.
      await recordActivity({
        projectId: approval.project_id, clientId: approval.client_id, organizationId: orgId,
        actorId: null, actorName: 'System', actorRole: null,
        eventType: 'approval_reminded',
        title: `Reminder ${dueRung} sent for “${approval.title}”`,
        body: null,
        meta: {
          approval_id: approval.id, stage_id: stage.id, stage_seq: stage.seq,
          rung: dueRung, channel: 'email', recipient: r.email, recipient_user_id: r.userId,
          side: r.side, delivered, deadline_at: stage.deadline_at, sent_at: new Date().toISOString(),
        },
      })
      reminded++
    }
  }

  return { reminded, lapsed, blocked, scanned: stages.length }
}

export async function GET(req: NextRequest) {
  // FAIL CLOSED — the same posture the nudge cron was corrected to. This route
  // writes lapses into a contractual record and sends mail as a studio; an
  // unset secret is a misconfiguration to report, never a reason to skip
  // authorization (I-8).
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/approval-sweep] CRON_SECRET is not set; refusing to run.')
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on this deployment. Set it before the cron can run.' },
      { status: 500 }
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data: orgs } = await supabaseAdmin
      .from('organizations').select('id, name').order('created_at').limit(MAX_ORGS_PER_RUN)

    const results: Record<string, { reminded: number; lapsed: number; scanned: number }> = {}
    let reminded = 0
    let lapsed = 0
    for (const org of orgs ?? []) {
      try {
        const r = await sweepOrg(org.id)
        results[org.id] = r
        reminded += r.reminded
        lapsed += r.lapsed
      } catch (e) {
        // One tenant's failure must not stop the others — the whole reason the
        // sweep is per-org rather than one query.
        captureError(e, { where: 'approval-sweep org', orgId: org.id })
        results[org.id] = { reminded: 0, lapsed: 0, scanned: -1 }
      }
    }
    return NextResponse.json({ ok: true, orgs: (orgs ?? []).length, reminded, lapsed, results })
  } catch (e) {
    captureError(e, { where: 'approval-sweep GET' })
    return NextResponse.json({ ok: false, error: 'sweep failed' }, { status: 500 })
  }
}
