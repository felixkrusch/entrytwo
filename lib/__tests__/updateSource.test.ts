import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  configuredManifestUrl,
  manifestLoadErrorMessage,
  OFFICIAL_COSIGN_IDENTITY,
  OFFICIAL_UPDATE_MANIFEST_URL,
  resolveUpdateFeed,
  type UpdateManifest,
} from '../updateSource'

const manifest: UpdateManifest = {
  version: '1.4.2',
  image: 'ghcr.io/felixkrusch/entrytwo',
  digest: `sha256:${'a'.repeat(64)}`,
  channel: 'stable',
  changelogUrl: 'https://example.test/changelog',
}

describe('configuredManifestUrl', () => {
  it('treats missing, empty, and whitespace as unconfigured', () => {
    expect(configuredManifestUrl(undefined)).toBeNull()
    expect(configuredManifestUrl('')).toBeNull()
    expect(configuredManifestUrl('   ')).toBeNull()
  })

  it('preserves a custom override URL', () => {
    expect(configuredManifestUrl('https://mirror.example/manifest.json')).toBe(
      'https://mirror.example/manifest.json'
    )
  })
})

describe('resolveUpdateFeed', () => {
  it('does not report current when the feed is missing', () => {
    const status = resolveUpdateFeed({
      currentVersion: '1.4.2',
      canUpdate: true,
      manifest: null,
      sourceError: 'unconfigured',
    })
    expect(status.sourceConfigured).toBe(false)
    expect(status.sourceError).toBe('unconfigured')
    expect(status.updateAvailable).toBe(false)
    expect(status.latestVersion).toBe('')
  })

  it('does not report current when the configured feed is unreachable', () => {
    const status = resolveUpdateFeed({
      currentVersion: '1.4.2',
      canUpdate: true,
      manifest: null,
      sourceError: 'unreachable',
    })
    expect(status.sourceConfigured).toBe(true)
    expect(status.sourceError).toBe('unreachable')
    expect(status.updateAvailable).toBe(false)
    expect(status.latestVersion).toBe('')
  })

  it('does not report current when the manifest is invalid', () => {
    const status = resolveUpdateFeed({
      currentVersion: '1.4.2',
      canUpdate: true,
      manifest: null,
      sourceError: 'invalid',
    })
    expect(status.sourceConfigured).toBe(true)
    expect(status.sourceError).toBe('invalid')
    expect(status.updateAvailable).toBe(false)
  })

  it('does not report current when a fetched manifest has no version', () => {
    const status = resolveUpdateFeed({
      currentVersion: '1.4.2',
      canUpdate: true,
      manifest: { ...manifest, version: '' },
    })
    expect(status.sourceConfigured).toBe(true)
    expect(status.sourceError).toBe('invalid')
    expect(status.updateAvailable).toBe(false)
    expect(status.latestVersion).toBe('')
  })

  it('reports current only after a matching fetched feed', () => {
    const status = resolveUpdateFeed({
      currentVersion: '1.4.2',
      canUpdate: true,
      manifest,
    })
    expect(status.sourceConfigured).toBe(true)
    expect(status.sourceError).toBeUndefined()
    expect(status.updateAvailable).toBe(false)
    expect(status.latestVersion).toBe('1.4.2')
    expect(status.targetDigest).toBe(manifest.digest)
  })

  it('reports an available update when versions differ and updates are allowed', () => {
    const status = resolveUpdateFeed({
      currentVersion: '1.4.1',
      canUpdate: true,
      manifest,
    })
    expect(status.updateAvailable).toBe(true)
    expect(status.latestVersion).toBe('1.4.2')
  })

  it('does not advertise an update when the instance cannot update', () => {
    const status = resolveUpdateFeed({
      currentVersion: '1.4.1',
      canUpdate: false,
      manifest,
    })
    expect(status.sourceConfigured).toBe(true)
    expect(status.updateAvailable).toBe(false)
    expect(status.latestVersion).toBe('1.4.2')
  })
})

describe('manifestLoadErrorMessage', () => {
  it('separates missing feed from unreachable feed', () => {
    expect(manifestLoadErrorMessage('unconfigured')).toContain('not configured')
    expect(manifestLoadErrorMessage('unreachable')).toContain('unreachable')
    expect(manifestLoadErrorMessage('invalid')).toContain('invalid')
  })
})

describe('official Docker release templates', () => {
  it('defaults official compose to the signed GitHub Releases feed', () => {
    const yaml = readFileSync(join(process.cwd(), 'deploy/compose.yaml'), 'utf8')
    expect(yaml).toContain(`UPDATE_MANIFEST_URL: \${UPDATE_MANIFEST_URL:-${OFFICIAL_UPDATE_MANIFEST_URL}}`)
    expect(yaml).toMatch(/COSIGN_IDENTITY:\s*"?\$\{COSIGN_IDENTITY:-/)
    expect(yaml).toContain('felixkrusch/entrytwo')
    expect(yaml).toContain(OFFICIAL_COSIGN_IDENTITY.replace(/\\/g, '\\\\'))
    expect(yaml).toContain('UPDATE_VERIFY_SIGNATURE: "true"')
    expect(yaml).toContain('COSIGN_PUBLIC_KEY: ${COSIGN_PUBLIC_KEY:-}')
  })

  it('writes release env example keys instead of appending duplicates', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8')
    expect(workflow).toContain('set_kv UPDATE_MANIFEST_URL')
    expect(workflow).toContain('set_kv COSIGN_IDENTITY')
    expect(workflow).not.toMatch(/cat >> dist\/entrytwo\.env\.example/)
  })

  it('keeps git/npm env example unconfigured so the app does not default a feed', () => {
    const example = readFileSync(join(process.cwd(), '.env.example'), 'utf8')
    expect(example).toMatch(/^UPDATE_MANIFEST_URL="?"?$/m)
    const compose = readFileSync(join(process.cwd(), 'compose.yaml'), 'utf8')
    expect(compose).not.toContain('UPDATE_MANIFEST_URL')
  })
})
