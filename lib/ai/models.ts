// Throughline model registry — the single source of truth for every AI model the
// studio can call. Muse (chat), The Stage (generation), Model Arena, and Remaster
// all read from here, so adding a model = one entry. Access is per-org: keys live
// in org settings (encrypted); `via` says how we reach it (the provider's own API,
// or an aggregator like fal.ai / Replicate that fronts many models with one key).
//
// This is the "select any model" catalog. It is intentionally broad; availability
// per org depends on which provider keys that org has configured.

export type Modality = 'text' | 'image' | 'video' | 'audio' | 'upscale'
export type Access = 'direct' | 'fal' | 'replicate'

export type AIModel = {
  id: string // stable key, e.g. 'anthropic/claude-opus-4'
  label: string // display name
  provider: string // brand
  modality: Modality
  via: Access // how Throughline reaches it
  tags?: string[] // 'flagship' | 'fast' | 'reasoning' | 'cinematic' | 'lipsync' | ...
}

export const AI_MODELS: AIModel[] = [
  // ── Text / LLM (Muse, reasoning, scripting, automation) ──────────────────
  { id: 'anthropic/claude-opus', label: 'Claude Opus 4', provider: 'Anthropic', modality: 'text', via: 'direct', tags: ['flagship', 'reasoning'] },
  { id: 'anthropic/claude-sonnet', label: 'Claude Sonnet 4', provider: 'Anthropic', modality: 'text', via: 'direct', tags: ['balanced'] },
  { id: 'anthropic/claude-haiku', label: 'Claude Haiku 4', provider: 'Anthropic', modality: 'text', via: 'direct', tags: ['fast'] },
  { id: 'openai/gpt-5', label: 'GPT-5', provider: 'OpenAI', modality: 'text', via: 'direct', tags: ['flagship'] },
  { id: 'openai/gpt-4o', label: 'GPT-4o', provider: 'OpenAI', modality: 'text', via: 'direct', tags: ['multimodal'] },
  { id: 'openai/o-series', label: 'OpenAI o-series', provider: 'OpenAI', modality: 'text', via: 'direct', tags: ['reasoning'] },
  { id: 'google/gemini-pro', label: 'Gemini 2.5 Pro', provider: 'Google', modality: 'text', via: 'direct', tags: ['flagship', 'long-context'] },
  { id: 'google/gemini-flash', label: 'Gemini 2.5 Flash', provider: 'Google', modality: 'text', via: 'direct', tags: ['fast'] },
  { id: 'meta/llama', label: 'Llama 4', provider: 'Meta', modality: 'text', via: 'fal', tags: ['open'] },
  { id: 'mistral/large', label: 'Mistral Large', provider: 'Mistral', modality: 'text', via: 'direct', tags: ['open'] },
  { id: 'deepseek/v3', label: 'DeepSeek V3', provider: 'DeepSeek', modality: 'text', via: 'direct', tags: ['open'] },
  { id: 'deepseek/r1', label: 'DeepSeek R1', provider: 'DeepSeek', modality: 'text', via: 'direct', tags: ['reasoning', 'open'] },
  { id: 'xai/grok', label: 'Grok', provider: 'xAI', modality: 'text', via: 'direct' },
  { id: 'cohere/command-r', label: 'Command R+', provider: 'Cohere', modality: 'text', via: 'direct', tags: ['rag'] },

  // ── Image generation (The Stage, storyboards, Remaster inputs) ───────────
  { id: 'bfl/flux-pro', label: 'FLUX.1 Pro', provider: 'Black Forest Labs', modality: 'image', via: 'fal', tags: ['flagship'] },
  { id: 'bfl/flux-dev', label: 'FLUX.1 Dev', provider: 'Black Forest Labs', modality: 'image', via: 'fal' },
  { id: 'openai/gpt-image', label: 'GPT Image (DALL·E)', provider: 'OpenAI', modality: 'image', via: 'direct' },
  { id: 'stability/sd35', label: 'Stable Diffusion 3.5', provider: 'Stability AI', modality: 'image', via: 'fal' },
  { id: 'midjourney/v7', label: 'Midjourney v7', provider: 'Midjourney', modality: 'image', via: 'replicate', tags: ['cinematic'] },
  { id: 'ideogram/v3', label: 'Ideogram 3.0', provider: 'Ideogram', modality: 'image', via: 'fal', tags: ['typography'] },
  { id: 'google/imagen', label: 'Imagen 3', provider: 'Google', modality: 'image', via: 'direct' },
  { id: 'recraft/v3', label: 'Recraft V3', provider: 'Recraft', modality: 'image', via: 'fal', tags: ['vector', 'brand'] },
  { id: 'adobe/firefly', label: 'Adobe Firefly', provider: 'Adobe', modality: 'image', via: 'direct', tags: ['commercial-safe'] },

  // ── Video generation (The Stage, film) ──────────────────────────────────
  { id: 'kling/v2', label: 'Kling 2.0', provider: 'Kuaishou', modality: 'video', via: 'fal', tags: ['flagship', 'cinematic'] },
  { id: 'runway/gen4', label: 'Runway Gen-4', provider: 'Runway', modality: 'video', via: 'direct', tags: ['flagship'] },
  { id: 'luma/ray', label: 'Luma Ray 2', provider: 'Luma', modality: 'video', via: 'direct' },
  { id: 'pika/v2', label: 'Pika 2.0', provider: 'Pika', modality: 'video', via: 'fal' },
  { id: 'openai/sora', label: 'Sora', provider: 'OpenAI', modality: 'video', via: 'direct' },
  { id: 'google/veo', label: 'Veo 3', provider: 'Google', modality: 'video', via: 'direct', tags: ['flagship'] },
  { id: 'minimax/hailuo', label: 'Hailuo (MiniMax)', provider: 'MiniMax', modality: 'video', via: 'fal' },
  { id: 'higgsfield/dop', label: 'Higgsfield', provider: 'Higgsfield', modality: 'video', via: 'direct', tags: ['camera-control'] },
  { id: 'alibaba/wan', label: 'Wan 2.1', provider: 'Alibaba', modality: 'video', via: 'fal', tags: ['open'] },
  { id: 'tencent/hunyuan-video', label: 'Hunyuan Video', provider: 'Tencent', modality: 'video', via: 'fal', tags: ['open'] },
  { id: 'lightricks/ltx', label: 'LTX Video', provider: 'Lightricks', modality: 'video', via: 'fal', tags: ['fast', 'open'] },
  { id: 'genmo/mochi', label: 'Mochi 1', provider: 'Genmo', modality: 'video', via: 'fal', tags: ['open'] },

  // ── Audio / voice / music (Finishing Suite) ──────────────────────────────
  { id: 'elevenlabs/tts', label: 'ElevenLabs (voice + dubbing)', provider: 'ElevenLabs', modality: 'audio', via: 'direct', tags: ['voiceover', 'clone', 'multilingual'] },
  { id: 'openai/tts', label: 'OpenAI TTS', provider: 'OpenAI', modality: 'audio', via: 'direct', tags: ['voiceover'] },
  { id: 'cartesia/sonic', label: 'Cartesia Sonic', provider: 'Cartesia', modality: 'audio', via: 'direct', tags: ['voiceover', 'fast'] },
  { id: 'suno/v4', label: 'Suno', provider: 'Suno', modality: 'audio', via: 'direct', tags: ['music'] },
  { id: 'udio/v1', label: 'Udio', provider: 'Udio', modality: 'audio', via: 'direct', tags: ['music'] },

  // ── Upscale / enhance (Remaster) ─────────────────────────────────────────
  { id: 'topaz/video', label: 'Topaz Video AI', provider: 'Topaz Labs', modality: 'upscale', via: 'direct', tags: ['video', 'upscale'] },
  { id: 'magnific/upscale', label: 'Magnific', provider: 'Magnific', modality: 'upscale', via: 'direct', tags: ['image', 'upscale'] },
  { id: 'bfl/flux-redux', label: 'FLUX Redux (enhance)', provider: 'Black Forest Labs', modality: 'upscale', via: 'fal', tags: ['image'] },
]

export function modelsByModality(m: Modality): AIModel[] {
  return AI_MODELS.filter((x) => x.modality === m)
}
export function getModel(id: string): AIModel | undefined {
  return AI_MODELS.find((x) => x.id === id)
}

// The provider keys an org can configure (one key can unlock many models —
// e.g. a single fal.ai or Replicate key fronts dozens of image/video models).
export const PROVIDER_KEYS = [
  'ANTHROPIC', 'OPENAI', 'GOOGLE', 'MISTRAL', 'DEEPSEEK', 'XAI', 'COHERE',
  'FAL', 'REPLICATE', 'RUNWAY', 'LUMA', 'KLING', 'HIGGSFIELD',
  'ELEVENLABS', 'SUNO', 'UDIO', 'TOPAZ', 'MAGNIFIC', 'ADOBE',
] as const
