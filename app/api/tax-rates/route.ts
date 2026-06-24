import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const rates = await prisma.taxRate.findMany({
    orderBy: [{ jurisdiction: 'asc' }, { rate: 'desc' }],
  })
  return NextResponse.json(rates)
}
