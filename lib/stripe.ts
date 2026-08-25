import 'server-only'

import Stripe from 'stripe'

// Server-only Stripe client (uses the account's default API version).
// Lazily instantiated: the constructor throws when the key is absent, and a
// module-scope instance would crash `next build`'s page-data collection in any
// environment missing STRIPE_SECRET_KEY. Call inside request handlers only.
let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  _stripe ??= new Stripe(key)
  return _stripe
}
