import './check-node.mjs'
import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    bootstrap: { type: 'boolean', default: false },
    email: { type: 'string' },
    company: { type: 'string' },
  },
})
const base = new URL(positionals[0] || 'http://localhost:3000')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Only loopback installations may be tested')
assert.equal(base.protocol, 'http:', 'Use a local development HTTP instance')
if (values.bootstrap) assert.ok(values.email && values.company, '--bootstrap requires --email and --company; this creates real local records')

async function request(path, options) {
  const response = await fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(30_000) })
  assert.ok(response.ok, `${path} returned HTTP ${response.status}`)
  return response.json()
}

const health = await request('/api/health')
assert.equal(health.ready, true, 'Installation is not ready')
assert.equal(health.storage, 'reachable')
console.log('entrytwo: database and private storage are ready')

if (values.bootstrap) {
  // Verify development mode before creating an administrator or company.
  const providers = await request('/api/auth/providers')
  assert.ok(providers.credentials, 'Refusing bootstrap: instant development login is not enabled')
  const onboarding = await request('/api/onboarding')
  assert.equal(onboarding.needsBootstrap, true, 'Refusing to modify an installation that already has an administrator')
  await request('/api/onboarding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: values.email, companyName: values.company, baseCurrency: 'EUR', defaultLanguage: 'en' }),
  })
  const login = await fetch(new URL('/api/auth/dev', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: values.email }),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  assert.equal(login.status, 303, `Development login returned HTTP ${login.status}`)
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie, 'Development login did not return a session cookie')
  const session = await request('/api/auth/session', { headers: { cookie } })
  assert.equal(session.user?.role, 'ADMIN')
  assert.equal(session.user?.email?.toLowerCase(), values.email.toLowerCase())
  console.log('entrytwo: onboarding and administrator session verified; no cookies written to disk')
}
