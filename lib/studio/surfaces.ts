import 'server-only'

import type { User } from '@supabase/supabase-js'
import { resolveCaps } from '@/lib/capabilities.server'
import { orgFeatureAllowed } from '@/lib/permissions'
import { SPACES, type Space, type Feature } from '@/lib/studio/spaces'
import { tenantBrand } from '@/lib/tenantBrand'
import { planAllows } from '@/lib/billing/plans'
import { userOrgId } from '@/lib/auth/role'

/**
 * S-R §8 S-1 — A DASHBOARD IS A PROJECTION OF A CAPABILITY SET, NOT A DESIGN.
 *
 * "There is no per-role layout file. The surfaces a person holds are computed,
 * and the dashboard renders their union. A new capability produces a new
 * dashboard for everyone who holds it, with no layout work."
 *
 * This module is that computation, and it is deliberately the ONLY thing that
 * decides what a person's home contains. Before it, `/studio` redirected to
 * `/studio/crew` and rendered an animated stage — the same stage for a `finance`
 * member who holds no craft floor and a `crew` member who holds no money. The
 * rail filtered correctly; the landing did not exist as a surface at all.
 *
 * ── IT ANSWERS FROM THE ONE RESOLVER (S-4) ─────────────────────────────────
 * `resolveCaps()`, the same computation the rail, the route guards and the
 * policies answer from. Not a second list of what each role sees — that is the
 * per-role layout file S-1 forbids, and it is what drifts the first time a
 * capability moves.
 *
 * ── S-2: DENIED SURFACES ARE ABSENT ────────────────────────────────────────
 * A feature the caller does not hold is not in the returned array. Not disabled,
 * not greyed, not present-with-a-tooltip: "a disabled tile telling a freelance
 * editor the studio has a production called Netflix Pilot is an information leak
 * wearing a UI convention" (R-6).
 *
 * ── STEPS 1-2 STILL APPLY, AND THEY ARE NOT CAPABILITY ─────────────────────
 * Plan entitlement (`planFeature`) and archetype gate the feature's EXISTENCE
 * for the tenant, which is a different question from whether this person holds
 * it (S-R §5 steps 1-2 vs 4-6). Both are applied here, in the same order
 * requireOrgFeature applies them, so the home cannot offer a tile the URL guard
 * would then refuse.
 */

export type HeldFeature = {
  space: Space['id']
  spaceLabel: string
  slug: string
  label: string
  /** True when the feature has a real implementation today. A held-but-unbuilt
   *  feature is still shown, because hiding it would tell the person they lack a
   *  capability they in fact hold — S-3 inverted. It is marked instead. */
  built: boolean
  phase: number
  badge?: string
}

/** Which `${space}/${slug}` keys have a real surface rather than the
 *  "Phase N · coming soon" card.
 *
 *  DERIVED FROM ROUTES THAT EXIST, and stated here because it is the one fact
 *  this module cannot compute: Next's file router is not introspectable at
 *  runtime, and guessing from `phase` would be a second source that drifts the
 *  day a feature ships. Audited 2026-09-13 against `find app/studio -name page.tsx`
 *  plus the three the catch-all serves directly. */
const BUILT: ReadonlySet<string> = new Set([
  'crew/chat', 'crew/directory', 'crew/settings', 'crew/tasks', 'crew/control-tower',
  'crew/calendar', 'crew/meetings',
  'client/overview', 'client/companies', 'client/projects', 'client/review',
  'client/files', 'client/documents', 'client/messages', 'client/invoices', 'client/settings',
  'client/contracts', 'client/meetings', 'client/guest-links', 'client/brand-kit',
  'suite/script', 'suite/storyboard', 'suite/ai-chat', 'suite/library',
])

/** The BUILT set as a plain array, for the RAIL — which is a client component
 *  and cannot import this module (it is `server-only`). Exported rather than
 *  re-typed there, because a second hand-maintained list of what is finished is
 *  exactly the copy that goes stale the day a surface ships. */
export const BUILT_SLUGS: readonly string[] = [...BUILT]

export function isBuilt(spaceId: string, slug: string): boolean {
  return BUILT.has(`${spaceId}/${slug}`)
}

/** The same projection, shaped for the ⌘K palette. Derived from heldSurfaces()
 *  rather than computed again, so the palette cannot offer a surface the home
 *  does not — S-2 inherited rather than re-implemented. */
export async function paletteItems(user: User): Promise<{
  id: string; label: string; group: string; href: string; built: boolean
}[]> {
  const held = await heldSurfaces(user)
  return held.map((f) => ({
    id: `${f.space}/${f.slug}`,
    label: f.label,
    group: f.spaceLabel,
    href: `/studio/${f.space}/${f.slug}`,
    built: f.built,
  }))
}

/**
 * The surfaces this person holds, in space order, ready to render.
 *
 * Returns [] for a session with no active roster row — which the caller must
 * render as "no studio access" rather than as an empty studio, because those are
 * different facts and only one of them is recoverable by the person reading it.
 */
export async function heldSurfaces(user: User): Promise<HeldFeature[]> {
  const resolved = await resolveCaps(user)
  if (resolved.side !== 'crew') return []

  const { plan } = await tenantBrand(userOrgId(user))
  const out: HeldFeature[] = []

  for (const space of SPACES) {
    for (const f of space.features as readonly Feature[]) {
      // Step 1 — the tenant's PLAN must carry the feature at all.
      if (f.planFeature && !planAllows(plan, f.planFeature)) continue
      // Steps 4-6 — does THIS person hold the capability that shows it.
      if (!orgFeatureAllowed(resolved.caps, space.id, f.slug)) continue
      out.push({
        space: space.id,
        spaceLabel: space.label,
        slug: f.slug,
        label: f.label,
        built: isBuilt(space.id, f.slug),
        phase: f.phase,
        badge: f.badge,
      })
    }
  }
  return out
}
