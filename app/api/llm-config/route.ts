import { getLlmConfigStatus } from '@/lib/llm'

export async function GET() {
  const status = getLlmConfigStatus()
  return Response.json(status)
}