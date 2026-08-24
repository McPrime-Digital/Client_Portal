import 'server-only'

import Stripe from 'stripe'

// Server-only Stripe client (uses the account's default API version).
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '')