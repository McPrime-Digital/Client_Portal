import { userOrgId } from '@/lib/auth/role'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getBusinessSettings, upsertBusinessSettings } from '@/lib/businessSettings'
import { tenantBrand } from '@/lib/tenantBrand'
import { rosterName, orgAccessOf } from '@/lib/team'
import { type OrgCap } from '@/lib/permissions'
import { hasCap } from '@/lib/capabilities.server'
import type { User } from '@supabase/supabase-js'
import { createNotification } from '@/lib/notify'

// All invoice writes go through here. Bank/wire workflow today; Stripe/card can
// slot in later via payment_method without schema changes.
//
// A DELETED CLAIM, AND WHY (Batch 24 item 1a). This header used to say the
// browser client could not write invoices "which RLS blocks". It does not:
// `invoices_crew_all` is an ALL policy gated on `is_org_member()`, and the
// item-0 audit probe — signed in as a roster 'member' on the anon key — both
// INSERTED and UPDATED invoice rows through PostgREST. The sentence asserted a
// control that was never there, which is worse than asserting none, because it
// is the reason nobody looked. Migration 0052 is what makes it true; until then
// the gate below is the only one.
//
// THE GATE IS THE CAPABILITY, NOT THE CLAIM. It used to be `isAdmin(user)`,
// which reads app_metadata.role — and app/api/admin/team/route.ts stamps that
// 'admin' on EVERY crew invite at every roster role. So any invited crew member
// could create, send, mark paid and delete invoices, while the invoices PAGE
// they could not open was gated on `client_money`. The page and the route now
// agree, and they agree on the roster rather than on a routing value.
//
// Per-action, because this route is not purely money: the three settings
// actions write `business_settings`, which holds the studio's BANK DETAILS
// (S2 §4 Class D). A single `client_money` gate would have handed those to
// `finance`, who legitimately holds money and legitimately does not hold
// org_settings — closing one over-grant by opening another.
const SETTINGS_ACTIONS = new Set(['get_settings', 'save_settings', 'save_notification_prefs'])

function capFor(action: string): OrgCap {
  return SETTINGS_ACTIONS.has(action) ? 'org.settings' : 'money.invoices'
}

async function verifyCrew() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const access = await orgAccessOf(user)
  if (access.roles.length === 0) return null
  return { user, access }
}

// INV-2026-0001 style, sequential per year.
async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const { count } = await supabaseAdmin
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .like('invoice_number', `INV-${year}-%`)
  const seq = (count ?? 0) + 1
  return `INV-${year}-${String(seq).padStart(4, '0')}`
}

