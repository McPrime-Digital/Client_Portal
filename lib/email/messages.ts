import 'server-only'

import { renderEmail, type RenderedEmail } from '@/lib/email/layout'
import { PRODUCT_NAME } from '@/lib/product'
import type { TenantBrand } from '@/lib/tenantBrand'

// EVERY EMAIL THE APPLICATION SENDS, in one file (S-C §6 item 2).
//
// The catalogue is deliberately short, and it is short because it covers the
// triggers that EXIST. Auditing the code for `updateUser({ email })`,
// `updateUser({ phone })` and `signUp(` returns nothing: this application has
// no email-change flow, no phone-change flow and no self-serve signup. Writing
// templates for them would be writing templates for buttons nobody can press.
// They remain Supabase dashboard templates and are listed in S-C as such.
//
// What does exist: six invite paths, one password reset, and five notification
// categories.

/** Who the invite is for. Only the copy differs — the layout does not. */
export type InviteAudience =
  /** The client company's primary contact, setting up their portal. */
  | 'client_owner'
  /** Someone the client company's owner added to their own team. */
  | 'client_teammate'
  /** Someone the studio added to its crew. */
  | 'crew'

/**
 * "Studio Two invited you" — the studio is the subject, never the person who
 * clicked the button (S-C §9 q2). That survives the inviter leaving, and it is
 * the studio the recipient is being asked to trust.
 */
export function inviteEmail(
  brand: TenantBrand,
  audience: InviteAudience,
  actionUrl: string,
  /**
   * How long the link lasts, stated because it differs by how the link was
   * minted: a fresh `invite` lasts 24 hours, the `recovery` link used for an
   * address that already has an account lasts 60 minutes. Printing "24 hours"
   * on a 60-minute link is a support ticket waiting to happen.
   */
  expiresIn: string = '24 hours'
): RenderedEmail {
  const studio = brand.resolved ? brand.name : PRODUCT_NAME

  const copy: Record<InviteAudience, { subject: string; heading: string; paragraphs: string[]; cta: string }> = {
    client_owner: {
      subject: `${studio} invited you — your client portal is ready`,
      heading: 'Your client portal is ready',
      paragraphs: [
        `${studio} has set up a secure workspace for your project. Use the link below to create your account and access your portal.`,
        'From your portal you can follow project progress, review and approve work, download deliverables, message the team, and manage invoices in one place.',
      ],
      cta: 'Access your portal',
    },
    client_teammate: {
      subject: `${studio} invited you to a shared project workspace`,
      heading: 'You have been added to a project workspace',
      paragraphs: [
        `You have been added to your company's workspace with ${studio}. Use the link below to create your account.`,
        'Depending on the access you have been given, you can follow progress, review and approve work, download files and join the conversation.',
      ],
      cta: 'Set up your account',
    },
    crew: {
      subject: `${studio} invited you to join the team`,
      heading: `You have been invited to ${studio}`,
      paragraphs: [
        `You have been invited to join ${studio}'s team workspace. Use the link below to create your account.`,
        'Once inside you will find the projects you have been assigned, the team chat, and the tools for the work you have been brought in to do.',
      ],
      cta: 'Join the team',
    },
  }

  const c = copy[audience]
  return renderEmail(brand, 'tenant', c.subject, {
    preheader: c.paragraphs[0],
    heading: c.heading,
    paragraphs: c.paragraphs,
    cta: { label: c.cta, url: actionUrl },
    notice: {
      title: 'Security notice',
      body:
        `This link is unique to your account and expires in ${expiresIn}. Do not forward or share it. ` +
        'If you were not expecting this invitation, you can safely ignore this message.',
    },
    signOff: 'If you have any questions before setting up your account, just reply to this email.',
  })
}

/**
 * Password reset. Studio-branded, because the person resetting knows the
 * studio and has no relationship with the product (CM-2). Where the tenant
 * cannot be resolved the layout falls back to the product's neutral voice
 * rather than to some other studio's name (CM-4).
 */
export function passwordResetEmail(brand: TenantBrand, actionUrl: string): RenderedEmail {
  const studio = brand.resolved ? brand.name : PRODUCT_NAME
  return renderEmail(brand, 'tenant', `Reset your ${studio} password`, {
    preheader: 'Use the link below to choose a new password.',
    heading: 'Reset your password',
    paragraphs: [
      'We received a request to reset the password on your account. Use the link below to choose a new one.',
    ],
    cta: { label: 'Choose a new password', url: actionUrl },
    notice: {
      title: 'Did not request this?',
      body:
        'This link expires in 60 minutes and can only be used once. If you did not ask to reset your ' +
        'password, no action is needed — your current password still works and nothing has changed.',
    },
  })
}

/**
 * The deferred "you were away" alert — the one email the application already
 * sent, previously as plain text with no layout at all.
 *
 * No sign-off: it is a machine notification, and "reply to this email" would
 * be a promise the away-alert path cannot keep.
 */
export function notificationEmail(
  brand: TenantBrand,
  opts: { title: string; body?: string | null; url?: string | null }
): RenderedEmail {
  return renderEmail(brand, 'tenant', opts.title, {
    preheader: opts.body?.slice(0, 140) || opts.title,
    heading: opts.title,
    paragraphs: opts.body ? [opts.body] : [],
    ...(opts.url ? { cta: { label: 'Open in your portal', url: opts.url } } : {}),
  })
}

/**
 * Genreline speaking as itself to a studio (CM-1) — billing, plan and quota
 * notices. No trigger ships one yet; it exists so the vendor voice is a
 * parameter of the same layout rather than a second template system invented
 * later under time pressure.
 */
export function productEmail(
  brand: TenantBrand,
  subject: string,
  heading: string,
  paragraphs: string[],
  cta?: { label: string; url: string }
): RenderedEmail {
  return renderEmail(brand, 'product', subject, {
    preheader: paragraphs[0] ?? heading,
    heading,
    paragraphs,
    ...(cta ? { cta } : {}),
    signOff: 'If you have questions about your account, reply to this email.',
  })
}
