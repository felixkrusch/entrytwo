'use client'

import { useTranslations } from 'next-intl'

import { useEffect, useState } from 'react'
import { PROVIDERS } from '@/lib/providers'

// Force this route to be fully dynamic. Prevents Next.js from attempting static prerender at build time
// (the page does a client-side fetch and must never be statically generated).
export const dynamic = 'force-dynamic'

interface LlmConfigStatus {
  provider: string
  model: string
  hasKey: boolean
  keyEnv?: string
}

export default function AiProviderPage() {
  const tForm = useTranslations('app.aiForm')
  const t = useTranslations('app.adminPages')

  const [status, setStatus] = useState<LlmConfigStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/llm-config')
        const data = await res.json()
        setStatus(data)
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    void fetchStatus()
  }, [])

  if (loading) {
    return <div className="text-sm text-zinc-500">{t('loading')}</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{tForm('title')}</h1>
        <p className="text-xs text-zinc-500">
          Connect OpenAI, xAI (Grok), Anthropic, OpenRouter, Kilo Gateway, DeepSeek, Gemini, Qwen, or Hugging Face.
          API keys are configured via environment variables for security.
        </p>
      </div>

      <div className="space-y-4 text-sm max-w-xl">
        <div className="border border-zinc-800 rounded-lg p-4">
          <div className="font-medium mb-2">{tForm('current')}</div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-400">{tForm('provider')}</span>
              <span className="font-mono">{status?.provider || 'openai'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">{tForm('model')}</span>
              <span className="font-mono">{status?.model || 'gpt-4o-mini'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">{tForm('apiKey')}</span>
              <span className={status?.hasKey ? 'text-emerald-400' : 'text-rose-400'}>
                {status?.hasKey ? `${status.keyEnv} is set` : `${status?.keyEnv || 'LLM_API_KEY'} not configured`}
              </span>
            </div>
          </div>
        </div>

        <div className="text-[10px] text-zinc-500 leading-relaxed space-y-1">
          <p className="font-medium text-zinc-300">To configure, set these environment variables in your .env file:</p>
          <ul className="ml-4 space-y-0.5 font-mono">
            <li><span className="text-emerald-400">NEXT_LLM_PROVIDER</span> = &#34;openai&#34; | &#34;xai&#34; | &#34;anthropic&#34; | &#34;openrouter&#34; | &#34;deepseek&#34; | &#34;gemini&#34; | &#34;kilocode&#34; | &#34;alibaba&#34; | &#34;huggingface&#34; | &#34;lmstudio&#34; | &#34;custom&#34;</li>
            <li><span className="text-emerald-400">NEXT_LLM_MODEL</span> = &#34;gpt-4o-mini&#34; (or your preferred model)</li>
            <li><span className="text-emerald-400">NEXT_LLM_BASE_URL</span> = (optional, for custom endpoint)</li>
            <li className="mt-2">Plus the corresponding API key:</li>
            <li>OPENAI_API_KEY, XAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY</li>
            <li>DEEPSEEK_API_KEY, GOOGLE_API_KEY, KILOCODE_API_KEY, DASHSCOPE_API_KEY, HF_TOKEN, LM_API_KEY</li>
          </ul>
          <p className="mt-2 text-zinc-600">After editing .env, restart the server for changes to take effect.</p>
        </div>

        <div className="border-t border-zinc-800 pt-4 mt-4">
          <div className="font-medium mb-2">Available Providers ({PROVIDERS.length})</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {PROVIDERS.map(p => (
              <div key={p.id} className="border border-zinc-800 rounded px-2 py-1">
                <div className="font-medium">{p.label}</div>
                <div className="text-zinc-500 font-mono truncate">{p.keyEnv || 'no key'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}