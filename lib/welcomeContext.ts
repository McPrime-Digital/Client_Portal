/**
 * What `/api/auth/welcome-context` answers: who has just arrived, whose brand
 * they should see, and where they belong.
 *
 * Shared type rather than a local one, because the same three audiences drive
 * the invite email (`lib/email/messages.ts`), this landing page, and the
 * dashboard welcome — and the three must not drift apart. A client company's
 * owner, a colleague they invited, and a studio's crew member are three
 * different relationships; copy that treats them as one is the "done just like
 * that" feel the owner flagged.
 *
 * Not `server-only`: the set-password page is a client component and needs the
 * shape. It carries no logic and no secrets.
 */
export type WelcomeAudience = 'client_owner' | 'client_teammate' | 'crew' | 'unknown'

export type WelcomeContext = {
  audience: WelcomeAudience
  /** The studio doing the inviting. Null when it could not be resolved. */
  studioName?: string | null
  studioLogoUrl?: string | null
  /** The client company being joined — teammates only. */
  companyName?: string | null
  firstName?: string | null
  /** Where this person belongs once their password is set. */
  next: string
}
