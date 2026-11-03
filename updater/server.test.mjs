import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

async function fixture(t, { failVerify = false, failMigration = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'entrytwo-updater-test-'))
  const log = join(dir, 'commands.jsonl')
  const health = createServer((_req, res) => {
    res.end(JSON.stringify({ status: 'ok', database: 'connected' }))
  })
  health.listen(0, '127.0.0.1')
  await once(health, 'listening')
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const mock = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify([require('node:path').basename(process.argv[1]), ...args]) + '\\n');
if (process.argv[1].endsWith('cosign') && process.env.FAIL_VERIFY === 'true') process.exit(1);
if (args.includes('run') && process.env.FAIL_MIGRATION === 'true') process.exit(1);
if (args.includes('ps')) console.log('container-id');
if (args.includes('inspect')) console.log('sha256:previous');
`
  await writeFile(join(dir, 'docker'), mock, { mode: 0o755 })
  await writeFile(join(dir, 'cosign'), mock, { mode: 0o755 })
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      TMPDIR: dir,
      UPDATER_PORT: String(port),
      UPDATER_TOKEN: 'test-token',
      UPDATE_VERIFY_SIGNATURE: 'true',
      COSIGN_PUBLIC_KEY: '',
      COSIGN_VERIFY_ARGS: '',
      COSIGN_IDENTITY: '^https://github\\.com/felixkrusch/entrytwo/\\.github/workflows/release\\.yml@refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+$',
      UPDATE_WORKER_SERVICE: 'worker',
      COMMAND_LOG: log,
      FAIL_VERIFY: String(failVerify),
      FAIL_MIGRATION: String(failMigration),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    health.closeAllConnections()
    await new Promise(resolve => health.close(resolve))
    await rm(dir, { recursive: true, force: true })
  })
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code]) => { throw new Error(`Sidecar exited before startup: ${code}`) }),
  ])
  const base = `http://127.0.0.1:${port}`
  const job = {
    manifest: { version: '1.2.3', image: 'ghcr.io/felixkrusch/entrytwo', digest: `sha256:${'a'.repeat(64)}` },
    appImage: 'ghcr.io/felixkrusch/entrytwo:latest',
    service: 'app',
    composeFile: '/host/install path/compose.yaml',
    appHealthUrl: `http://127.0.0.1:${health.address().port}/api/health`,
  }
  return {
    base,
    start: token => fetch(`${base}/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-updater-token': token },
      body: JSON.stringify(job),
    }),
    commands: async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)),
    finish: async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = await (await fetch(`${base}/status`)).json()
        if (state.status === 'success' || state.status === 'error') return state
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      throw new Error('Updater did not finish')
    },
  }
}

test('sidecar requires authentication', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  assert.equal((await fetch(`${f.base}/health`)).status, 200)
  assert.equal((await f.start('wrong-token')).status, 401)
})

test('verified updates migrate with an explicit entrypoint and restart app plus worker only', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  assert.equal((await f.start('test-token')).status, 202)
  assert.equal((await f.finish()).status, 'success')
  const commands = await f.commands()
  assert.equal(commands[0][0], 'cosign')
  const migration = commands.find(args => args.includes('run'))
  assert.deepEqual(migration.slice(1), [
    'compose', '-f', '/host/install path/compose.yaml', 'run', '--rm', '--no-deps',
    '--entrypoint', 'npx', 'app', 'prisma', 'migrate', 'deploy',
  ])
  const restart = commands.find(args => args.includes('up'))
  assert.deepEqual(restart.slice(-5), ['-d', '--no-build', '--no-deps', 'app', 'worker'])
})

test('signature verification failure prevents Docker operations', { timeout: 10000 }, async t => {
  const f = await fixture(t, { failVerify: true })
  assert.equal((await f.start('test-token')).status, 202)
  assert.match((await f.finish()).error, /Signature verification failed/)
  assert.deepEqual((await f.commands()).map(args => args[0]), ['cosign'])
})

test('migration failure prevents container recreation', { timeout: 10000 }, async t => {
  const f = await fixture(t, { failMigration: true })
  assert.equal((await f.start('test-token')).status, 202)
  assert.match((await f.finish()).error, /Migration failed/)
  assert.equal((await f.commands()).some(args => args.includes('up')), false)
})
