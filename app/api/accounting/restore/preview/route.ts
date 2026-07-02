import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBranch } from '@/lib/accounting/branch'
import { replayToPoint } from '@/lib/accounting/replay'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const branchName = url.searchParams.get('branch') || 'main'
    const toEventId = url.searchParams.get('toEventId')
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('asof')

    const branch = await getBranch(branchName)
    if (!branch) return NextResponse.json({ error: 'Branch not found' }, { status: 404 })

    let targetEventId = toEventId
    if (!targetEventId && asOf) {
      const ev = await prisma.event.findFirst({
        where: { createdAt: { lte: new Date(asOf) } },
        orderBy: { createdAt: 'desc' }
      })
      if (ev) targetEventId = ev.id
    }
    if (!targetEventId) targetEventId = branch.headEventId || ''

    // Compute current balances vs target point balances for preview
    const currentHead = branch.headEventId || ''
    const currentState = currentHead ? await replayToPoint(currentHead).catch(() => ({ balances: {} as any })) : { balances: {} as any }
    const targetState = targetEventId ? await replayToPoint(targetEventId).catch(() => ({ balances: {} as any })) : { balances: {} as any }

    const accounts = Object.keys({ ...currentState.balances, ...targetState.balances })
    const preview = accounts.map(code => {
      const cur = currentState.balances[code] ? (currentState.balances[code].base ?? currentState.balances[code]) : 0
      const tgt = targetState.balances[code] ? (targetState.balances[code].base ?? targetState.balances[code]) : 0
      return {
        accountCode: code,
        current: Number(cur) || 0,
        target: Number(tgt) || 0,
        delta: (Number(tgt) || 0) - (Number(cur) || 0)
      }
    })

    return NextResponse.json({
      branch: branchName,
      fromHead: branch.headEventId,
      toEventId: targetEventId,
      preview
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Preview failed' }, { status: 400 })
  }
}
