import 'server-only'

import { DEFAULT_ORG_ID } from '@/lib/auth/role'

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

export function planLimits(orgId: string, plan?: string | null): PlanLimits {
  if (orgId === DEFAULT_ORG_ID) return PLANS.house
  return PLANS[(plan as PlanId) ?? 'agency'] ?? PLANS.agency
}

/** True when the org may add one more of `used` against a numeric limit. */
export function withinLimit(limit: number | null, used: number): boolean {
  return limit === null || used < limit
}
