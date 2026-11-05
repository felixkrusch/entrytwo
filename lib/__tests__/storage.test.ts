import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeStorage, isStorageReady } from '../storage'

const roots: string[] = []
async function freshRoot() {
  const root = await mkdtemp(join(tmpdir(), 'entrytwo-storage-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('native installation storage', () => {
  it('initializes a fresh installation before it becomes ready', async () => {
    const root = await freshRoot()
    expect(await isStorageReady(root)).toBe(false)
    await initializeStorage(root)
    expect(await isStorageReady(root)).toBe(true)
    await writeFile(join(root, '.data', 'files', 'receipt.txt'), 'retained receipt')
    await initializeStorage(root)
    expect(await readFile(join(root, '.data', 'files', 'receipt.txt'), 'utf8')).toBe('retained receipt')
  })

  it('fails startup rather than hiding an invalid storage path', async () => {
    const root = await freshRoot()
    await writeFile(join(root, '.data'), 'not a directory')
    await expect(initializeStorage(root)).rejects.toThrow()
    expect(await isStorageReady(root)).toBe(false)
  })

  it('does not recreate missing storage while probing readiness', async () => {
    const root = await freshRoot()
    await initializeStorage(root)
    await rm(join(root, '.data', 'files'), { recursive: true })
    expect(await isStorageReady(root)).toBe(false)
    await expect(readFile(join(root, '.data', 'files'))).rejects.toThrow()
  })
})
