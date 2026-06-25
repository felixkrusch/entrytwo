import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } })
    return NextResponse.json({ isAdmin: adminCount > 0 })
  } catch {
    // If we can't determine, be conservative and hide admin UI
    return NextResponse.json({ isAdmin: false })
  }
}
