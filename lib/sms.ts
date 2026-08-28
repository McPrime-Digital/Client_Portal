import 'server-only'

import { recordUsage } from '@/lib/usage'
import { DEFAULT_ORG_ID } from '@/lib/auth/role'

// Server-side SMS via Twilio's REST API (no SDK dependency). No-ops unless
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are configured, so the
// app runs fine without SMS until those are added. Never throws.
export async function sendSms(to: string | null | undefined, body: string): Promise<void> {
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
    await recordUsage(DEFAULT_ORG_ID, 'sms.sent', 1, 0, { to_suffix: to.slice(-4) })
  } catch {
    // best-effort
  }
}