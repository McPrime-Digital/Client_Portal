import 'server-only'

import { appOrigin } from '@/lib/appOrigin'
import { PRODUCT_NAME } from '@/lib/product'
import type { TenantBrand } from '@/lib/tenantBrand'

// WHO A MESSAGE IS FROM (S-C §4, CM-1/CM-3). One resolver for every channel,
// answering from the tenant rather than from configuration.
//
// The rule this replaces: NOTIFY_FROM_EMAIL held
// `"McPrime Digital <notifications@mcprimedigital.com>"`, so every email the
// product sent — to every tenant's clients — arrived From one tenant. CM-3
// draws the line the fix depends on: an environment variable may supply the
// sending ADDRESS; it may never supply the IDENTITY.
//
// LAYER 1 / LAYER 2 ARE ONE CODE PATH, not two projects (CM-6). Today every
// tenant sends from the product's verified domain with their own display name
// and Reply-To — no per-tenant DNS, and because the From domain and the DKIM
// signing domain match, no "via" annotation in Gmail. When a studio connects
// its own domain, `senderFor` gains a lookup and nothing else changes. The
// seam is marked here rather than built: `organizations.mail_domain` does not
// exist yet, and a column nothing reads is not a seam, it is dead schema.

/**
 * The address every tenant sends from until it connects its own domain.
 *
 * Parsed out of the EXISTING `NOTIFY_FROM_EMAIL` rather than introducing a
 * second variable, so nothing has to be reconfigured and there is still one
 * place the sending address is set. The variable conventionally holds
 * `Name <addr@domain>`; only the address survives, because the name is now
 * resolved per send (CM-3). A bare address is accepted unchanged.
 *
 * Empty when unset or unparseable — the caller skips the send rather than
 * mailing from a malformed header. That is the 9.1 lesson applied to a
 * different variable: a missing value must not become part of a string.
 */
function layerOneAddress(): string {
  const raw = process.env.NOTIFY_FROM_EMAIL?.trim()
  if (!raw) return ''
  const angled = raw.match(/<([^>]+)>/)
  const address = (angled ? angled[1] : raw).trim().replace(/^["']|["']$/g, '')
  return address.includes('@') ? address : ''
}

export type Sender = {
  /** RFC 5322 From, e.g. `Studio Two <notifications@genreline.com>`. */
  from: string
  /** Where replies go. Omitted entirely when the studio has no address. */
  replyTo?: string
}

/**
 * A display name safe to put in a From header.
 *
 * Tenant-controlled text on an outbound channel: CR/LF would let a studio
 * inject arbitrary headers, and the inbox list truncates anything long anyway.
 * Quotes are stripped rather than escaped so the quoted-string form below
 * cannot be terminated early.
 */
function safeDisplayName(name: string): string {
  return name
    .replace(/[\r\n]+/g, ' ')
    .replace(/["\\]/g, '')
    .trim()
    .slice(0, 64)
}

function compose(displayName: string, address: string): string {
  const clean = safeDisplayName(displayName)
  return clean ? `"${clean}" <${address}>` : address
}

/**
 * The studio speaking to its own clients and crew (CM-2). The display name is
 * the studio's; the address is the product's until Layer 2 exists.
 *
 * Returns null when there is no address configured, so the caller skips the
 * send rather than mailing from a malformed header.
 */
export function senderForTenant(brand: TenantBrand): Sender | null {
  const address = layerOneAddress()
  if (!address) return null

  // CM-4: where the tenant could not be resolved the message goes out in the
  // product's neutral voice — never signed with some other studio's name.
  const displayName = brand.resolved ? brand.name : PRODUCT_NAME

  const replyTo = brand.replyTo?.trim()
  return {
    from: compose(displayName, address),
    // Omitted, not empty: business_settings.business_email is '' for the house
    // org today, and an empty Reply-To header is worse than none.
    ...(replyTo ? { replyTo } : {}),
  }
}

/**
 * Genreline speaking as itself to the studio it sells to (CM-1) — billing,
 * plan and quota notices, receipts, platform alerts. Never used for anything a
 * studio's client receives.
 */
export function senderForProduct(): Sender | null {
  const address = layerOneAddress()
  if (!address) return null
  return { from: compose(PRODUCT_NAME, address) }
}

/**
 * The one place both names may appear (S-C §2): an invite is to a studio's
 * workspace, with the product as context. The studio is the subject and the
 * inviting person is deliberately not named — §9 q2 — so the line survives
 * that person leaving.
 */
export function invitationSubject(brand: TenantBrand): string {
  return brand.resolved
    ? `${brand.name} invited you`
    : `You have been invited to ${PRODUCT_NAME}`
}

/** Absolute URL for an email body. Emails cannot resolve relative paths. */
export function mailLink(path: string): string {
  return `${appOrigin()}${path.startsWith('/') ? path : `/${path}`}`
}
