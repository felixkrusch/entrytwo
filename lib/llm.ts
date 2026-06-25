import { prisma } from '@/lib/prisma'
import { createOpenAI } from '@ai-sdk/openai'

export type LlmProvider =
  | 'openai'
  | 'xai'
  | 'anthropic'
  | 'openrouter'
  | 'kilo'
  | 'openai-compatible'

export interface LlmConfig {
  provider: LlmProvider
  model: string
  apiKey?: string
  baseURL?: string
}

const DEFAULTS: Partial<LlmConfig> = {
  provider: 'openai',
  model: 'gpt-4o-mini',
}

function getStringValue(v: unknown): string | undefined {
  if (!v) return undefined
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null && 'value' in v) {
    const val = (v as { value?: unknown }).value
    return typeof val === 'string' ? val : undefined
  }
  return undefined
}

export async function getLlmConfig(): Promise<LlmConfig> {
  try {
    const rows = await prisma.setting.findMany({
      where: {
        key: { in: ['llm.provider', 'llm.model', 'llm.apiKey', 'llm.baseURL'] },
      },
    })

    const map = Object.fromEntries(rows.map(r => [r.key, r.value]))

    const provider = (getStringValue(map['llm.provider']) as LlmProvider) || DEFAULTS.provider!
    const model = getStringValue(map['llm.model']) || DEFAULTS.model!
    const apiKey = getStringValue(map['llm.apiKey'])
    const baseURL = getStringValue(map['llm.baseURL'])

    return { provider, model, apiKey: apiKey || undefined, baseURL: baseURL || undefined }
  } catch {
    return { ...DEFAULTS } as LlmConfig
  }
}

export function createLlmModel(config: LlmConfig) {
  const key = config.apiKey || process.env.LLM_API_KEY || ''

  // Kilo Gateway, OpenRouter, or any other OpenAI-compatible gateway
  if (config.provider === 'kilo' || config.provider === 'openrouter' || config.provider === 'openai-compatible') {
    const baseURL =
      config.baseURL ||
      (config.provider === 'kilo' ? 'https://api.kilo.ai/api/gateway' : undefined) ||
      (config.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : undefined)

    const openaiCompat = createOpenAI({
      baseURL,
      apiKey: key,
      // headers for OpenRouter (optional but recommended)
      ...(config.provider === 'openrouter' ? { headers: { 'HTTP-Referer': 'https://entrytwo.local', 'X-Title': 'entrytwo' } } : {}),
    })
    return openaiCompat(config.model)
  }

  if (config.provider === 'xai') {
    // xAI (Grok) – use their OpenAI-compatible endpoint so we can pass dynamic key
    const xaiCompat = createOpenAI({
      baseURL: 'https://api.x.ai/v1',
      apiKey: key || process.env.XAI_API_KEY || '',
    })
    return xaiCompat(config.model)
  }

  if (config.provider === 'anthropic') {
    // Anthropic – prefer the official SDK when available
    try {
      // dynamic to avoid hard dep issues at type time
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { anthropic: anthropicProvider } = require('@ai-sdk/anthropic')
      return anthropicProvider(config.model)
    } catch {
      // Fallback to OpenAI-compatible surface for Anthropic
      const anthCompat = createOpenAI({
        baseURL: 'https://api.anthropic.com/v1',
        apiKey: key || process.env.ANTHROPIC_API_KEY || '',
      })
      return anthCompat(config.model)
    }
  }

  // Default: OpenAI direct (or any key stored for openai)
  const openai = createOpenAI({ apiKey: key || process.env.OPENAI_API_KEY || '' })
  return openai(config.model)
}
