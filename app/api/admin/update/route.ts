import { NextResponse, NextRequest } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { writeFile, mkdir, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { getRequestId } from '@/lib/correlation'
import { rateLimit } from '@/lib/rate-limit'

const execAsync = promisify(exec)

const LOCK_FILE = join(process.cwd(), '.update-lock')
const BACKUP_DIR = join(process.cwd(), 'backups')

interface UpdateManifest {
  version: string
  image: string
  digest: string
  minSupportedVersion?: string
  channel?: string
  publishedAt?: string
  changelogUrl?: string
}

interface UpdateState {
  status: 'idle' | 'updating' | 'success' | 'error'
  progress: string
  error?: string
  message?: string
  backupPath?: string
}

// In-process progress state so the client can poll real stages instead of a
// blind reload (see docs §7). Survives a single request lifecycle.
let updateState: UpdateState = { status: 'idle', progress: '' }

async function writeProgress(progress: string): Promise<void> {
  updateState.progress = progress
  try {
    await writeFile(LOCK_FILE, Date.now().toString())
  } catch {}
}

async function acquireLock(): Promise<boolean> {
  try {
    await writeFile(LOCK_FILE, Date.now().toString())
    return true
  } catch {
    return false
  }
}

async function releaseLock(): Promise<void> {
  try {
    await unlink(LOCK_FILE)
  } catch {}
}

async function isLocked(): Promise<boolean> {
  try {
    await readFile(LOCK_FILE, 'utf-8')
    return true
  } catch {
    return false
  }
}

function serialize(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof Date) return value.toISOString()
  if (
    typeof value === 'object' &&
    'toNumber' in value &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  ) {
    try {
      return (value as { toNumber: () => number }).toNumber()
    } catch {
      return String(value)
    }
  }
  if (Array.isArray(value)) return value.map(serialize)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v)
    return out
  }
  return value
}

// Full pre-update backup of every business table (not just a subset).
async function createFullBackup(): Promise<{ path: string; success: boolean }> {
  try {
    await mkdir(BACKUP_DIR, { recursive: true })

    const data: Record<string, unknown> = {}
    data.accounts = serialize(await prisma.account.findMany())
    data.journalEntries = serialize(await prisma.journalEntry.findMany({ include: { lines: true } }))
    data.taxRates = serialize(await prisma.taxRate.findMany())
    data.settings = serialize(await prisma.setting.findMany())
    data.templates = serialize(await prisma.template.findMany())
    data.users = serialize(
      await prisma.user.findMany({
        select: { id: true, email: true, name: true, role: true, createdAt: true },
      })
    )
    data.contacts = serialize(await prisma.contact.findMany())
    data.invoices = serialize(await prisma.invoice.findMany({ include: { lines: true } }))
    data.events = serialize(await prisma.event.findMany())
    data.bankConnections = serialize(await prisma.bankConnection.findMany())
    data.feedTransactions = serialize(await prisma.feedTransaction.findMany())
    data.branches = serialize(await prisma.accountingBranch.findMany())
    data.snapshots = serialize(await prisma.snapshot.findMany())
    data.agentMemory = serialize(await prisma.agentMemory.findMany())
    data.recurringInvoices = serialize(await prisma.recurringInvoice.findMany())
    data.recurringJournalEntries = serialize(await prisma.recurringJournalEntry.findMany())

    const backupData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      appVersion: process.env.APP_VERSION || 'unknown',
      data,
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = join(BACKUP_DIR, `pre-update-${timestamp}.json`)
    await writeFile(path, JSON.stringify(backupData, null, 2))
    return { path, success: true }
  } catch (e) {
    console.error('Backup failed:', e)
    return { path: '', success: false }
  }
}

function runningVersion(): string {
  return process.env.APP_VERSION || 'unknown'
}

function composeFile(): string {
  return process.env.COMPOSE_FILE || '/app/entrytwo/compose.yaml'
}

function updateService(): string {
  return process.env.UPDATE_SERVICE || 'app'
}

function dcCmd(): string {
  return `docker compose -f "${composeFile()}"`
}

// Parse "1.4.2" -> [1,4,2] for ordering comparisons.
function parseVersion(v: string): number[] {
  return (v || '')
    .split('.')
    .map(n => parseInt(n.replace(/[^0-9].*$/, ''), 10))
    .filter(n => !Number.isNaN(n))
}

function versionGte(a: string, b: string): boolean {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return true
}

// Image id of the currently running service container (for rollback).
async function currentImageId(): Promise<string> {
  const { stdout } = await execAsync(`${dcCmd()} ps -q ${updateService()}`)
  const containerId = stdout.trim().split('\n')[0]
  if (!containerId) return ''
  const { stdout: img } = await execAsync(`docker inspect -f '{{.Image}}' ${containerId}`)
  return img.trim()
}

