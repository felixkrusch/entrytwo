import { NextResponse } from 'next/server'
import { dispatchJob } from '@/lib/jobHandlers'
import { runAvailableJobs } from '@/lib/jobs'

export async function POST(request: Request) {
  const expected = process.env.JOB_RUNNER_SECRET
  const supplied = request.headers.get('authorization')
  if (!expected || supplied !== `Bearer ${expected}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limit = Number(new URL(request.url).searchParams.get('limit') || 20)
  const results = await runAvailableJobs(job => dispatchJob(job.type, job.payload), limit)
  return NextResponse.json({ processed: results.length, results })
}
