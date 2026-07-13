import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'
import { describe, expect, it } from 'vitest'

const apiRoot = join(process.cwd(), 'app', 'api')
const locallyPublicRoutes = new Set([
  'auth/[...nextauth]/route.ts',
  'auth/dev/route.ts',
  'bootstrap/status/route.ts',
  'health/route.ts',
  'jobs/run/route.ts',
  'onboarding/route.ts',
  'webhooks/paypal/route.ts',
  'webhooks/stripe/route.ts',
  'invitations/validate/route.ts',
])

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return routeFiles(path)
    return entry.name === 'route.ts' ? [path] : []
  })
}

describe('API route-local authentication', () => {
  it('keeps a local auth guard on every non-public API route', () => {
    const missing = routeFiles(apiRoot)
      .map(path => ({ path, relativePath: relative(apiRoot, path) }))
      .filter(({ relativePath }) => !locallyPublicRoutes.has(relativePath))
      .filter(({ path }) => !/requireUser\(|await auth\(|= auth\(/.test(readFileSync(path, 'utf8')))
      .map(({ relativePath }) => relativePath)

    expect(missing).toEqual([])
  })

  it('keeps development authentication explicitly disabled in production', () => {
    const source = readFileSync(join(apiRoot, 'auth', 'dev', 'route.ts'), 'utf8')
    expect(source).toContain("process.env.NODE_ENV === 'production'")
  })
})
