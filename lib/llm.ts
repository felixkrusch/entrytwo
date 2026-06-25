import { prisma } from '@/lib/prisma'
import { createOpenAI } from '@ai-sdk/openai'

export type LlmProvider =
  | 'openai'
  | 'xai'
  | 'anthropic'
  | 'openrouter'
  | 'kilo'
  | 'openai-compatible'
  | 'nous-portal'
  | 'openai-codex'
  | 'github-copilot'
  | 'github-copilot-acp'
  | 'novita'
  | 'zai'
  | 'kimi-coding'
  | 'kimi-coding-cn'
  | 'arcee'
  | 'gmi'
  | 'minimax'
  | 'minimax-cn'
  | 'xai-oauth'
  | 'alibaba'
  | 'alibaba-coding-plan'
  | 'xiaomi'
  | 'tencent-tokenhub'
  | 'opencode-zen'
  | 'opencode-go'
  | 'deepseek'
  | 'huggingface'
  | 'gemini'
  | 'azure-foundry'
  | 'bedrock'
  | 'nvidia'
  | 'ollama-cloud'
  | 'qwen-oauth'
  | 'minimax-oauth'
  | 'stepfun'
  | 'lmstudio'
  | 'custom'

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

  const openaiCompat = (base: string | undefined, headers?: Record<string, string>) =>
    createOpenAI({ baseURL: base, apiKey: key, ...(headers ? { headers } : {}) })

  // Gateways / OpenAI-compatible (big ones first)
  if (
    config.provider === 'kilo' ||
    config.provider === 'openrouter' ||
    config.provider === 'openai-compatible' ||
    config.provider === 'custom'
  ) {
    const base =
      config.baseURL ||
      (config.provider === 'kilo' ? 'https://api.kilo.ai/api/gateway' : undefined) ||
      (config.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : undefined)
    const headers = config.provider === 'openrouter'
      ? { 'HTTP-Referer': 'https://entrytwo.local', 'X-Title': 'entrytwo' }
      : undefined
    return openaiCompat(base, headers)(config.model)
  }

  // xAI direct + OAuth-pasted key
  if (config.provider === 'xai' || config.provider === 'xai-oauth') {
    return openaiCompat('https://api.x.ai/v1')(config.model)
  }

  // Anthropic (official or compat)
  if (config.provider === 'anthropic') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { anthropic: anthropicProvider } = require('@ai-sdk/anthropic')
      return anthropicProvider(config.model)
    } catch {
      return openaiCompat('https://api.anthropic.com/v1')(config.model)
    }
  }

  // Direct known providers (use their OpenAI-compat surface where it exists)
  const providerBase: Record<string, string | undefined> = {
    deepseek: 'https://api.deepseek.com',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
    huggingface: undefined, // HF inference usually needs different client; treat as compat
    novita: 'https://api.novita.ai/v3',
    alibaba: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'alibaba-coding-plan': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    stepfun: undefined,
    lmstudio: 'http://localhost:1234/v1',
    nvidia: 'https://integrate.api.nvidia.com/v1',
    'tencent-tokenhub': undefined,
    'opencode-zen': undefined,
    'opencode-go': undefined,
    xiaomi: undefined,
    zai: undefined,
    'kimi-coding': 'https://api.moonshot.cn/v1',
    'kimi-coding-cn': 'https://api.moonshot.cn/v1',
    arcee: undefined,
    gmi: undefined,
    minimax: 'https://api.minimax.chat/v1',
    'minimax-cn': 'https://api.minimax.chat/v1',
    bedrock: undefined, // handled via AWS creds, not here
    'azure-foundry': undefined, // user supplies full endpoint in baseURL
    'ollama-cloud': 'https://api.ollama.ai/v1',
    'qwen-oauth': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'minimax-oauth': 'https://api.minimax.chat/v1',
    'nous-portal': undefined,
    'openai-codex': 'https://api.openai.com/v1',
    'github-copilot': 'https://api.githubcopilot.com',
    'github-copilot-acp': undefined,
  }

  const base = config.baseURL || providerBase[config.provider]
  return openaiCompat(base)(config.model)
}
