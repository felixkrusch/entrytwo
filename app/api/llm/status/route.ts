import { NextResponse } from 'next/server'
import { getLlmConfig } from '@/lib/llm'

// Very simple server-side cache so we don't hammer providers from every browser tab.
// Hybrid approach: real chat outcomes (primary) + occasional cheap probes (secondary).
let cached: any = null
let cachedAt = 0
const TTL_MS = 90_000 // 90s

export async function GET() {
  try {
    const config = getLlmConfig()
    const hasKey = !!config.apiKey

    const now = Date.now()

    // Return fresh cached value if still valid
    if (cached && (now - cachedAt < TTL_MS)) {
      return NextResponse.json(cached)
    }

    if (!hasKey) {
      const payload = {
        provider: config.provider,
        model: config.model,
        hasKey: false,
        connected: false,
        lastChecked: now,
      }
      cached = payload
      cachedAt = now
      return NextResponse.json(payload)
    }

    // Cheap probe (no generation). Try /models on the best-guess base URL.
    let connected = false
    try {
      const key = config.apiKey!
      let base = config.baseURL

      if (!base) {
        const provider = config.provider
        const defaults: Record<string, string | undefined> = {
          openai: 'https://api.openai.com/v1',
          xai: 'https://api.x.ai/v1',
          deepseek: 'https://api.deepseek.com/v1',
          gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
          alibaba: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          lmstudio: 'http://localhost:1234/v1',
          openrouter: 'https://openrouter.ai/api/v1',
          kilocode: 'https://api.kilo.ai/api/gateway',
          anthropic: 'https://api.anthropic.com/v1',
          custom: config.baseURL,
        }
        base = defaults[provider]
      }

      if (base) {
        const url = `${base.replace(/\/$/, '')}/models`
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), 4500)
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        })
        clearTimeout(t)
        connected = res.ok
      } else {
        // Can't cheaply probe this provider → we at least have a key
        connected = true
      }
    } catch {
      connected = false
    }

    const payload = {
      provider: config.provider,
      model: config.model,
      hasKey: true,
      connected,
      lastChecked: now,
    }

    cached = payload
    cachedAt = now
    return NextResponse.json(payload)
  } catch (e) {
    return NextResponse.json({
      provider: 'unknown',
      model: '',
      hasKey: false,
      connected: false,
      error: (e as Error)?.message || 'unknown',
    })
  }
}