// Verify the target image digest against our signing identity (keyless) or a
// pinned public key (offline). Throws on any failure.
async function verifyImageSignature(ref: string): Promise<void> {
  const identity = process.env.COSIGN_IDENTITY
  const issuer = process.env.COSIGN_OIDC_ISSUER || 'https://token.actions.githubusercontent.com'
  const publicKey = process.env.COSIGN_PUBLIC_KEY
  const extra = process.env.COSIGN_VERIFY_ARGS || ''

  let cmd = 'cosign verify'
  if (publicKey) {
    cmd += ` --key ${publicKey}`
  } else if (identity) {
    cmd += ` --certificate-identity-regexp '${identity}' --certificate-oidc-issuer ${issuer}`
  } else {
    throw new Error(
      'Signature verification is enabled but neither COSIGN_IDENTITY nor COSIGN_PUBLIC_KEY is configured. ' +
      'Set one of them, or set UPDATE_VERIFY_SIGNATURE=false to run unverified (not recommended).'
    )
  }
  if (extra) cmd += ` ${extra}`
  cmd += ` ${ref}`

  await execAsync(cmd).catch(e => {
    throw new Error(`Signature verification failed: ${e instanceof Error ? e.message : String(e)}`)
  })
}

// Poll the in-app health endpoint after a recreate; returns true if healthy.
async function waitForHealth(maxAttempts = 20, intervalMs = 3000): Promise<boolean> {
  const base = process.env.APP_PUBLIC_URL || 'http://localhost:3000'
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${base}/api/health`, { cache: 'no-store' })
      if (res.ok) {
        const json = (await res.json()) as { status?: string; database?: string }
        if (json.status === 'ok' && json.database === 'connected') return true
      }
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

async function fetchManifest(): Promise<UpdateManifest | null> {
  const manifestUrl = process.env.UPDATE_MANIFEST_URL
  if (!manifestUrl) return null
  const res = await fetch(manifestUrl, { cache: 'no-store' })
  if (!res.ok) return null
  return (await res.json()) as UpdateManifest
}

// When UPDATER_URL is set, the app delegates all Docker operations to the
// isolated updater sidecar and never touches the socket itself (docs §6).
const SIDEKICK_ENABLED = !!process.env.UPDATER_URL

async function sidecarStatus(): Promise<{ status?: string; running?: boolean; progress?: string; error?: string; message?: string } | null> {
  const url = process.env.UPDATER_URL
  if (!url) return null
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/status`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as { status?: string; running?: boolean; progress?: string; error?: string; message?: string }
  } catch {
    return null
  }
}

async function sidecarKickoff(
  manifest: UpdateManifest,
  appImage: string
): Promise<string | null> {
  const url = process.env.UPDATER_URL!
  const token = process.env.UPDATER_TOKEN || ''
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-updater-token': token },
      body: JSON.stringify({
        manifest,
        appImage,
        service: updateService(),
        composeFile: composeFile(),
        appHealthUrl: `${process.env.APP_PUBLIC_URL || 'http://localhost:3000'}/api/health`,
      }),
    })
    if (res.ok) return null
    const d = (await res.json().catch(() => ({}))) as { error?: string }
    return d.error || `Updater sidecar refused update (${res.status}).`
  } catch (e) {
    return `Could not reach updater sidecar: ${e instanceof Error ? e.message : String(e)}`
  }
}

