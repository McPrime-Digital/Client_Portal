import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getModel } from '@/lib/ai/models'

// Muse inline assistant. Takes the selected text + an instruction (+ short history)
// and returns revised text. Provider keys come from env for now (per-org key
// storage lands with the org settings screen — see the AI-keys reminder). Wired
// for Anthropic + OpenAI today; other providers return a graceful message so the
// UX is complete the moment a supported key is added.

const PROVIDER_ENV: Record<string, string> = {
  Anthropic: 'ANTHROPIC_API_KEY',
  OpenAI: 'OPENAI_API_KEY',
}
// registry id → provider's API model name (adjust as providers rev their names)
const ANTHROPIC_MODEL: Record<string, string> = {
  'anthropic/claude-opus': 'claude-opus-4-1',
  'anthropic/claude-sonnet': 'claude-sonnet-4-5',
  'anthropic/claude-haiku': 'claude-haiku-4-5',
}
const OPENAI_MODEL: Record<string, string> = {
  'openai/gpt-5': 'gpt-5',
  'openai/gpt-4o': 'gpt-4o',
  'openai/o-series': 'o3',
}

const SYSTEM =
  'You are Muse, an inline writing assistant inside a screenplay and document editor. ' +
  'The user selects text and gives an instruction. Apply it and return ONLY the revised text — ' +
  'no preamble, no surrounding quotes, no explanation — unless the user is clearly asking a question, ' +
  'in which case answer concisely. Preserve the user’s voice, language, and formatting.'

type Turn = { role: 'user' | 'assistant'; text: string }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { modelId, instruction, selection, history } = await req.json().catch(() => ({}))
  if (!instruction || typeof instruction !== 'string') {
    return NextResponse.json({ error: 'instruction is required' }, { status: 400 })
  }

  const model = getModel(modelId) ?? getModel('anthropic/claude-sonnet')!
  const envName = PROVIDER_ENV[model.provider]
  const key = envName ? process.env[envName] : undefined

  if (!envName) {
    return NextResponse.json({
      unsupported: true,
      message: `${model.provider} isn’t wired for inline chat yet — Claude or GPT models work today.`,
    })
  }
  if (!key) {
    return NextResponse.json({ needsKey: envName, provider: model.provider })
  }

  const turns: Turn[] = Array.isArray(history) ? history.slice(-8) : []
  const userMessage =
    `Selected text:\n"""\n${(selection ?? '').slice(0, 6000)}\n"""\n\nInstruction: ${instruction}`

  try {
    if (model.provider === 'Anthropic') {
      const messages = [
        ...turns.map((t) => ({ role: t.role, content: t.text })),
        { role: 'user' as const, content: userMessage },
      ]
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL[model.id] ?? 'claude-sonnet-4-5',
          max_tokens: 1500,
          system: SYSTEM,
          messages,
        }),
      })
      const j = await r.json()
      if (!r.ok) return NextResponse.json({ error: j?.error?.message ?? 'Provider error' }, { status: 502 })
      const reply = (j?.content?.[0]?.text ?? '').trim()
      return NextResponse.json({ reply })
    }

    // OpenAI
    const messages = [
      { role: 'system' as const, content: SYSTEM },
      ...turns.map((t) => ({ role: t.role, content: t.text })),
      { role: 'user' as const, content: userMessage },
    ]
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_MODEL[model.id] ?? 'gpt-4o', messages }),
    })
    const j = await r.json()
    if (!r.ok) return NextResponse.json({ error: j?.error?.message ?? 'Provider error' }, { status: 502 })
    const reply = (j?.choices?.[0]?.message?.content ?? '').trim()
    return NextResponse.json({ reply })
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message ?? 'Request failed' }, { status: 500 })
  }
}
