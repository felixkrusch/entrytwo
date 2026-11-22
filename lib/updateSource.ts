export const OFFICIAL_UPDATE_MANIFEST_URL =
  'https://github.com/felixkrusch/entrytwo-releases/releases/latest/download/manifest.json'

export const OFFICIAL_COSIGN_IDENTITY =
  '^https://github\\.com/felixkrusch/entrytwo/\\.github/workflows/release\\.yml@refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+$'

export interface UpdateManifest {
  version: string
  image: string
  digest: string
  minSupportedVersion?: string
  channel?: string
  publishedAt?: string
  changelogUrl?: string
}

export type UpdateSourceError = 'unconfigured' | 'unreachable' | 'invalid'

export type UpdateFeedStatus = {
  sourceConfigured: boolean
  sourceError?: UpdateSourceError
  updateAvailable: boolean
  latestVersion: string
  targetDigest: string
  channel: string
  changelogUrl: string
}

const emptyFeed = {
  updateAvailable: false,
  latestVersion: '',
  targetDigest: '',
  channel: '',
  changelogUrl: '',
} as const

export function configuredManifestUrl(value = process.env.UPDATE_MANIFEST_URL): string | null {
  const url = (value || '').trim()
  return url || null
}

export function manifestLoadErrorMessage(reason: UpdateSourceError): string {
  if (reason === 'unconfigured') return 'UPDATE_MANIFEST_URL is not configured.'
  if (reason === 'unreachable') return 'UPDATE_MANIFEST_URL is unreachable.'
  return 'Update manifest is invalid.'
}

export function resolveUpdateFeed(input: {
  currentVersion: string
  canUpdate: boolean
  manifest: UpdateManifest | null
  sourceError?: UpdateSourceError
}): UpdateFeedStatus {
  if (input.sourceError === 'unconfigured' || (!input.manifest && !input.sourceError)) {
    return { sourceConfigured: false, sourceError: 'unconfigured', ...emptyFeed }
  }
  if (!input.manifest?.version) {
    return { sourceConfigured: true, sourceError: input.sourceError || 'invalid', ...emptyFeed }
  }
  const latestVersion = input.manifest.version || ''
  return {
    sourceConfigured: true,
    updateAvailable: Boolean(
      latestVersion && input.currentVersion && latestVersion !== input.currentVersion && input.canUpdate
    ),
    latestVersion,
    targetDigest: input.manifest.digest || '',
    channel: input.manifest.channel || '',
    changelogUrl: input.manifest.changelogUrl || '',
  }
}