// Record an audit event for a completed sidecar update, once per digest.
// State lives in the mounted backups volume so it survives the app recreate.
async function maybeAuditSidecar(manifest: UpdateManifest | null): Promise<void> {
  if (!manifest?.digest) return
  const flagFile = join(BACKUP_DIR, '.last-update-audit.json')
  let last = ''
  try {
    last = JSON.parse(await readFile(flagFile, 'utf8')).digest || ''
  } catch {}
  if (last === manifest.digest) return
  await prisma.event
    .create({
      data: {
        eventType: 'SYSTEM',
        entityType: 'Update',
        entityId: 'system',
        payload: {
          action: 'UPDATE_EXECUTED',
          fromVersion: runningVersion(),
          toVersion: manifest.version,
          targetDigest: manifest.digest,
          channel: manifest.channel,
          changelogUrl: manifest.changelogUrl,
          backupCreated: true,
          via: 'sidecar',
        },
      },
    })
    .catch(() => {})
  try {
    await writeFile(flagFile, JSON.stringify({ digest: manifest.digest, at: new Date().toISOString() }))
  } catch {}
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)

  const limited = await rateLimit(request, { keyPrefix: 'admin-update', limit: 30, windowMs: 60_000 })
  if (limited) {
    limited.headers.set('x-request-id', requestId)
    return limited
  }

  try {
    const currentVersion = runningVersion()
    const appImage = process.env.APP_IMAGE || ''

    let latestVersion = ''
    let targetDigest = ''
    let channel = ''
    let changelogUrl = ''
    let updateAvailable = false

    const manifest = await fetchManifest().catch(() => null)
    if (manifest) {
      latestVersion = manifest.version || ''
      targetDigest = manifest.digest || ''
      channel = manifest.channel || ''
      changelogUrl = manifest.changelogUrl || ''
      if (latestVersion && currentVersion && latestVersion !== currentVersion) {
        updateAvailable = true
      }
    }

    if (SIDEKICK_ENABLED) {
      const s = await sidecarStatus()
      const base = {
        currentVersion,
        latestVersion,
        targetDigest,
        channel,
        changelogUrl,
        appImage,
        updateAvailable,
        requestId,
        lastChecked: new Date().toISOString(),
      }
      if (s && s.status && s.status !== 'idle') {
        if (s.status === 'success' && manifest) await maybeAuditSidecar(manifest)
        return NextResponse.json({
          ...base,
          status: s.status === 'success' ? 'success' : s.status === 'error' ? 'error' : 'updating',
          progress: s.progress || '',
          error: s.error,
          message: s.message,
        })
      }
      return NextResponse.json({
        ...base,
        status: updateState.status,
        progress: updateState.progress,
        error: updateState.error,
        message: updateState.message,
      })
    }

    if (updateState.status === 'updating') {
      return NextResponse.json({
        currentVersion,
        latestVersion,
        targetDigest,
        channel,
        changelogUrl,
        appImage,
        updateAvailable,
        lastChecked: new Date().toISOString(),
        status: 'updating',
        progress: updateState.progress,
      })
    }

    const updating = await isLocked()

    return NextResponse.json({
      currentVersion,
      latestVersion,
      targetDigest,
      channel,
      changelogUrl,
      appImage,
      updateAvailable,
      lastChecked: new Date().toISOString(),
      status: updating ? 'updating' : updateState.status,
      progress: updateState.progress,
      error: updateState.error,
      message: updateState.message,
      backupPath: updateState.backupPath,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check updates' },
      { status: 500 }
    )
  }
}

