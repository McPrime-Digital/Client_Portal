import 'server-only'

import { recordUsage } from '@/lib/usage'
import { captureError } from '@/lib/errors'

// Server-side SMS via Twilio's REST API (no SDK dependency). No-ops unless
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are configured, so the
// app runs fine without SMS until those are added. Never throws.
//
// `orgId` IS REQUIRED, and that is the point of the parameter. This function
// metered every tenant's SMS against DEFAULT_ORG_ID — the McPrime sentinel —
// so a second studio's alerts billed to tenant zero. That is T-5 (S0-A §2):
// S1 §3 requires the org to be stamped from the caller, never inherited from a
// constant or a column default. Taking it as an argument is what makes the
// mistake unrepeatable: there is no value to fall back to.
export async function sendSms(
  to: string | null | undefined,
  body: string,
  orgId: string | null | undefined,
): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM
  if (!sid || !token || !from || !to) return
  try {
    const params = new URLSearchParams({ To: to, From: from, Body: body.slice(0, 600) })
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
    // Awaited, not fired-and-forgotten: on a serverless platform the lambda
    // freezes the moment the response resolves, so a pending insert is simply
    // lost. Usage data cannot be backfilled (S-V §11), so the row is gone for
    // good. Same fix Batch 6.5 made on the file-commit path.
    if (orgId) {
      await recordUsage(orgId, 'sms.sent', 1, 0, { to_suffix: to.slice(-4) })
    } else {
      // Unattributable send. The alert still goes out — suppressing a
      // notification over a metering gap is the wrong trade — but it is not
      // billed to tenant zero to make the books look tidy, and it does not
      // vanish either (I-10).
      captureError(new Error('sms.sent could not be attributed to an organization'), {
        where: 'sendSms', to_suffix: to.slice(-4),
      })
    }
  } catch {
    // best-effort
  }
}