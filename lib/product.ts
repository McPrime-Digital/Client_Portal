// The product's own identity — the SaaS the studio bought (S0-B PI-1/PI-2).
//
// One constant, for the same reason the origin is one accessor (S0-B §5): the
// name has already changed once. It was "Throughline" through the spec phase
// and was written into UI strings, metadata, comments, a package name and a
// storage key before it was settled, which is what made renaming it a batch
// rather than an edit. The next change should be this line.
//
// NOT for anything a client sees on the studio's behalf. The portal wears the
// TENANT's brand (lib/tenantBrand.ts); this is only for surfaces where the
// product speaks as itself — studio chrome, billing and plan notices, the
// PI-4 attribution.

export const PRODUCT_NAME = 'Genreline'

/** Sits under the wordmark in the studio shell. */
export const PRODUCT_TAGLINE = 'Studio OS'

/**
 * Contact address the product publishes to infrastructure that requires one —
 * today, the VAPID subject push services use to reach the sender. This is the
 * PRODUCT's contact, not a tenant's: push is operated centrally, so a tenant
 * address here would be wrong even once per-tenant sending exists.
 * Overridable by VAPID_SUBJECT.
 */
export const PRODUCT_CONTACT_EMAIL = 'notifications@genreline.com'
