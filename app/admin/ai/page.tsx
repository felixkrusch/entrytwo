'use client'

import { useEffect, useState } from 'react'
import { PROVIDERS, getProvider } from '@/lib/providers'

interface Setting {
  id: string
  key: string
  value: { value?: string } | Record<string, unknown>
}

export default function AiProviderPage() {
  const [settings, setSettings] = useState<Setting[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    try {
      const res = await fetch('/api/settings')
      const s = await res.json()
      if (Array.isArray(s)) setSettings(s)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchData()
  }, [])

  const save = async (key: string, val: string) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: { value: val } }),
    })
    fetchData()
  }

  if (loading) {
    return <div className="text-sm text-zinc-500">Loading...</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">AI / LLM Provider</h1>
        <p className="text-xs text-zinc-500">
          Connect OpenAI, xAI (Grok), Anthropic, OpenRouter, Kilo Gateway, or any OpenAI-compatible endpoint.
          Supports API keys and keys obtained via OAuth flows (paste the resulting key).
        </p>
      </div>

      <LlmSettings settings={settings} onSaved={fetchData} />
    </div>
  )
}

/* Local LLM settings component (same logic as the old one, just moved here) */
function LlmSettings({ settings, onSaved }: { settings: Setting[]; onSaved: () => void }) {
  const providerKey = settings.find(s => s.key === 'llm.provider')?.value as { value?: string } | undefined
  const modelKey = settings.find(s => s.key === 'llm.model')?.value as { value?: string } | undefined
  const apiKeySetting = settings.find(s => s.key === 'llm.apiKey')?.value as { value?: string } | undefined
  const baseUrlSetting = settings.find(s => s.key === 'llm.baseURL')?.value as { value?: string } | undefined

  const [provider, setProvider] = useState<string>(providerKey?.value || 'openai')
  const [model, setModel] = useState<string>(modelKey?.value || 'gpt-4o-mini')
  const [apiKey, setApiKey] = useState<string>(apiKeySetting?.value || '')
  const [baseURL, setBaseURL] = useState<string>(baseUrlSetting?.value || '')

  const providerOptions = PROVIDERS.map(p => ({ value: p.id, label: p.label }))
  const current = getProvider(provider) || PROVIDERS.find(p => p.id === 'openai')!

  const getHelpLink = (p: string) => {
    const info = getProvider(p)
    if (info?.oauth) return null
    if (p.includes('openai')) return 'https://platform.openai.com/api-keys'
    if (p.includes('xai')) return 'https://console.x.ai/'
    if (p === 'anthropic') return 'https://console.anthropic.com/'
    if (p === 'openrouter') return 'https://openrouter.ai/keys'
    if (p === 'kilocode') return 'https://app.kilo.ai/'
    if (p === 'gemini') return 'https://aistudio.google.com/app/apikey'
    if (p === 'deepseek') return 'https://platform.deepseek.com/api_keys'
    if (p === 'huggingface') return 'https://huggingface.co/settings/tokens'
    if (p.startsWith('alibaba')) return 'https://bailian.console.aliyun.com/'
    return null
  }

  const saveField = async (key: string, val: string) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: { value: val } }),
    })
    onSaved()
  }

  const handleProviderChange = async (val: string) => {
    setProvider(val)
    await saveField('llm.provider', val)

    const info = getProvider(val)
    if ((val.includes('xai') || val === 'xai-oauth') && !model.includes('grok')) setModel('grok-3')
    if (val === 'anthropic' && !model.includes('claude')) setModel('claude-3-5-sonnet-20241022')
    if (val === 'openrouter' && !model.includes('/')) setModel('anthropic/claude-sonnet-4-20250514')
    if (val === 'kilocode') setModel('anthropic/claude-sonnet-4.5')
    if (val === 'gemini') setModel('gemini-1.5-pro')
    if (val === 'deepseek') setModel('deepseek-chat')
    if (val === 'openai' || val === 'openai-api' || val === 'openai-codex') setModel('gpt-4o-mini')
    if (val === 'alibaba' || val === 'alibaba-coding-plan') setModel('qwen2.5-coder-32b-instruct')
    if (val === 'huggingface') setModel('meta-llama/Meta-Llama-3.1-70B-Instruct')
    if (val === 'ollama-cloud') setModel('llama3.1')
    if (val === 'lmstudio') setModel('local-model')
  }

  return (
    <div className="space-y-4 text-sm max-w-xl">
      <div className="flex items-start gap-3">
        <label className="w-48 text-zinc-400 pt-1">Provider</label>
        <div className="flex-1">
          <select
            value={provider}
            onChange={e => handleProviderChange(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
          >
            {providerOptions.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>

          <div className="mt-1 text-[10px] text-zinc-500">
            {current.setup}
            {current.oauth && <span className="ml-2 rounded bg-emerald-900 px-1.5 py-px text-emerald-400">OAuth</span>}
            {current.keyEnv && <span className="ml-2 text-amber-400">API key: {current.keyEnv}</span>}
          </div>

          {getHelpLink(provider) && (
            <a href={getHelpLink(provider)!} target="_blank" className="text-emerald-400 text-xs hover:underline block mt-1">
              Get key / Sign in →
            </a>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="w-48 text-zinc-400">Model</label>
        <input
          value={model}
          onChange={e => setModel(e.target.value)}
          onBlur={() => saveField('llm.model', model)}
          placeholder="e.g. grok-3, claude-3-5-sonnet-20241022, anthropic/claude-sonnet-4..."
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-xs"
        />
      </div>

      <div className="flex items-center gap-3">
        <label className="w-48 text-zinc-400">API Key / Token</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          onBlur={() => saveField('llm.apiKey', apiKey)}
          placeholder="Paste API key here (for OAuth providers: paste the token you received after login)"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-xs"
        />
      </div>

      <div className="flex items-center gap-3">
        <label className="w-48 text-zinc-400">Base URL (optional)</label>
        <input
          value={baseURL}
          onChange={e => setBaseURL(e.target.value)}
          onBlur={() => saveField('llm.baseURL', baseURL)}
          placeholder={current.baseURLHint || "https://... (leave empty for default)"}
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-xs"
        />
      </div>

      <div className="text-[10px] text-zinc-500 leading-relaxed">
        Full Hermes-style support (OAuth + API keys).<br />
        For OAuth providers (Kilo, xAI SuperGrok, GitHub Copilot, Anthropic Claude Max, Qwen, MiniMax, etc.): complete login in the browser, then paste the resulting key/token here.<br />
        API keys for OpenRouter, Kilo Gateway, DeepSeek, Grok, Gemini, etc. are stored encrypted in your local database.
      </div>
    </div>
  )
}
