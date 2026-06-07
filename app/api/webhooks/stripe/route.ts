import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Stripe webhook — on a completed credit purchase, top up the org's balance.
export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature') ?? ''
  const body = await req.text() // raw body required for signature verification
  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET ?? '')
  } catch (e) {
    return new Response(`Webhook signature error: ${(e as Error).message}`, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as { id: string; metadata?: Record<string, string> }
    const m = s.metadata ?? {}
    if (m.kind === 'credit_topup' && m.organization_id && m.credit_cents) {
      await supabaseAdmin.rpc('add_credits', {
        p_org: m.organization_id,
        p_cents: parseInt(m.credit_cents, 10),
        p_reason: 'topup',
        p_ref: { session: s.id },
      })
    }
  }

  return NextResponse.json({ received: true })
}

export async function GET() {
  return new Response('OK')
}
