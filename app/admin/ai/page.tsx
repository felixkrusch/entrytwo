import { PROVIDERS } from '@/lib/providers'

export default function AiProviderPage() {
  const providerOptions = PROVIDERS.map(p => ({ value: p.id, label: p.label }))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">AI / LLM Provider</h1>
        <p className="text-xs text-zinc-500">
          Connect OpenAI, xAI, Anthropic, OpenRouter, Kilo Gateway, DeepSeek, Gemini, Qwen, or Hugging Face.
          All providers use API keys stored in environment variables for security.
        </p>
      </div>

      <div className="space-y-4 text-sm max-w-xl">
        <div className="text-[10px] text-zinc-500 leading-relaxed space-y-1">
          <p>Set the following environment variables in your .env file:</p>
          <ul className="ml-4 space-y-0.5 font-mono">
            <li><span className="text-emerald-400">NEXT_LLM_PROVIDER</span> - Provider selection (openai, anthropic, xai, openrouter, etc.)</li>
            <li><span className="text-emerald-400">NEXT_LLM_MODEL</span> - Model name (e.g., gpt-4o-mini, claude-3-5-sonnet)</li>
            <li><span className="text-emerald-400">NEXT_LLM_BASE_URL</span> - Optional: custom endpoint for &#34;custom&#34; provider</li>
            <li className="mt-2">Plus the corresponding API key:</li>
            <li>OPENAI_API_KEY, XAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY</li>
            <li>DEEPSEEK_API_KEY, GOOGLE_API_KEY, KILOCODE_API_KEY, DASHSCOPE_API_KEY, HF_TOKEN, LM_API_KEY</li>
          </ul>
        </div>

        <div className="border-t border-zinc-800 pt-4 mt-4">
          <p className="text-[10px] text-zinc-600">
            Available providers: {providerOptions.map(p => p.label).join(', ')}
          </p>
        </div>
      </div>
    </div>
  )
}