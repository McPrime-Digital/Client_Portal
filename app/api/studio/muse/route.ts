import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getModel } from '@/lib/ai/models'
import { userOrgId } from '@/lib/auth/role'
import { getCreditState, chargeCredits, estimateCostCents, costCentsForTokens } from '@/lib/credits'

// Muse inline assistant. Takes the selected text + an instruction (+ short history)
// and returns revised text. Provider keys come from env for now (per-org key
// storage lands with the org settings screen — see the AI-keys reminder). Wired
// for Anthropic + OpenAI today; other providers return a graceful message so the
// UX is complete the moment a supported key is added.

const PROVIDER_ENV: Record<string, string> = {
  Anthropic: 'ANTHROPIC_API_KEY',
  OpenAI: 'OPENAI_API_KEY',
  Google: 'GEMINI_API_KEY',
}
// registry id → provider's API model name (adjust as providers rev their names)
const ANTHROPIC_MODEL: Record<string, string> = {
  'anthropic/claude-opus': 'claude-opus-4-1-20250805',
  'anthropic/claude-sonnet': 'claude-sonnet-4-5-20250929',
  'anthropic/claude-haiku': 'claude-3-5-haiku-latest',
}
const OPENAI_MODEL: Record<string, string> = {
  'openai/gpt-5': 'gpt-5',
  'openai/gpt-4o': 'gpt-4o',
  'openai/o-series': 'o3',
}
const GOOGLE_MODEL: Record<string, string> = {
  'google/gemini-pro': 'gemini-2.5-pro',
  'google/gemini-flash': 'gemini-2.5-flash',
}

const SYSTEM =
  'You are PrimeOS AI, an inline writing assistant inside a screenplay and document editor. ' +
  'The user selects text and gives an instruction. Apply it and return ONLY the revised text — ' +
  'no preamble, no surrounding quotes, no explanation — unless the user is clearly asking a question, ' +
  'in which case answer concisely. Preserve the user’s voice, language, and formatting.'

