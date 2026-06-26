export interface ProviderInfo {
  id: string
  label: string
  setup: string
  keyEnv?: string
  baseURLHint?: string
  notes?: string
  aliases?: string[]
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'openai', label: 'OpenAI', setup: 'API key via OPENAI_API_KEY env var', keyEnv: 'OPENAI_API_KEY', baseURLHint: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', setup: 'API key via ANTHROPIC_API_KEY env var', keyEnv: 'ANTHROPIC_API_KEY', baseURLHint: 'https://api.anthropic.com/v1' },
  { id: 'xai', label: 'xAI (Grok)', setup: 'API key via XAI_API_KEY env var', keyEnv: 'XAI_API_KEY', baseURLHint: 'https://api.x.ai/v1' },
  { id: 'openrouter', label: 'OpenRouter', setup: 'API key via OPENROUTER_API_KEY env var', keyEnv: 'OPENROUTER_API_KEY', baseURLHint: 'https://openrouter.ai/api/v1' },
  { id: 'deepseek', label: 'DeepSeek', setup: 'API key via DEEPSEEK_API_KEY env var', keyEnv: 'DEEPSEEK_API_KEY', baseURLHint: 'https://api.deepseek.com' },
  { id: 'gemini', label: 'Google Gemini', setup: 'API key via GOOGLE_API_KEY env var', keyEnv: 'GOOGLE_API_KEY', baseURLHint: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'kilocode', label: 'Kilo Gateway', setup: 'API key via KILOCODE_API_KEY env var', keyEnv: 'KILOCODE_API_KEY', baseURLHint: 'https://api.kilo.ai/api/gateway' },
  { id: 'alibaba', label: 'Qwen Cloud', setup: 'API key via DASHSCOPE_API_KEY env var', keyEnv: 'DASHSCOPE_API_KEY' },
  { id: 'huggingface', label: 'Hugging Face', setup: 'Token via HF_TOKEN env var', keyEnv: 'HF_TOKEN' },
  { id: 'lmstudio', label: 'LM Studio', setup: 'Local endpoint (optional key via LM_API_KEY)', keyEnv: 'LM_API_KEY', baseURLHint: 'http://localhost:1234/v1' },
  { id: 'custom', label: 'Custom Endpoint', setup: 'Any OpenAI-compatible API', notes: 'Supply baseURL and key via env vars' },
]

export function getProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find(p => p.id === id || (p.aliases || []).includes(id))
}