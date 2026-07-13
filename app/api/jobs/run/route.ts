import { NextResponse, NextRequest } from 'next/server'
import { dispatchJob } from '@/lib/jobHandlers'
import { runAvailableJobs } from '@/lib/jobs'
import { getRequestId } from '@/lib/correlation'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)

  const limited = await rateLimit(request, { keyPrefix: 'job-runner', limit: 120, windowMs: 60_000 })
  if (limited) {
    limited.headers.set('x-request-id', requestId)
    return limited
  }

  const expected = process.env.JOB_RUNNER_SECRET
  const supplied = request.headers.get('authorization')
  if (!expected || supplied !== `Bearer ${expected}`) {
    const res = NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 })
    res.headers.set('x-request-id', requestId)
    return res
  }
  const limit = Number(new URL(request.url).searchParams.get('limit') || 20)
  const results = await runAvailableJobs(job => dispatchJob(job.type, job.payload), limit)
  const res = NextResponse.json({ processed: results.length, results, requestId })
  res.headers.set('x-request-id', requestId)
  return res
}
