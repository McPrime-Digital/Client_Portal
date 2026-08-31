import 'server-only'

import { captureError } from '@/lib/errors'
import type { RenderedEmail } from '@/lib/email/layout'
import type { Sender } from '@/lib/mailSender'

// THE ONE PLACE THE APPLICATION HANDS A MESSAGE TO RESEND.
//
// Extracted from `lib/notify.ts`, which owned the only send in the system while
// six invite paths and the password reset went out through Supabase's mailer
// instead — two transports, two senders, two template systems, and only one of
// them capable of naming the tenant (S-C §3). Everything routes through here now.
//
// `resend` is still a raw fetch rather than the installed SDK, matching the
// existing call. The SDK is a dependency with no importers (CLAUDE.md); giving
// it its first one is a separate decision from this change.

const ENDPOINT = 'https://api.resend.com/emails'

/**
 * Deliver one message. Returns whether it was accepted.
 *
 * NEVER THROWS, and the return value is the point. Under `generateLink()` the
 * auth user is created *before* the mail goes out, so a delivery failure is no
 * longer all-or-nothing the way `inviteUserByEmail` was: the account and the
 * roster row are correct and only the message is missing. Callers need to be
 * able to say so rather than either crashing or pretending it arrived.
 */
export async function sendMail(
  to: string,
  rendered: RenderedEmail,
  sender: Sender | null
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key || !sender || !to) return false

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: sender.from,
        to,
        subject: rendered.subject,
        html: rendered.html,
        // Multipart, not HTML-only: readable in a client that refuses HTML,
        // and what spam filters expect from transactional mail.
        text: rendered.text,
        // Omitted when absent, never sent empty (S-C §7).
        ...(sender.replyTo ? { reply_to: sender.replyTo } : {}),
      }),
    })

    if (!res.ok) {
      // Reaches the sink rather than vanishing (I-10). Resend's body carries
      // the reason — an unverified domain, a suppressed address — and without
      // it a studio's invites fail silently and indistinguishably.
      captureError(
        new Error(`Resend rejected the message: ${res.status} ${await res.text().catch(() => '')}`),
        { where: 'email/send', to }
      )
      return false
    }
    return true
  } catch (err) {
    captureError(err, { where: 'email/send', to })
    return false
  }
}