// Runs the full update pipeline and reports staged progress to `updateState`.
async function runUpdate(): Promise<void> {
  const appImage = process.env.APP_IMAGE || ''
  try {
    await writeProgress('Resolving target from signed manifest…')

    const manifest = await fetchManifest()
    if (!manifest) {
      updateState = { status: 'error', progress: '', error: 'UPDATE_MANIFEST_URL is not configured or unreachable.' }
      await releaseLock()
      return
    }
    const { version: targetVersion, image: imageRepo, digest: targetDigest, minSupportedVersion, changelogUrl } = manifest
    if (!targetVersion || !imageRepo || !targetDigest) {
      updateState = { status: 'error', progress: '', error: 'Update manifest is missing version/image/digest.' }
      await releaseLock()
      return
    }
    if (!targetDigest.startsWith('sha256:')) {
      updateState = { status: 'error', progress: '', error: 'Manifest digest must be a sha256 digest (sha256:...).' }
      await releaseLock()
      return
    }
    if (minSupportedVersion && !versionGte(runningVersion(), minSupportedVersion)) {
      updateState = {
        status: 'error',
        progress: '',
        error: `Current version ${runningVersion()} is below the minimum supported ${minSupportedVersion}. A manual stepped upgrade is required.`,
      }
      await releaseLock()
      return
    }
    const targetRef = `${imageRepo}@${targetDigest}`

    await writeProgress('Creating full pre-update backup…')
    const backup = await createFullBackup()
    if (!backup.success) {
      updateState = { status: 'error', progress: '', error: 'Backup failed - update aborted for safety.' }
      await releaseLock()
      return
    }

    if (process.env.UPDATE_VERIFY_SIGNATURE !== 'false') {
      await writeProgress(`Verifying cosign signature for ${targetRef}…`)
      await verifyImageSignature(targetRef)
    }

    await writeProgress('Capturing current image for rollback…')
    const prevImageId = await currentImageId().catch(() => '')

    await writeProgress(`Pulling digest-pinned image ${targetRef}…`)
    await execAsync(`docker pull ${targetRef}`).catch(e => {
      throw new Error(`Image pull failed: ${e instanceof Error ? e.message : String(e)}`)
    })

    if (appImage) {
      await execAsync(`docker tag ${targetRef} ${appImage}`).catch(() => {})
    }

    await writeProgress('Running database migration (new image)…')
    await execAsync(`${dcCmd()} run --rm ${updateService()} npx prisma migrate deploy`).catch(e => {
      throw new Error(`Migration failed: ${e instanceof Error ? e.message : String(e)}`)
    })

    await writeProgress('Recreating container…')
    await execAsync(`${dcCmd()} up -d --no-build ${updateService()}`).catch(e => {
      throw new Error(`Restart failed: ${e instanceof Error ? e.message : String(e)}`)
    })

    await writeProgress('Health gate: waiting for instance to come back healthy…')
    const healthy = await waitForHealth()
    if (!healthy) {
      let rollbackNote = ''
      if (appImage && prevImageId) {
        await execAsync(`docker tag ${prevImageId} ${appImage}`).catch(() => {})
        await execAsync(`${dcCmd()} up -d --no-build ${updateService()}`).catch(() => {})
        rollbackNote = ' Container rolled back to the previous image.'
      }
      updateState = {
        status: 'error',
        progress: '',
        error:
          'Update failed the post-restart health check.' +
          rollbackNote +
          ` A restorable backup was saved at ${backup.path} (restore manually if needed).`,
      }
      await releaseLock()
      return
    }

    await prisma.event
      .create({
        data: {
          eventType: 'SYSTEM',
          entityType: 'Update',
          entityId: 'system',
          payload: {
            action: 'UPDATE_EXECUTED',
            fromVersion: runningVersion(),
            toVersion: targetVersion,
            targetDigest,
            channel: manifest.channel,
            changelogUrl,
            backupCreated: true,
            backupPath: backup.path,
          },
        },
      })
      .catch(() => {})

    updateState = {
      status: 'success',
      progress: '',
      message: `Updated to ${targetVersion}.`,
      backupPath: backup.path,
    }
    await releaseLock()
  } catch (error) {
    updateState = {
      status: 'error',
      progress: '',
      error: error instanceof Error ? error.message : 'Update failed',
    }
    await releaseLock()
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)

  const limited = await rateLimit(request, { keyPrefix: 'admin-update', limit: 10, windowMs: 60_000 })
  if (limited) {
    limited.headers.set('x-request-id', requestId)
    return limited
  }

  const session = await auth()
  if (session?.user?.role !== 'ADMIN') {
    const res = NextResponse.json({ error: 'Admin access required', requestId }, { status: 403 })
    res.headers.set('x-request-id', requestId)
    return res
  }

  const body = await request.json().catch(() => ({}))
  const { action } = body as { action?: string }

  if (action === 'backup-only') {
    const { path, success } = await createFullBackup()
    if (success) {
      return NextResponse.json({ status: 'success', message: 'Backup created', backupPath: path })
    }
    return NextResponse.json({ error: 'Backup failed' }, { status: 500 })
  }

  const appImage = process.env.APP_IMAGE || ''

  // Sidecar mode: the app only backs up, then delegates pull/recreate/health-gate
  // to the isolated updater. The app never holds the Docker socket (docs §6).
  if (SIDEKICK_ENABLED) {
    const s = await sidecarStatus()
    if (s && s.status === 'updating') {
      return NextResponse.json({ error: 'Update already in progress.' }, { status: 409 })
    }
    const manifest = await fetchManifest()
    if (!manifest) {
      return NextResponse.json(
        { error: 'UPDATE_MANIFEST_URL is not configured or unreachable.' },
        { status: 400 }
      )
    }
    const { version: targetVersion, image: imageRepo, digest: targetDigest, minSupportedVersion } = manifest
    if (!targetVersion || !imageRepo || !targetDigest) {
      return NextResponse.json({ error: 'Update manifest is missing version/image/digest.' }, { status: 400 })
    }
    if (!targetDigest.startsWith('sha256:')) {
      return NextResponse.json({ error: 'Manifest digest must be a sha256 digest (sha256:...).' }, { status: 400 })
    }
    if (minSupportedVersion && !versionGte(runningVersion(), minSupportedVersion)) {
      return NextResponse.json(
        {
          error: `Current version ${runningVersion()} is below the minimum supported ${minSupportedVersion}. A manual stepped upgrade is required.`,
        },
        { status: 400 }
      )
    }
    const backup = await createFullBackup()
    if (!backup.success) {
      return NextResponse.json({ error: 'Backup failed - update aborted for safety' }, { status: 500 })
    }
    const kickoffError = await sidecarKickoff(manifest, appImage)
    if (kickoffError) {
      return NextResponse.json({ error: kickoffError }, { status: 500 })
    }
    return NextResponse.json({ status: 'started' })
  }

  if (await isLocked()) {
    return NextResponse.json({ error: 'Update already in progress. Wait or restart the server.' }, { status: 409 })
  }

  if (!await acquireLock()) {
    return NextResponse.json({ error: 'Could not acquire update lock' }, { status: 503 })
  }

  // Kick off the pipeline in the background and return immediately; the client
  // polls GET to show real staged progress (docs §7).
  updateState = { status: 'updating', progress: 'Starting…' }
  void runUpdate()

  return NextResponse.json({ status: 'started' })
}
