import 'server-only'

import { PRODUCT_NAME } from '@/lib/product'
import type { TenantBrand } from '@/lib/tenantBrand'

// ONE email layout, rendered per tenant (S-C §6 item 2).
//
// Ported from the studio's existing Supabase "Invite user" template, which was
// the only styled email in the system and was hardcoded to one tenant: its
// wordmark, its company name in the copy, its LLC and domain in the footer.
// The structure is kept exactly — cream field, 560px card, accent rule, the
// security notice, the sign-off — and every identity in it now comes from
// `TenantBrand`.
//
// TWO VOICES, ONE LAYOUT (CM-1). `voice: 'tenant'` is the studio speaking to
// its clients and crew; `voice: 'product'` is Genreline speaking to the studio
// it sells to. They differ only in the identity block and the footer, which is
// the point — a studio's client and a studio's owner should recognise the same
// shape and read a different sender.
//
// WHY TABLES AND INLINE STYLES: Outlook renders with Word's engine. Flexbox,
// grid, and <style> blocks are unreliable; nested tables and inline attributes
// are not. This file will look like 2005 HTML forever, deliberately.

/** The product's own accent — `--primary` in globals.css:49. */
const PRODUCT_ACCENT = '#c8a24a'

const INK = '#1a1915'
const BODY = '#4a4844'
const MUTED = '#7a7874'
const FAINT = '#9a9895'
const FIELD = '#f4f3f0'
const CARD = '#ffffff'
const LINE = '#e0ded9'
const RULE = '#ece9e4'
const WELL = '#f9f8f5'

/**
 * Escape for an HTML text node or a quoted attribute.
 *
 * Non-negotiable here: the tenant's name, a project title and a message
 * preview all reach these templates, and all three are user-supplied. An
 * unescaped `<` in a studio's name is a broken email; an unescaped quote in a
 * URL is worse.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A colour safe to interpolate into a style attribute. */
function safeColor(value: string | null | undefined, fallback: string): string {
  const v = value?.trim() ?? ''
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? v : fallback
}

export type EmailVoice = 'tenant' | 'product'

export type EmailContent = {
  /** Inbox preview line. Never rendered — sits hidden above the card. */
  preheader: string
  heading: string
  /** Body paragraphs, plain strings. Escaped on render. */
  paragraphs: string[]
  cta?: { label: string; url: string }
  /** The boxed notice — used for link expiry and security wording. */
  notice?: { title: string; body: string }
  /** Closing line above the signature. Omitted for machine notifications. */
  signOff?: string
}

export type RenderedEmail = { subject: string; html: string; text: string }

function senderName(brand: TenantBrand, voice: EmailVoice): string {
  if (voice === 'product') return PRODUCT_NAME
  return brand.resolved ? brand.name : PRODUCT_NAME
}

/** Wordmark, or the studio's logo when it has uploaded one. */
function identityBlock(name: string, logoUrl: string | null, accent: string): string {
  if (logoUrl) {
    return `<img src="${esc(logoUrl)}" alt="${esc(name)}" height="28"
      style="height:28px;width:auto;display:block;border:0;outline:none;text-decoration:none;" />`
  }
  return `<div style="display:inline-block;width:3px;height:22px;background:${accent};vertical-align:middle;margin-right:10px;"></div>
        <span style="font-size:15px;font-weight:700;color:${INK};letter-spacing:0.04em;text-transform:uppercase;vertical-align:middle;">${esc(name)}</span>`
}

export function renderEmail(
  brand: TenantBrand,
  voice: EmailVoice,
  subject: string,
  content: EmailContent
): RenderedEmail {
  const name = senderName(brand, voice)
  // The tenant's accent when it has one; the product's otherwise. The old
  // template's gold was hardcoded — it happens to match the product's own
  // --primary, which is why it survives as the default rather than as one
  // studio's colour (P-1).
  //
  // PER-TENANT ACCENT IS NOT BUILT. `organizations.brand_color` (S-C §6) would
  // need a migration, and an additive column has to be applied before the code
  // deploys or every read fails 42703 (the 0025 ordering lesson). Nobody asked
  // for per-studio colour; name and logo were the ask. `safeColor` is here as
  // the validated entry point for when the column lands — one argument changes.
  const accent = safeColor(null, PRODUCT_ACCENT)

  const logo = voice === 'tenant' ? brand.logoUrl : null

  const paragraphs = content.paragraphs
    .map(
      (p, i) =>
        `<p style="margin:0 0 ${i === content.paragraphs.length - 1 ? '32' : '12'}px;font-size:14px;color:${BODY};line-height:1.75;">${esc(p)}</p>`
    )
    .join('\n')

  const cta = content.cta
    ? `<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:36px;">
        <tr><td style="background:${accent};border-radius:3px;">
          <a href="${esc(content.cta.url)}" target="_blank" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;letter-spacing:0.03em;text-transform:uppercase;">${esc(content.cta.label)}</a>
        </td></tr>
      </table>`
    : ''

  const notice = content.notice
    ? `<div style="height:1px;background:${RULE};margin-bottom:28px;"></div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
        <tr><td style="padding:16px 20px;background:${WELL};border-radius:3px;border:1px solid ${LINE};">
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:${INK};text-transform:uppercase;letter-spacing:0.08em;">${esc(content.notice.title)}</p>
          <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.65;">${esc(content.notice.body)}</p>
        </td></tr>
      </table>`
    : ''

  const signOff = content.signOff
    ? `<p style="margin:0;font-size:13px;color:${BODY};line-height:1.7;">${esc(content.signOff)}</p>
      <p style="margin:20px 0 0;font-size:13px;color:${INK};font-weight:600;">${esc(`The ${name} Team`)}</p>`
    : ''

  // PI-4. Shown unless the tenant's plan has bought its removal, and never on
  // the product's own voice — Genreline does not attribute itself.
  const attribution =
    voice === 'tenant' && brand.showsAttribution
      ? `<p style="margin:0 0 6px;font-size:11px;color:${FAINT};">Powered by ${esc(PRODUCT_NAME)}</p>`
      : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${FIELD};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(content.preheader)}</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${FIELD};padding:48px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

  <tr><td align="left" style="padding:0 0 28px 0;">
    <table cellpadding="0" cellspacing="0" border="0"><tr><td>
      ${identityBlock(name, logo, accent)}
    </td></tr></table>
  </td></tr>

  <tr><td style="background:${CARD};border-radius:4px;border:1px solid ${LINE};overflow:hidden;">
    <div style="height:3px;background:${accent};"></div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:44px 48px 40px;">
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:${INK};line-height:1.35;letter-spacing:-0.01em;">${esc(content.heading)}</h1>
        ${paragraphs}
        ${cta}
        ${notice}
        ${signOff}
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:24px 0 0;text-align:center;">
    ${attribution}
    <p style="margin:0;font-size:11px;color:#b8b6b2;">This is an automated message.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`

  const text = [
    name,
    '',
    content.heading,
    '',
    ...content.paragraphs,
    content.cta ? `\n${content.cta.label}: ${content.cta.url}` : '',
    content.notice ? `\n${content.notice.title.toUpperCase()}\n${content.notice.body}` : '',
    content.signOff ? `\n${content.signOff}\n\nThe ${name} Team` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return { subject, html, text }
}