export async function POST(req: NextRequest) {
  const gate = await verifyCrew()
  if (!gate) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { user } = gate  // `access` was only orgCan's argument (item 8)

  const body = await req.json()
  const { action } = body

  // A clear 403 naming what is required, not a silent empty result (S-R R-5).
  //
  // RESOLVED, NOT DERIVED (Batch 26 item 8). This read `orgCan(access.roles,
  // needed, access.extraCaps)` — which honoured a GRANT (extra_caps is the
  // grant projection) and was blind to a DENIAL. So an owner could withdraw
  // money.invoices from an admin and this route would keep issuing, sending and
  // marking paid, while migration 0053's policy refused the same person through
  // PostgREST. Route and row disagreeing is the state S-R §5 says makes neither
  // trustworthy.
  const needed = capFor(String(action ?? ''))
  if (!(await hasCap(user, needed))) {
    return NextResponse.json(
      { error: `You do not have permission for this. Required: ${needed}.` },
      { status: 403 },
    )
  }

  // The studio whose ledger this writes into (S-V §X-6).
  const studioName = (await tenantBrand(userOrgId(user))).name

  try {
    switch (action) {
      // ── List a project's invoices (service role; RLS-safe reads) ──
      case 'list_invoices': {
        const { project_id } = body
        const { data, error } = await supabaseAdmin
          .from('invoices')
          .select('*')
          .eq('project_id', project_id)
          .order('created_at', { ascending: false })
        if (error) throw error
        return NextResponse.json({ invoices: data ?? [] })
      }

      // ── Create an invoice ──────────────────────────────────
      case 'create_invoice': {
        const {
          client_id, project_id, title, amount,
          line_items, status, payment_method, due_date, notes,
          stripe_payment_url, stripe_payment_link, receipt_file_id,
        } = body
        // Accept either field name from callers; the real column is
        // `stripe_payment_url` (there is no `stripe_payment_link` column).
        const payUrl = stripe_payment_url ?? stripe_payment_link ?? null

        if (!client_id || !title?.trim()) {
          return NextResponse.json(
            { error: 'Client and title are required.' }, { status: 400 }
          )
        }
        if (!amount || Number(amount) <= 0) {
          return NextResponse.json(
            { error: 'Amount must be greater than zero.' }, { status: 400 }
          )
        }

        const finalStatus = status === 'paid' ? 'paid'
          : status === 'draft' ? 'draft' : 'unpaid'

        const invoice_number = await nextInvoiceNumber()

        const { data, error } = await supabaseAdmin
          .from('invoices')
          .insert({
            client_id,
            project_id: project_id || null,
            invoice_number,
            title: title.trim(),
            amount: Number(amount),
            status: finalStatus,
            payment_method: payment_method || 'bank_transfer',
            line_items: line_items ?? [],
            due_date: due_date || null,
            notes: notes?.trim() || null,
            stripe_payment_url: typeof payUrl === 'string' ? payUrl.trim() || null : null,
            receipt_file_id: receipt_file_id || null,
            paid_at: finalStatus === 'paid' ? new Date().toISOString() : null,
          })
          .select()
          .single()
        if (error) throw error

        await logActivity(user, studioName, data.project_id, client_id, 'invoice_issued',
          `Invoice ${invoice_number} issued`,
          `${formatUsd(Number(amount))} · ${finalStatus}`)

        // Notify the client of a new payable invoice.
        if (finalStatus === 'unpaid') {
          await createNotification({
            clientId: client_id,
            projectId: data.project_id,
            type: 'invoice_created',
            title: `New invoice ${invoice_number}`,
            body: `${formatUsd(Number(amount))} due`,
          })
        }

        return NextResponse.json({ invoice: data })
      }

      // ── Update invoice fields ──────────────────────────────
      case 'update_invoice': {
        const { invoice_id, updates } = body
        const { data, error } = await supabaseAdmin
          .from('invoices')
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq('id', invoice_id)
          .select()
          .single()
        if (error) throw error
        return NextResponse.json({ invoice: data })
      }

      // ── Mark paid / unpaid / overdue ───────────────────────
      case 'set_status': {
        const { invoice_id, status } = body
        const { data, error } = await supabaseAdmin
          .from('invoices')
          .update({
            status,
            paid_at: status === 'paid' ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', invoice_id)
          .select()
          .single()
        if (error) throw error
        await logActivity(user, studioName, data.project_id, data.client_id,
          'invoice_updated', `Invoice ${data.invoice_number} marked ${status}`, null)
        if (status === 'paid') {
          await createNotification({
            clientId: data.client_id,
            projectId: data.project_id,
            type: 'invoice_created',
            title: `Payment received — ${data.invoice_number}`,
            body: 'Your payment has been confirmed. Thank you!',
          })
        }
        return NextResponse.json({ invoice: data })
      }

      // ── Verify a client-submitted receipt → mark the invoice paid ──
      case 'verify_receipt': {
        const { invoice_id } = body
        const now = new Date().toISOString()
        const { data, error } = await supabaseAdmin
          .from('invoices')
          .update({ status: 'paid', paid_at: now, receipt_status: 'verified', updated_at: now })
          .eq('id', invoice_id)
          .select()
          .single()
        if (error) throw error
        await logActivity(user, studioName, data.project_id, data.client_id,
          'invoice_updated', `Receipt verified — ${data.invoice_number} marked paid`, null)
        await createNotification({
          clientId: data.client_id,
          projectId: data.project_id,
          type: 'invoice_created',
          title: `Payment verified — ${data.invoice_number}`,
          body: 'We confirmed your receipt. Thank you!',
        })
        return NextResponse.json({ invoice: data })
      }

      // ── Delete invoice ─────────────────────────────────────
      case 'delete_invoice': {
        const { invoice_id } = body
        const { error } = await supabaseAdmin
          .from('invoices').delete().eq('id', invoice_id)
        if (error) throw error
        return NextResponse.json({ success: true })
      }

      // ── Business / payment settings ────────────────────────
      // Per-tenant since 0018 (T-3): the org comes from the caller's session,
      // never the request body.
      case 'get_settings': {
        const data = await getBusinessSettings(userOrgId(user))
        return NextResponse.json({ settings: data ?? null })
      }

      case 'save_settings': {
        const { settings } = body
        const { data, error } = await upsertBusinessSettings(userOrgId(user), settings ?? {})
        if (error) throw error
        return NextResponse.json({ settings: data })
      }

      // Notification preferences live in their own action (isolated from the
      // business/payment save) so a missing notification_prefs column — before
      // the phase10 migration is applied — can't break the rest of settings.
      case 'save_notification_prefs': {
        const { prefs } = body
        if (!prefs || typeof prefs !== 'object') {
          return NextResponse.json({ error: 'Invalid preferences.' }, { status: 400 })
        }
        const { error } = await upsertBusinessSettings(userOrgId(user), { notification_prefs: prefs })
        if (error) {
          return NextResponse.json(
            { error: 'Could not save preferences. Apply the phase10 migration (notification_prefs column) first.' },
            { status: 500 }
          )
        }
        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err: any) {
    console.error('[invoice-actions] error:', err)
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}

function formatUsd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

async function logActivity(
  // Was `{ id, user_metadata }` — a shape that existed only to reach the
  // forgeable field. The real User type is what rosterName() needs.
  user: User,
  studioName: string,
  projectId: string | null,
  clientId: string | null,
  eventType: string,
  title: string,
  body: string | null,
) {
  try {
    await supabaseAdmin.rpc('log_activity', {
      p_project_id: projectId,
      p_client_id: clientId,
      p_actor_id: user.id,
      // ROSTER FIRST, NOT user_metadata. This read the token's metadata,
      // which the signed-in person can rewrite with
      // `auth.updateUser({ data })` — so they could choose the name recorded
      // against "invoice issued" or "receipt verified" in the ledger S0 §1
      // says settles disputes. Same forgery 7.8 closed for ownName(); this
      // site survived because it calls log_activity directly. The studio-name
      // fallback is unchanged, so attribution is the same, only trustworthy.
      p_actor_name: (await rosterName(user)) ?? studioName,
      p_actor_role: 'admin',
      p_event_type: eventType,
      p_title: title,
      p_body: body,
      p_meta: {},
    })
  } catch {
    // activity_log / RPC optional — never block the action.
  }
}
