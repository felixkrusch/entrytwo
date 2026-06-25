import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } })
    return NextResponse.json({ needsBootstrap: adminCount === 0 })
  } catch {
    // On error, be conservative and do not block the UI in dev
    return NextResponse.json({ needsBootstrap: false })
  }
}
