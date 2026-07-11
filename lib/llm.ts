import { createOpenAI } from '@ai-sdk/openai'
import { createXai } from '@ai-sdk/xai'
import { webSearch as xaiWebSearch } from '@ai-sdk/xai'
import type { ToolSet } from 'ai'

export type LlmProvider =
  | 'openai'
  | 'xai'
  | 'anthropic'
  | 'openrouter'
  | 'deepseek'
  | 'gemini'
  | 'kilocode'
  | 'alibaba'
  | 'huggingface'
  | 'lmstudio'
  | 'custom'

export interface LlmConfig {
  provider: LlmProvider
  model: string
  apiKey?: string
  baseURL?: string
}

const DEFAULTS: LlmConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
}

const ENV_KEYS: Record<LlmProvider, string | undefined> = {
  openai: 'OPENAI_API_KEY',
  xai: 'XAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  gemini: 'GOOGLE_API_KEY',
  kilocode: 'KILOCODE_API_KEY',
  alibaba: 'DASHSCOPE_API_KEY',
  huggingface: 'HF_TOKEN',
  lmstudio: 'LM_API_KEY',
  custom: 'LLM_API_KEY',
}

export function getLlmConfig(): LlmConfig {
  const provider = (process.env.NEXT_LLM_PROVIDER as LlmProvider) || DEFAULTS.provider!
  const model = process.env.NEXT_LLM_MODEL || DEFAULTS.model!
  const apiKey = process.env[ENV_KEYS[provider] || 'LLM_API_KEY']
  const baseURL = process.env.NEXT_LLM_BASE_URL

  return { provider, model, apiKey, baseURL }
}

export function getLlmConfigStatus(): { provider: string; model: string; hasKey: boolean; keyEnv?: string } {
  const config = getLlmConfig()
  const keyEnv = ENV_KEYS[config.provider]
  return {
    provider: config.provider,
    model: config.model,
    hasKey: !!config.apiKey,
    keyEnv,
  }
}

export function createLlmModel(config: LlmConfig) {
  const key = config.apiKey || process.env.LLM_API_KEY || ''

  const openaiCompat = (base: string | undefined, headers?: Record<string, string>) =>
    createOpenAI({ baseURL: base, apiKey: key, ...(headers ? { headers: headers } : {}) })

  // Gateways / OpenAI-compatible
  if (
    config.provider === 'kilocode' ||
    config.provider === 'openrouter' ||
    config.provider === 'custom'
  ) {
    const base =
      config.baseURL ||
      (config.provider === 'kilocode' ? 'https://api.kilo.ai/api/gateway' : undefined) ||
      (config.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : undefined)
    const headers = config.provider === 'openrouter'
      ? { 'HTTP-Referer': 'https://entrytwo.local', 'X-Title': 'entrytwo' }
      : undefined
    return openaiCompat(base, headers)(config.model)
  }

  // xAI - dedicated provider (required for proper Files API + input_file references for PDFs)
  if (config.provider === 'xai') {
    const xaiKey = key || process.env.XAI_API_KEY || process.env.LLM_API_KEY || ''
    const provider = createXai(xaiKey ? { apiKey: xaiKey } : undefined)
    return provider.languageModel(config.model)
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

  // Direct known providers (OpenAI-compatible endpoints)
  const providerBase: Record<string, string | undefined> = {
    deepseek: 'https://api.deepseek.com',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
    huggingface: undefined,
    alibaba: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    lmstudio: 'http://localhost:1234/v1',
  }

  const base = config.baseURL || providerBase[config.provider]
  return openaiCompat(base)(config.model)
}

export function createLlmSearchTools(config: LlmConfig): ToolSet {
  if (config.provider === 'xai') return { web_search: xaiWebSearch() }
  if (config.provider === 'openai') {
    const provider = createOpenAI({ apiKey: config.apiKey || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '' })
    return { web_search: provider.tools.webSearch({ searchContextSize: 'medium' }) }
  }
  return {}
}
