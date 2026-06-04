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
  } catch {
    // best-effort
  }
}
