import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { logger } from '@/lib/logger'

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function levenshtein(a: string, b: string): number {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i])
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

interface ContactCandidate {
  name: string
  email?: string | null
  taxId?: string | null
  type?: string
}

function calculateMatchScore(
  candidate: ContactCandidate,
  queryName: string,
  queryType?: string
): number {
  const candidateName = normalizeName(candidate.name)
  const queryNameNorm = normalizeName(queryName)

  // Exact match: 1.0
  if (candidateName === queryNameNorm) return 1.0

  // Normalized match (case/punctuation): 0.9
  if (candidate.name.toLowerCase() === queryName.toLowerCase()) return 0.9

  // Contains match: 0.7
  if (candidateName.includes(queryNameNorm) || queryNameNorm.includes(candidateName)) return 0.7

  // Levenshtein distance < 3: 0.6
  if (levenshtein(candidateName, queryNameNorm) <= 3) return 0.6

  // Type match bonus: 0.1
  const typeBonus = candidate.type === queryType ? 0.1 : 0

  // Email domain match (if both have email): 0.3
  let emailScore = 0
  if (candidate.email && candidate.email.includes('@') && queryNameNorm.includes('@')) {
    const candDomain = candidate.email.split('@')[1]
    if (queryNameNorm.includes('@') && queryNameNorm.split('@')[1]?.includes(candDomain)) {
      emailScore = 0.3
    }
  }

  return typeBonus + emailScore
}

export async function GET(request: Request) {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const url = new URL(request.url)
    const name = url.searchParams.get('name')
    const type = url.searchParams.get('type') || ''
    const minConfidence = parseFloat(url.searchParams.get('minConfidence') || '0.8')

    if (!name) {
      return NextResponse.json({ error: 'name parameter required' }, { status: 400 })
    }

    const contacts = await prisma.contact.findMany({
      where: type ? { type } : {},
    })

    const matches = contacts
      .map(c => ({
        contact: c,
        score: calculateMatchScore(c, name, type || undefined),
      }))
      .filter(m => m.score >= minConfidence)
      .sort((a, b) => b.score - a.score)

    return NextResponse.json({
      matches,
      exactMatch: matches.find(m => m.score >= 0.9) || null,
    })
  } catch (error) {
    logger.error('Error searching contacts', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to search contacts' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const body = await request.json()
    const { name, type } = body

    if (!name || !type) {
      return NextResponse.json({ error: 'name and type required' }, { status: 400 })
    }

    const existing = await prisma.contact.findFirst({
      where: {
        type,
        OR: [
          { name: { contains: name, mode: 'insensitive' } },
          { email: { contains: name, mode: 'insensitive' } },
        ],
      },
    })

    if (existing) {
      return NextResponse.json({ contact: existing, created: false })
    }

    const contact = await prisma.contact.create({
      data: { name, type },
    })

    return NextResponse.json({ contact, created: true })
  } catch (error) {
    logger.error('Error in lookup-or-create', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to lookup/create contact' }, { status: 500 })
  }
}
