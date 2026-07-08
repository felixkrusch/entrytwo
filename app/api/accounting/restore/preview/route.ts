import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBranch } from '@/lib/accounting/branch'
import { replayToPoint, type ReconstructedState } from '@/lib/accounting/replay'

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
    const emptyBalances: ReconstructedState['balances'] = {}
    const currentState: ReconstructedState = currentHead ? await replayToPoint(currentHead).catch(() => ({ balances: emptyBalances })) : { balances: emptyBalances }
    const targetState: ReconstructedState = targetEventId ? await replayToPoint(targetEventId).catch(() => ({ balances: emptyBalances })) : { balances: emptyBalances }

    const accounts = Object.keys({ ...currentState.balances, ...targetState.balances })
    const preview = accounts.map(code => {
      const curVal = currentState.balances[code]
      const cur = curVal ? (typeof curVal === 'object' && 'base' in curVal ? curVal.base : curVal) : 0
      const tgtVal = targetState.balances[code]
      const tgt = tgtVal ? (typeof tgtVal === 'object' && 'base' in tgtVal ? tgtVal.base : tgtVal) : 0
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg || 'Preview failed' }, { status: 400 })
  }
}
