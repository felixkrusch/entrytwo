import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { requireUser } from '@/lib/authz'

const updateUserSchema = z.object({
  role: z.enum(['ADMIN', 'ACCOUNTANT', 'VIEWER']),
})

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(['ADMIN'])
  if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const { id } = await context.params
    const body = await request.json()
    const parsed = updateUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const { role } = parsed.data
    if (id === session.user.id && role !== 'ADMIN') return NextResponse.json({ error: 'Administrators cannot demote their own account' }, { status: 409 })

    const user = await prisma.$transaction(async tx => {
      await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_advisory_xact_lock(hashtext('administrator-role-change')) IS NULL AS locked`
      const current = await tx.user.findUnique({ where: { id }, select: { role: true, email: true } })
      if (!current) throw new Error('USER_NOT_FOUND')
      if (current.role === 'ADMIN' && role !== 'ADMIN') {
        const adminCount = await tx.user.count({ where: { role: 'ADMIN' } })
        if (adminCount <= 1) throw new Error('LAST_ADMIN')
      }
      const updated = await tx.user.update({ where: { id }, data: { role } })
      await tx.event.create({
        data: {
          eventType: 'MANUAL_ADJUSTMENT', entityType: 'User', entityId: updated.id,
          payload: { action: 'ROLE_CHANGED', email: updated.email, oldRole: current.role, newRole: role }, createdBy: session.user.id,
        },
      })
      return updated
    })

    return NextResponse.json(user)
  } catch (error) {
    if (error instanceof Error && error.message === 'LAST_ADMIN') return NextResponse.json({ error: 'The last administrator cannot be demoted' }, { status: 409 })
    if (error instanceof Error && error.message === 'USER_NOT_FOUND') return NextResponse.json({ error: 'User not found' }, { status: 404 })
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await requireUser(['ADMIN'])
  if (!session) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const { id } = await context.params
    if (id === session.user.id) return NextResponse.json({ error: 'Administrators cannot delete their own account' }, { status: 409 })
    await prisma.$transaction(async tx => {
      await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_advisory_xact_lock(hashtext('administrator-role-change')) IS NULL AS locked`
      const current = await tx.user.findUnique({ where: { id }, select: { role: true, email: true } })
      if (!current) throw new Error('USER_NOT_FOUND')
      if (current.role === 'ADMIN') {
        const adminCount = await tx.user.count({ where: { role: 'ADMIN' } })
        if (adminCount <= 1) throw new Error('LAST_ADMIN')
      }
      await tx.user.delete({ where: { id } })
      await tx.event.create({
        data: {
          eventType: 'MANUAL_ADJUSTMENT', entityType: 'User', entityId: id,
          payload: { action: 'USER_DELETED', email: current.email, oldRole: current.role }, createdBy: session.user.id,
        },
      })
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'LAST_ADMIN') return NextResponse.json({ error: 'The last administrator cannot be deleted' }, { status: 409 })
    if (error instanceof Error && error.message === 'USER_NOT_FOUND') return NextResponse.json({ error: 'User not found' }, { status: 404 })
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}
