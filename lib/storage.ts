import { constants } from 'node:fs'
import { access, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const directories = ['files', 'backups']
const permissions = constants.R_OK | constants.W_OK | constants.X_OK

export async function initializeStorage(root = process.cwd()) {
  for (const name of directories) {
    const directory = join(root, '.data', name)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await access(directory, permissions)
  }
}

export async function isStorageReady(root = process.cwd()) {
  try {
    for (const name of directories) {
      const directory = join(root, '.data', name)
      if (!(await stat(directory)).isDirectory()) return false
      await access(directory, permissions)
    }
    return true
  } catch {
    return false
  }
}
