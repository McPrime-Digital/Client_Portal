import 'server-only'

import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/** Request-scoped memo of the authenticated user.
 *
 *  `supabase.auth.getUser()` is a NETWORK round trip to GoTrue on every call —
 *  it re-validates the JWT against the auth server, it does not read a local
 *  cookie. A single admin page load made four of them, sequentially and
 *  independently: proxy.ts, app/studio/layout.tsx, lib/studio/guard.ts, and
 *  the page module. Nothing memoized, so each paid full latency.
 *
 *  React `cache()` scopes the result to one render pass, so every call inside
 *  a single request shares one round trip. The proxy runs as a separate
 *  invocation and cannot share this — it stays at one call of its own.
 *
 *  Use this in Server Components, Route Handlers and Server Actions instead of
 *  calling `auth.getUser()` directly. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})
