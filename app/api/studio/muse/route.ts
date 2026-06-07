import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getModel } from '@/lib/ai/models'
import { userOrgId } from '@/lib/auth/role'
import { getCreditState, chargeCredits, estimateCostCents } from '@/lib/credits'

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
  const charge = (outChars: number) => {
    void chargeCredits(orgId, estimateCostCents(model.id, inChars, outChars), 'primeos', { model: model.id, user: user.id })
  }

  const ENC = new TextEncoder()
  // Convert a provider SSE body into a plain-text token stream the client appends.
  const sseToText = (body: ReadableStream<Uint8Array>, extract: (j: any) => string | undefined, onDone?: (outChars: number) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let outChars = 0
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          onDone?.(outChars)
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
            const t = extract(JSON.parse(data))
            if (t) { outChars += t.length; controller.enqueue(ENC.encode(t)) }
          } catch {
            /* partial / keep-alive line */
          }
        }
      },
      cancel() {
        void reader.cancel()
        onDone?.(outChars)
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
      return new Response(sseToText(r.body, (j) => (j?.type === "content_block_delta" ? j?.delta?.text : ""), charge), { headers: streamHeaders })
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
      return new Response(sseToText(r.body, (j) => j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '', charge), { headers: streamHeaders })
    }

    // OpenAI
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL[model.id] ?? 'gpt-4o',
        stream: true,
        messages: [{ role: 'system', content: system }, ...turns.map((t) => ({ role: t.role, content: t.text })), { role: 'user', content: userMessage }],
      }),
    })
    if (!r.ok || !r.body) return providerError(r)
    return new Response(sseToText(r.body, (j) => j?.choices?.[0]?.delta?.content ?? '', charge), { headers: streamHeaders })
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message ?? 'Request failed' }, { status: 500 })
  }
}