type Turn = { role: 'user' | 'assistant'; text: string }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { modelId, instruction, selection, history, persona } = await req.json().catch(() => ({}))
  if (!instruction || typeof instruction !== 'string') {
    return NextResponse.json({ error: 'instruction is required' }, { status: 400 })
  }
  const system = typeof persona === 'string' && persona.trim() ? `${persona.trim()}\n\n${SYSTEM}` : SYSTEM

  const model = getModel(modelId) ?? getModel('anthropic/claude-sonnet')!
  const envName = PROVIDER_ENV[model.provider]
  const key =
    model.provider === 'Google'
      ? process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
      : envName
        ? process.env[envName]
        : undefined

  if (!envName) {
    return NextResponse.json({
      unsupported: true,
      message: `${model.provider} isn’t wired for inline chat yet — Claude or GPT models work today.`,
    })
  }
  if (!key) {
    return NextResponse.json({ needsKey: envName, provider: model.provider })
  }

  // SaaS credit gate — block only when the org has a hard stop AND no balance.
  const orgId = userOrgId(user as never)
  const credit = await getCreditState(orgId)
  if (credit.hardStop && credit.balanceCents <= 0) {
    return NextResponse.json({ outOfCredits: true, message: 'You’re out of credits — top up to keep using PrimeOS AI.' })
  }

  const turns: Turn[] = Array.isArray(history) ? history.slice(-8) : []
  const userMessage =
    `Selected text:\n"""\n${(selection ?? '').slice(0, 8000)}\n"""\n\nInstruction: ${instruction}`
  const inChars = system.length + userMessage.length + turns.reduce((a, t) => a + t.text.length, 0)

  /** What a provider told us it actually consumed. Both halves optional — a
   *  cancelled stream may carry one, or neither. */
  type Usage = { tokensIn?: number; tokensOut?: number }

  /**
   * Meter and charge one completed call. PROVIDER-REPORTED FIRST (S-V §11
   * defect 2): all three providers return real token counts and the old code
   * threw them away, dividing character counts by four instead. The estimate
   * survives only as the fallback for a stream that ended before its usage
   * frame arrived, and rows written that way are marked `measured: false` so
   * the two populations stay distinguishable.
   *
   * `units` is total tokens; the in/out split lives in `ref` because
   * usage_events.units is a single scalar and S-V §11's unit for this kind is
   * "tokens in / out". Awaited, not `void`ed — the lambda freezes when the
   * response finishes, and this is called while the stream is still open,
   * which is the only window where the write is guaranteed to run.
   */
  const charge = async (outChars: number, usage: Usage) => {
    const measured = typeof usage.tokensIn === 'number' && typeof usage.tokensOut === 'number'
    const tokensIn = usage.tokensIn ?? Math.ceil(inChars / 4)
    const tokensOut = usage.tokensOut ?? Math.ceil(outChars / 4)
    await chargeCredits(
      orgId,
      measured
        ? costCentsForTokens(model.id, tokensIn, tokensOut)
        : estimateCostCents(model.id, inChars, outChars),
      'primeos',                       // credit_ledger reason — the money label
      { model: model.id, user: user.id, tokens_in: tokensIn, tokens_out: tokensOut, measured },
      tokensIn + tokensOut,            // usage_events.units — native measure
      'ai.text.tokens',                // usage_events.kind — S-V §11 taxonomy
    )
  }

  const ENC = new TextEncoder()
  /**
   * Convert a provider SSE body into a plain-text token stream the client
   * appends, collecting the provider's own usage figures on the way past.
   * `readUsage` returns whatever a given frame reveals; frames that reveal
   * nothing return nothing, and later values win (Google restates the running
   * total on every chunk; Anthropic splits input and output across two frames).
   */
  const sseToText = (
    body: ReadableStream<Uint8Array>,
    extract: (j: any) => string | undefined, // eslint-disable-line @typescript-eslint/no-explicit-any
    readUsage: (j: any) => Usage | undefined, // eslint-disable-line @typescript-eslint/no-explicit-any
    onDone?: (outChars: number, usage: Usage) => Promise<void>,
  ) => {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let outChars = 0
    const usage: Usage = {}
    let settled = false
    // Metering runs exactly once per stream, whether it ends or is cancelled.
    const settle = async () => {
      if (settled) return
      settled = true
      await onDone?.(outChars, usage)
    }
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (done) {
          // Meter BEFORE closing: once the response completes the platform is
          // free to freeze the function, and a pending insert is lost usage
          // that cannot be backfilled (S-V §11).
          await settle()
          controller.close()
          return
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const raw of lines) {
          const line = raw.trim()
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue
          try {
            const j = JSON.parse(data)
            const u = readUsage(j)
            if (u?.tokensIn !== undefined) usage.tokensIn = u.tokensIn
            if (u?.tokensOut !== undefined) usage.tokensOut = u.tokensOut
            const t = extract(j)
            if (t) { outChars += t.length; controller.enqueue(ENC.encode(t)) }
          } catch {
            /* partial / keep-alive line */
          }
        }
      },
      async cancel() {
        void reader.cancel()
        await settle()
      },
    })
  }
  const streamHeaders = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' }
  const providerError = async (r: Response) => {
    const j = await r.json().catch(() => ({}))
    return NextResponse.json({ error: j?.error?.message ?? 'Provider error' }, { status: 502 })
  }

  try {
    if (model.provider === 'Anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL[model.id] ?? 'claude-sonnet-4-5-20250929',
          max_tokens: 2000,
          system,
          stream: true,
          messages: [...turns.map((t) => ({ role: t.role, content: t.text })), { role: 'user', content: userMessage }],
        }),
      })
      if (!r.ok || !r.body) return providerError(r)
      return new Response(
        sseToText(
          r.body,
          (j) => (j?.type === 'content_block_delta' ? j?.delta?.text : ''),
          // Anthropic splits usage across two frames: message_start carries the
          // input count, message_delta the running output count.
          (j) => {
            if (j?.type === 'message_start' && j?.message?.usage) {
              return { tokensIn: j.message.usage.input_tokens, tokensOut: j.message.usage.output_tokens }
            }
            if (j?.type === 'message_delta' && j?.usage) return { tokensOut: j.usage.output_tokens }
            return undefined
          },
          charge,
        ),
        { headers: streamHeaders },
      )
    }

    if (model.provider === 'Google') {
      const gm = GOOGLE_MODEL[model.id] ?? 'gemini-2.5-flash'
      const contents = [
        ...turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
        { role: 'user', parts: [{ text: userMessage }] },
      ]
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${gm}:streamGenerateContent?alt=sse&key=${key}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents }) },
      )
      if (!r.ok || !r.body) return providerError(r)
      return new Response(
        sseToText(
          r.body,
          (j) => j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
          // Gemini restates usageMetadata on every chunk as a running total, so
          // the last frame seen is the authoritative one.
          (j) =>
            j?.usageMetadata
              ? { tokensIn: j.usageMetadata.promptTokenCount, tokensOut: j.usageMetadata.candidatesTokenCount }
              : undefined,
          charge,
        ),
        { headers: streamHeaders },
      )
    }

    // OpenAI
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL[model.id] ?? 'gpt-4o',
        stream: true,
        // Without this the usage object is omitted from a streamed response
        // entirely — the reason character-counting looked unavoidable.
        stream_options: { include_usage: true },
        messages: [{ role: 'system', content: system }, ...turns.map((t) => ({ role: t.role, content: t.text })), { role: 'user', content: userMessage }],
      }),
    })
    if (!r.ok || !r.body) return providerError(r)
    return new Response(
      sseToText(
        r.body,
        (j) => j?.choices?.[0]?.delta?.content ?? '',
        // One final chunk carries usage and an empty choices array.
        (j) =>
          j?.usage
            ? { tokensIn: j.usage.prompt_tokens, tokensOut: j.usage.completion_tokens }
            : undefined,
        charge,
      ),
      { headers: streamHeaders },
    )
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message ?? 'Request failed' }, { status: 500 })
  }
}
