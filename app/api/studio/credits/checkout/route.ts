import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { userOrgId } from '@/lib/auth/role'
import { stripe } from '@/lib/stripe'

// Create a Stripe Checkout session to buy credits. On success the webhook tops up
// the org's balance via add_credits(). Amount is in cents ($5 min, $10k max).
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { cents } = await req.json().catch(() => ({}))
  const amount = Math.max(500, Math.min(1_000_000, Math.round(Number(cents) || 0)))
  const orgId = userOrgId(user as never)
  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'PrimeOS AI credits', description: `$${(amount / 100).toFixed(2)} in studio credits` },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      metadata: { organization_id: orgId, credit_cents: String(amount), kind: 'credit_topup' },
      success_url: `${origin}/studio/workspace/script?topup=success`,
      cancel_url: `${origin}/studio/workspace/script?topup=cancel`,
    })
    return NextResponse.json({ url: session.url })
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message ?? 'Checkout failed' }, { status: 500 })
  }
}
