import 'server-only'

// The single entitlement read path. organizations.plan names a tier; this map
// gives each tier its limits. Metered launch = every gate open + credits
// charged per use; subscription launch = these quotas enforced with overage to
// credits; hybrid = both. The gates exist from day one so flipping the model
// is a pricing change, not a refactor.
//
// null = unlimited. The house org bypasses every gate but is still metered.
export type PlanId = 'house' | 'agency' | 'studio' | 'enterprise'

export type PlanLimits = {
  orgSeats: number | null
  clientCompanies: number | null
  storageGb: number | null
  meetingMinutesPerMonth: number | null
  whiteLabel: boolean
  sso: boolean
}

export const PLANS: Record<PlanId, PlanLimits> = {
  // the owner's own org — never gated
  house: { orgSeats: null, clientCompanies: null, storageGb: null, meetingMinutesPerMonth: null, whiteLabel: true, sso: true },
  agency: { orgSeats: 5, clientCompanies: 25, storageGb: 500, meetingMinutesPerMonth: 3000, whiteLabel: false, sso: false },
  studio: { orgSeats: 20, clientCompanies: null, storageGb: 2000, meetingMinutesPerMonth: 10000, whiteLabel: true, sso: false },
  enterprise: { orgSeats: null, clientCompanies: null, storageGb: null, meetingMinutesPerMonth: null, whiteLabel: true, sso: true },
}

// THE HOUSE ORG'S EXEMPTION IS ITS PLAN, NOT ITS ID. This read
// `if (orgId === DEFAULT_ORG_ID) return PLANS.house` — a hardcoded McPrime
// identity (P-1), and the last instance of the shape Batch 8.5 removed from
// lib/credits.ts. HANDOFF §8.3 item 5 made removing it the price of giving this
// file its first importer, which Batch 9.5 does. The exemption is now stated
// where every other per-org decision is stated: organizations.plan says
// 'house'. Same precedent as the org_budgets opt-out row (8.5) and scope_mode
// (0018 A5) — a stated decision, never an inferred one.
//
// The orgId parameter is gone rather than ignored: an unused identity argument
// invites the branch back.
export function planLimits(plan?: string | null): PlanLimits {
  return PLANS[(plan as PlanId) ?? 'agency'] ?? PLANS.agency
}

// ── Plan features (S0-B PI-4) ───────────────────────────────────────────────
// Discrete entitlements, separate from the numeric limits above, so one can be
// sold without the other. `whiteLabel` on PlanLimits is the broader promise;
// this is the single behaviour PI-4 names.
export type PlanFeature =
  /** Remove the "Powered by Genreline" attribution from client-facing surfaces. */
  | 'attribution.hide'
  /** The platform operator's internal business tools (CRM · Pipeline, Lead-Gen
   *  Pipelines) — pre-platform features kept for the house org's own selling,
   *  never advertised or sold to tenants. Not a roadmap item wearing a flag:
   *  a tenant plan must never carry this. */
  | 'internal.pipeline'
  /** Run a person-level data erasure (AD-003 tombstone + auth-account delete).
   *  Erasure pseudonymizes by user id ACROSS tenants, so until S3 ships
   *  per-tenant erasure it is a platform-operator action — house plan only. */
  | 'platform.erasure'

const PLAN_FEATURES: Record<PlanId, readonly PlanFeature[]> = {
  house: ['attribution.hide', 'internal.pipeline', 'platform.erasure'],
  agency: [],
  studio: ['attribution.hide'],
  enterprise: ['attribution.hide'],
}

/**
 * DEFAULT-DENY, and PI-4 depends on the polarity. An unset plan, an unknown
 * plan, or a plan whose list omits the key all resolve to false — which
 * resolves to the attribution being SHOWN. The correct default for an unsold
 * feature falls out of S2 §5's discipline with no special case, no per-org
 * boolean and no test for a tenant id.
 *
 * Not wired to billing, deliberately (S1-P §6): nothing sells 'attribution.hide'
 * yet, so every tenant on the default plan shows the badge. Defining the key
 * now is what keeps that a pricing change later rather than a refactor.
 */
export function planAllows(
  plan: string | null | undefined,
  feature: PlanFeature
): boolean {
  const features = PLAN_FEATURES[plan as PlanId]
  if (!features) return false
  return features.includes(feature)
}

/** True when the org may add one more of `used` against a numeric limit. */
export function withinLimit(limit: number | null, used: number): boolean {
  return limit === null || used < limit
}
