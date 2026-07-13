const baseUrl = process.env.JOB_RUNNER_URL || 'http://127.0.0.1:3000'
const secret = process.env.JOB_RUNNER_SECRET
const intervalMs = Math.max(1000, Number(process.env.JOB_RUNNER_INTERVAL_MS || 5000))

if (!secret) throw new Error('JOB_RUNNER_SECRET is required')

let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })

while (!stopping) {
  try {
    const response = await fetch(new URL('/api/jobs/run?limit=20', baseUrl), {
      method: 'POST', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) console.error(`Job runner returned ${response.status}`)
  } catch (error) {
    console.error('Job runner request failed', error instanceof Error ? error.message : error)
  }
  await new Promise(resolve => setTimeout(resolve, intervalMs))
}
