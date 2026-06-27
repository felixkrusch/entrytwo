import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir, readFile, unlink } from 'fs/promises'
import { join } from 'path'

const execAsync = promisify(exec)

const LOCK_FILE = join(process.cwd(), '.update-lock')
const RESTART_FILE = join(process.cwd(), '.restart')

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

export async function GET() {
  try {
    const { stdout: current } = await execAsync('git rev-parse HEAD').catch(() => ({ stdout: '' }))
    const currentCommit = current.trim()

    await execAsync('git fetch origin main').catch(() => {})
    const { stdout: latest } = await execAsync('git rev-parse origin/main').catch(() => ({ stdout: '' }))
    const latestCommit = latest.trim()

    const updateAvailable = currentCommit !== latestCommit && latestCommit.length === 40
    const updating = await isLocked()

    return NextResponse.json({
      currentCommit: currentCommit.substring(0, 7),
      latestCommit: latestCommit.substring(0, 7),
      updateAvailable,
      lastChecked: new Date().toISOString(),
      status: updating ? 'updating' : 'idle',
      progress: updating ? 'Update in progress on server' : '',
    })
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to check updates' 
    }, { status: 500 })
  }
}

async function createBackup(): Promise<{ path: string; success: boolean }> {
  try {
    const backupDir = join(process.cwd(), 'backups')
    await mkdir(backupDir, { recursive: true })
    
    // Direct DB export for reliability during update
    const accounts = await prisma.account.findMany()
    const journalEntries = await prisma.journalEntry.findMany({ include: { lines: true } })
    const taxRates = await prisma.taxRate.findMany()
    const settings = await prisma.setting.findMany()
    const templates = await prisma.template.findMany()
    const users = await prisma.user.findMany({ select: { email: true, name: true, role: true, createdAt: true } })
    
    const backupData = {
      exportedAt: new Date().toISOString(),
      accounts,
      journalEntries,
      taxRates,
      settings,
      templates,
      users,
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = join(backupDir, `pre-update-${timestamp}.json`)
    await writeFile(path, JSON.stringify(backupData, null, 2))
    
    return { path, success: true }
  } catch (e) {
    console.error('Backup failed:', e)
    return { path: '', success: false }
  }
}

export async function POST(request: Request) {
  const body = await request.json()
  const { action, createBackup = true } = body

  if (action === 'backup-only') {
    const { path, success } = await createBackup()
    if (success) {
      return NextResponse.json({ status: 'success', message: 'Backup created', backupPath: path })
    }
    return NextResponse.json({ error: 'Backup failed' }, { status: 500 })
  }

  if (await isLocked()) {
    return NextResponse.json({ error: 'Update already in progress. Wait or restart the server.' }, { status: 409 })
  }

  if (!await acquireLock()) {
    return NextResponse.json({ error: 'Could not acquire update lock' }, { status: 503 })
  }

  try {
    await writeFile(LOCK_FILE, JSON.stringify({ 
      pid: process.pid, 
      started: Date.now(),
      progress: 'Creating backup...' 
    }))

    let backupPath = ''
    if (createBackup) {
      const backup = await createBackup()
      if (!backup.success) {
        await releaseLock()
        return NextResponse.json({ error: 'Backup failed - update aborted for safety' }, { status: 500 })
      }
      backupPath = backup.path
    }

    await writeFile(LOCK_FILE, JSON.stringify({ 
      pid: process.pid, 
      started: Date.now(),
      progress: 'Pulling latest code...' 
    }))

    // Git pull
    const { stderr: pullError } = await execAsync('git pull origin main').catch(e => ({ stderr: e.message }))
    if (pullError && !pullError.includes('Already up to date') && !pullError.includes('up to date')) {
      await releaseLock()
      return NextResponse.json({ error: `Git pull failed: ${pullError}` }, { status: 500 })
    }

    await writeFile(LOCK_FILE, JSON.stringify({ 
      pid: process.pid, 
      started: Date.now(),
      progress: 'Installing dependencies...' 
    }))

    // npm install
    await execAsync('npm install --omit=dev').catch(() => {})

    await writeFile(LOCK_FILE, JSON.stringify({ 
      pid: process.pid, 
      started: Date.now(),
      progress: 'Running database migrations...' 
    }))

    // Prisma migrate - production safe
    await execAsync('npx prisma migrate deploy').catch(() => {})

    await writeFile(LOCK_FILE, JSON.stringify({ 
      pid: process.pid, 
      started: Date.now(),
      progress: 'Building application...' 
    }))

    // Build
    await execAsync('npm run build').catch(() => {})

    await writeFile(LOCK_FILE, JSON.stringify({ 
      pid: process.pid, 
      started: Date.now(),
      progress: 'Restarting server...' 
    }))

    // Signal restart
    await writeFile(RESTART_FILE, Date.now().toString())

    // Audit
    await prisma.event.create({
      data: {
        eventType: 'SYSTEM',
        entityType: 'Update',
        entityId: 'system',
        payload: { action: 'UPDATE_EXECUTED', backupCreated: !!backupPath },
      },
    })

    await releaseLock()

    return NextResponse.json({ 
      status: 'success', 
      message: 'Update completed. Server restart signaled.',
      backupPath 
    })
  } catch (error) {
    await releaseLock()
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Update failed' 
    }, { status: 500 })
  }
}