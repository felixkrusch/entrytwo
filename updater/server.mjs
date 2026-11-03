// Entrytwo updater sidecar.
//
// Isolated, least-privilege component that performs the Docker operations the
// app must never do itself (pull signed image, migrate, recreate, health gate,
// rollback). The app only triggers it over HTTP with a shared token. See
// docs/Self-Hosted-Update-Delivery.md §6.
//
// No framework, no database access — minimal attack surface.

import { createServer } from 'node:http'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const execAsync = promisify(exec)

const PORT = Number(process.env.UPDATER_PORT || 4000)
const TOKEN = process.env.UPDATER_TOKEN || ''
const LOCK_FILE = join(tmpdir(), 'entrytwo-updater.lock')

/** @type {{ status: 'idle'|'updating'|'success'|'error', progress: string, error?: string, message?: string }} */
let state = { status: 'idle', progress: '' }

async function setProgress(progress) {
  state.progress = progress
  try { await writeFile(LOCK_FILE, String(Date.now())) } catch {}
}
async function isLocked() {
  try { await readFile(LOCK_FILE, 'utf8'); return true } catch { return false }
}
async function releaseLock() {
  try { await unlink(LOCK_FILE) } catch {}
}

function composeCmd(composeFile, service) {
  return `docker compose -f "${composeFile}"`
}

async function verifyImageSignature(ref) {
  const identity = process.env.COSIGN_IDENTITY
  const issuer = process.env.COSIGN_OIDC_ISSUER || 'https://token.actions.githubusercontent.com'
  const publicKey = process.env.COSIGN_PUBLIC_KEY
  const extra = process.env.COSIGN_VERIFY_ARGS || ''

  let cmd = 'cosign verify'
  if (publicKey) cmd += ` --key ${publicKey}`
  else if (identity) cmd += ` --certificate-identity-regexp '${identity}' --certificate-oidc-issuer ${issuer}`
  else throw new Error('Signature verification enabled but no COSIGN_IDENTITY/COSIGN_PUBLIC_KEY configured.')
  if (extra) cmd += ` ${extra}`
  cmd += ` ${ref}`
  await execAsync(cmd).catch(e => {
    throw new Error(`Signature verification failed: ${e instanceof Error ? e.message : String(e)}`)
  })
}

async function currentImageId(service, composeFile) {
  const { stdout } = await execAsync(`${composeCmd(composeFile, service)} ps -q ${service}`)
  const cid = stdout.trim().split('\n')[0]
  if (!cid) return ''
  const { stdout: img } = await execAsync(`docker inspect -f '{{.Image}}' ${cid}`)
  return img.trim()
}

async function waitForHealth(appHealthUrl, maxAttempts = 20, intervalMs = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(appHealthUrl, { cache: 'no-store' })
      if (res.ok) {
        const j = await res.json().catch(() => ({}))
        if (j.status === 'ok' && j.database === 'connected') return true
      }
    } catch {}
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

async function runUpdate(job) {
  const { manifest, appImage, service, composeFile, appHealthUrl } = job
  const services = [service, process.env.UPDATE_WORKER_SERVICE].filter(Boolean).join(' ')
  try {
    await setProgress('Verifying signature…')
    if (process.env.UPDATE_VERIFY_SIGNATURE !== 'false') {
      await verifyImageSignature(`${manifest.image}@${manifest.digest}`)
    }

    await setProgress('Capturing current image for rollback…')
    const prevImageId = await currentImageId(service, composeFile).catch(() => '')

    await setProgress(`Pulling ${manifest.image}@${manifest.digest}…`)
    await execAsync(`docker pull ${manifest.image}@${manifest.digest}`).catch(e => {
      throw new Error(`Image pull failed: ${e instanceof Error ? e.message : String(e)}`)
    })

    if (appImage) {
      await execAsync(`docker tag ${manifest.image}@${manifest.digest} ${appImage}`).catch(() => {})
    }

    await setProgress('Running database migration…')
    await execAsync(`${composeCmd(composeFile, service)} run --rm --no-deps --entrypoint npx ${service} prisma migrate deploy`).catch(e => {
      throw new Error(`Migration failed: ${e instanceof Error ? e.message : String(e)}`)
    })

    await setProgress('Recreating container…')
    await execAsync(`${composeCmd(composeFile, service)} up -d --no-build --no-deps ${services}`).catch(e => {
      throw new Error(`Restart failed: ${e instanceof Error ? e.message : String(e)}`)
    })

    await setProgress('Health gate…')
    const healthy = await waitForHealth(appHealthUrl)
    if (!healthy) {
      if (appImage && prevImageId) {
        await execAsync(`docker tag ${prevImageId} ${appImage}`).catch(() => {})
        await execAsync(`${composeCmd(composeFile, service)} up -d --no-build --no-deps ${services}`).catch(() => {})
      }
      throw new Error('Post-restart health check failed; container rolled back to previous image.')
    }

    state = { status: 'success', progress: '', message: `Updated to ${manifest.version}.` }
    await releaseLock()
  } catch (e) {
    state = { status: 'error', progress: '', error: e instanceof Error ? e.message : String(e) }
    await releaseLock()
  }
}

const server = createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(obj))
  }

  if (req.method === 'GET' && req.url === '/health') return send(200, { status: 'ok' })

  if (req.method === 'GET' && req.url === '/status') {
    const locked = await isLocked().catch(() => false)
    return send(200, { ...state, running: locked || state.status === 'updating' })
  }

  if (req.method === 'POST' && req.url === '/update') {
    const auth = req.headers['x-updater-token']
    if (!TOKEN || auth !== TOKEN) return send(401, { error: 'unauthorized' })
    if (state.status === 'updating') return send(409, { error: 'update in progress' })
    if (await isLocked()) return send(409, { error: 'update in progress' })

    let body = ''
    for await (const chunk of req) body += chunk
    let job
    try { job = JSON.parse(body) } catch { return send(400, { error: 'invalid json' }) }

    const { manifest, appImage, service, composeFile, appHealthUrl } = job
    if (!manifest?.version || !manifest?.image || !manifest?.digest) {
      return send(400, { error: 'manifest requires version, image, digest' })
    }
    if (!manifest.digest.startsWith('sha256:')) {
      return send(400, { error: 'digest must be sha256:' })
    }

    await writeFile(LOCK_FILE, String(Date.now()))
    state = { status: 'updating', progress: 'Starting…' }
    void runUpdate({ manifest, appImage, service, composeFile, appHealthUrl })
    return send(202, { status: 'started' })
  }

  send(404, { error: 'not found' })
})

server.listen(PORT, () => console.log(`entrytwo updater sidecar listening on :${PORT}`))
