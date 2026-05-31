import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createNotification } from '@/lib/notify'

// All invoice writes go through here (service role, admin-gated) — never
// from the browser client, which RLS blocks. Mirrors the project-actions
// switch style. Bank/wire workflow today; Stripe/card can slot in later
// via payment_method without schema changes.

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') return null
  return user
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
  const user = await verifyAdmin()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { action } = body

  try {
    switch (action) {
      // ── Create an invoice ──────────────────────────────────
      case 'create_invoice': {
        const {
          client_id, project_id, title, description, amount,
          line_items, status, payment_method, due_date, notes,
          stripe_payment_link, receipt_file_id,
        } = body

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
            description: description?.trim() || null,
            amount: Number(amount),
            currency: 'USD',
            status: finalStatus,
            payment_method: payment_method || 'bank_transfer',
            line_items: line_items ?? [],
            due_date: due_date || null,
            notes: notes?.trim() || null,
            stripe_payment_link: stripe_payment_link?.trim() || null,
            receipt_file_id: receipt_file_id || null,
            paid_at: finalStatus === 'paid' ? new Date().toISOString() : null,
          })
          .select()
          .single()
        if (error) throw error

        await logActivity(user, data.project_id, client_id, 'invoice_issued',
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
        await logActivity(user, data.project_id, data.client_id,
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

      // ── Delete invoice ─────────────────────────────────────
      case 'delete_invoice': {
        const { invoice_id } = body
        const { error } = await supabaseAdmin
          .from('invoices').delete().eq('id', invoice_id)
        if (error) throw error
        return NextResponse.json({ success: true })
      }

      // ── Business / payment settings ────────────────────────
      case 'get_settings': {
        const { data } = await supabaseAdmin
          .from('business_settings').select('*').eq('id', 'singleton').single()
        return NextResponse.json({ settings: data ?? null })
      }

      case 'save_settings': {
        const { settings } = body
        const { data, error } = await supabaseAdmin
          .from('business_settings')
          .upsert({ id: 'singleton', ...settings, updated_at: new Date().toISOString() })
          .select()
          .single()
        if (error) throw error
        return NextResponse.json({ settings: data })
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
  user: { id: string; user_metadata?: { name?: string } },
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
      p_actor_name: user.user_metadata?.name ?? 'McPrime Digital',
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
