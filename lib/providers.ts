export interface ProviderInfo {
  id: string
  label: string
  setup: string
  keyEnv?: string
  oauth?: boolean
  baseURLHint?: string
  aliases?: string[]
  notes?: string
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'nous-portal', label: 'Nous Portal', setup: 'OAuth / subscription-based (hermes model)', oauth: true, notes: 'Subscription via browser login' },
  { id: 'openai-codex', label: 'OpenAI Codex', setup: 'ChatGPT OAuth (uses Codex models)', oauth: true, keyEnv: 'OPENAI_API_KEY', notes: 'Paste token from ChatGPT OAuth' },
  { id: 'github-copilot', label: 'GitHub Copilot', setup: 'OAuth device code / GH_TOKEN', oauth: true, keyEnv: 'GITHUB_TOKEN', notes: 'Use gh auth token or COPILOT_GITHUB_TOKEN' },
  { id: 'github-copilot-acp', label: 'GitHub Copilot ACP', setup: 'Local copilot --acp --stdio', oauth: false, notes: 'Advanced: requires local copilot process' },
  { id: 'anthropic', label: 'Anthropic', setup: 'Claude Max OAuth + API key', oauth: true, keyEnv: 'ANTHROPIC_API_KEY', baseURLHint: 'https://api.anthropic.com/v1' },
  { id: 'openrouter', label: 'OpenRouter', setup: 'API key', keyEnv: 'OPENROUTER_API_KEY', baseURLHint: 'https://openrouter.ai/api/v1' },
  { id: 'novita', label: 'NovitaAI', setup: 'API key', keyEnv: 'NOVITA_API_KEY', baseURLHint: 'https://api.novita.ai/v3' },
  { id: 'zai', label: 'z.ai / GLM', setup: 'API key', keyEnv: 'GLM_API_KEY' },
  { id: 'kimi-coding', label: 'Kimi / Moonshot', setup: 'API key', keyEnv: 'KIMI_API_KEY' },
  { id: 'kimi-coding-cn', label: 'Kimi / Moonshot (China)', setup: 'API key', keyEnv: 'KIMI_CN_API_KEY' },
  { id: 'arcee', label: 'Arcee AI', setup: 'API key', keyEnv: 'ARCEEAI_API_KEY' },
  { id: 'gmi', label: 'GMI Cloud', setup: 'API key', keyEnv: 'GMI_API_KEY' },
  { id: 'minimax', label: 'MiniMax', setup: 'API key', keyEnv: 'MINIMAX_API_KEY' },
  { id: 'minimax-cn', label: 'MiniMax China', setup: 'API key', keyEnv: 'MINIMAX_CN_API_KEY' },
  { id: 'xai', label: 'xAI (Grok) — Responses API', setup: 'API key', keyEnv: 'XAI_API_KEY', baseURLHint: 'https://api.x.ai/v1' },
  { id: 'xai-oauth', label: 'xAI Grok OAuth (SuperGrok)', setup: 'OAuth (SuperGrok / Premium+)', oauth: true, notes: 'Browser login, no separate key needed after OAuth' },
  { id: 'alibaba', label: 'Qwen Cloud (Alibaba DashScope)', setup: 'API key', keyEnv: 'DASHSCOPE_API_KEY' },
  { id: 'alibaba-coding-plan', label: 'Alibaba Cloud (Coding Plan)', setup: 'API key (separate SKU)', keyEnv: 'DASHSCOPE_API_KEY' },
  { id: 'kilocode', label: 'Kilo Code', setup: 'API key', keyEnv: 'KILOCODE_API_KEY', baseURLHint: 'https://api.kilo.ai/api/gateway' },
  { id: 'xiaomi', label: 'Xiaomi MiMo', setup: 'API key', keyEnv: 'XIAOMI_API_KEY' },
  { id: 'tencent-tokenhub', label: 'Tencent TokenHub', setup: 'API key', keyEnv: 'TOKENHUB_API_KEY' },
  { id: 'opencode-zen', label: 'OpenCode Zen', setup: 'API key', keyEnv: 'OPENCODE_ZEN_API_KEY' },
  { id: 'opencode-go', label: 'OpenCode Go', setup: 'API key', keyEnv: 'OPENCODE_GO_API_KEY' },
  { id: 'deepseek', label: 'DeepSeek', setup: 'API key', keyEnv: 'DEEPSEEK_API_KEY', baseURLHint: 'https://api.deepseek.com' },
  { id: 'huggingface', label: 'Hugging Face', setup: 'API key / token', keyEnv: 'HF_TOKEN' },
  { id: 'gemini', label: 'Google / Gemini', setup: 'API key', keyEnv: 'GOOGLE_API_KEY', baseURLHint: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'openai-api', label: 'OpenAI API (direct)', setup: 'API key', keyEnv: 'OPENAI_API_KEY', baseURLHint: 'https://api.openai.com/v1' },
  { id: 'azure-foundry', label: 'Azure AI Foundry', setup: 'OAuth / key via Azure', oauth: true, notes: 'Uses Azure OpenAI / Foundry endpoint' },
  { id: 'bedrock', label: 'AWS Bedrock', setup: 'AWS credentials (boto3 chain)', oauth: false, notes: 'Standard AWS auth required' },
  { id: 'nvidia', label: 'NVIDIA Build', setup: 'API key', keyEnv: 'NVIDIA_API_KEY' },
  { id: 'ollama-cloud', label: 'Ollama Cloud', setup: 'OAuth / hosted', oauth: true },
  { id: 'qwen-oauth', label: 'Qwen OAuth', setup: 'OAuth (browser PKCE)', oauth: true },
  { id: 'minimax-oauth', label: 'MiniMax (OAuth)', setup: 'OAuth (browser PKCE)', oauth: true },
  { id: 'stepfun', label: 'StepFun', setup: 'API key', keyEnv: 'STEPFUN_API_KEY' },
  { id: 'lmstudio', label: 'LM Studio', setup: 'Local / optional key', keyEnv: 'LM_API_KEY', baseURLHint: 'http://localhost:1234/v1' },
  { id: 'custom', label: 'Custom Endpoint', setup: 'Saved in config', oauth: false, notes: 'Any OpenAI-compatible base URL + key' },
]

export function getProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find(p => p.id === id || (p.aliases || []).includes(id))
}
