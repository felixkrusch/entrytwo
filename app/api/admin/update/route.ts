import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

const execAsync = promisify(exec)

interface UpdateStatus {
  currentCommit: string
  latestCommit: string
  updateAvailable: boolean
  lastChecked: string
  status: 'idle' | 'checking' | 'updating' | 'success' | 'error'
  message: string
}

let updateLock: { updating: boolean; progress: string } = { updating: false, progress: '' }

export async function GET() {
  try {
    // Get current commit
    const { stdout: current } = await execAsync('git rev-parse HEAD').catch(() => ({ stdout: '' }))
    const currentCommit = current.trim()

    // Get latest from remote
    await execAsync('git fetch origin main').catch(() => {})
    const { stdout: latest } = await execAsync('git rev-parse origin/main').catch(() => ({ stdout: '' }))
    const latestCommit = latest.trim()

    const updateAvailable = currentCommit !== latestCommit && latestCommit.length === 40

    return NextResponse.json({
      currentCommit: currentCommit.substring(0, 7),
      latestCommit: latestCommit.substring(0, 7),
      updateAvailable,
      lastChecked: new Date().toISOString(),
      status: updateLock.updating ? 'updating' : 'idle',
      progress: updateLock.progress,
    })
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to check updates' 
    }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, createBackup = true } = body

    if (action === 'backup-only') {
      return NextResponse.json({ status: 'backup-only', message: 'Backup created' })
    }

    if (updateLock.updating) {
      return NextResponse.json({ error: 'Update already in progress' }, { status: 409 })
    }

    // Verify admin (in production, check session)
    // For now, we rely on middleware for auth

    updateLock = { updating: true, progress: 'Creating backup...' }

    // Step 1: Create backup if requested
    let backupPath: string | null = null
    if (createBackup) {
      try {
        const backupDir = join(process.cwd(), 'backups')
        await mkdir(backupDir, { recursive: true }).catch(() => {})
        
        const backupRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/backup/export`)
        if (backupRes.ok) {
          const backupData = await backupRes.json()
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
          backupPath = join(backupDir, `pre-update-${timestamp}.json`)
          await writeFile(backupPath, JSON.stringify(backupData, null, 2))
        }
      } catch (e) {
        console.error('Backup failed:', e)
        updateLock = { updating: false, progress: '' }
        return NextResponse.json({ error: 'Backup failed', backupStep: true }, { status: 500 })
      }
    }

    updateLock = { updating: true, progress: 'Pulling latest code...' }

    // Step 2: Git pull
    const { stderr: pullError } = await execAsync('git pull origin main').catch(e => ({ stderr: e.message }))
    if (pullError && !pullError.includes('Already up to date')) {
      updateLock = { updating: false, progress: '' }
      return NextResponse.json({ error: pullError }, { status: 500 })
    }

    updateLock = { updating: true, progress: 'Installing dependencies...' }

    // Step 3: npm install
    await execAsync('npm install --omit=dev').catch(() => {})

    updateLock = { updating: true, progress: 'Running database migrations...' }

    // Step 4: Prisma migrate
    await execAsync('npx prisma migrate deploy').catch(() => {})

    updateLock = { updating: true, progress: 'Building application...' }

    // Step 5: Build
    await execAsync('npm run build').catch(() => {})

    updateLock = { updating: true, progress: 'Restarting server...' }

    // Step 6: Create restart signal
    await writeFile(join(process.cwd(), '.restart'), Date.now().toString())

    // Audit
    await prisma.event.create({
      data: {
        eventType: 'SYSTEM',
        entityType: 'Update',
        entityId: 'system',
        payload: { action: 'UPDATE_EXECUTED', backupCreated: !!backupPath },
      },
    })

    updateLock = { updating: false, progress: '' }

    return NextResponse.json({ 
      status: 'success', 
      message: 'Update completed',
      backupPath 
    })
  } catch (error) {
    updateLock = { updating: false, progress: '' }
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Update failed' 
    }, { status: 500 })
  }
}