import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  INVITATION_EMAIL_JOB_TYPE,
  INVITATION_EMAIL_KEY_PREFIX,
  buildInviteLink,
  hashInvitationToken,
  invitationDeliveryDecision,
  invitationEmailIdempotencyKey,
  invitationIdFromDeliveryKey,
  latestDeliveryByInvitation,
  queueInvitationEmail,
} from '@/lib/invitationDelivery'

const root = process.cwd()
const smtpKeys = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const
const smtpSnapshot = Object.fromEntries(smtpKeys.map(key => [key, process.env[key]]))
const urlSnapshot = {
  AUTH_URL: process.env.AUTH_URL,
  APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
}

afterEach(() => {
  for (const key of smtpKeys) {
    if (smtpSnapshot[key] === undefined) delete process.env[key]
    else process.env[key] = smtpSnapshot[key]
  }
  for (const [key, value] of Object.entries(urlSnapshot)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function setSmtp(configured: boolean) {
  if (configured) {
    process.env.SMTP_HOST = 'smtp.test'
    process.env.SMTP_USER = 'user'
    process.env.SMTP_PASS = 'pass'
    return
  }
  delete process.env.SMTP_HOST
  delete process.env.SMTP_USER
  delete process.env.SMTP_PASS
}

describe('invitation delivery keys', () => {
  it('parses legacy and per-send idempotency keys', () => {
    expect(invitationIdFromDeliveryKey('invitation-email:inv-1')).toBe('inv-1')
    expect(invitationIdFromDeliveryKey('invitation-email:inv-1:abc')).toBe('inv-1')
    expect(invitationIdFromDeliveryKey('invoice-email:inv-1')).toBeNull()
  })

  it('issues a unique key per enqueue so regeneration is not dropped', () => {
    const first = invitationEmailIdempotencyKey('inv-1')
    const second = invitationEmailIdempotencyKey('inv-1')
    expect(first).toMatch(/^invitation-email:inv-1:/)
    expect(second).toMatch(/^invitation-email:inv-1:/)
    expect(first).not.toBe(second)
  })

  it('keeps the newest job when keys are ordered newest first', () => {
    const jobs = [
      { idempotencyKey: 'invitation-email:inv-1:new', status: 'PENDING' },
      { idempotencyKey: 'invitation-email:inv-1', status: 'SUCCEEDED' },
      { idempotencyKey: 'invitation-email:inv-2:only', status: 'RETRY' },
    ]
    const latest = latestDeliveryByInvitation(jobs)
    expect(latest.get('inv-1')?.status).toBe('PENDING')
    expect(latest.get('inv-2')?.status).toBe('RETRY')
  })
})

describe('invitationDeliveryDecision', () => {
  const token = 'fresh-token'
  const invitation = {
    email: 'Ada@Example.com',
    tokenHash: hashInvitationToken(token),
    acceptedAt: null,
    expiresAt: new Date('2026-12-01T00:00:00Z'),
  }

  it('sends only when the token is current, unexpired, and unaccepted', () => {
    expect(invitationDeliveryDecision(invitation, {
      email: 'ada@example.com',
      token,
      now: new Date('2026-11-01T00:00:00Z'),
    })).toBe('send')
  })

  it('skips stale tokens after regeneration instead of emailing the old link', () => {
    expect(invitationDeliveryDecision(invitation, {
      email: 'ada@example.com',
      token: 'old-token',
      now: new Date('2026-11-01T00:00:00Z'),
    })).toBe('stale_token')
  })

  it('skips accepted, expired, mismatched, and missing invitations', () => {
    expect(invitationDeliveryDecision(null, { email: 'ada@example.com', token })).toBe('inactive')
    expect(invitationDeliveryDecision({ ...invitation, acceptedAt: new Date('2026-11-02T00:00:00Z') }, {
      email: 'ada@example.com',
      token,
      now: new Date('2026-11-03T00:00:00Z'),
    })).toBe('inactive')
    expect(invitationDeliveryDecision(invitation, {
      email: 'ada@example.com',
      token,
      now: new Date('2026-12-01T00:00:00Z'),
    })).toBe('expired')
    expect(invitationDeliveryDecision(invitation, {
      email: 'other@example.com',
      token,
      now: new Date('2026-11-01T00:00:00Z'),
    })).toBe('email_mismatch')
  })
})

describe('buildInviteLink', () => {
  it('prefers AUTH_URL over APP_PUBLIC_URL so Docker internal hosts are not mailed', () => {
    process.env.AUTH_URL = 'https://books.example.com'
    process.env.APP_PUBLIC_URL = 'http://app:3000'
    expect(buildInviteLink('tok')).toBe('https://books.example.com/auth/invite?token=tok')
  })
})

describe('queueInvitationEmail', () => {
  it('does not enqueue when SMTP is incomplete', async () => {
    setSmtp(false)
    process.env.SMTP_HOST = 'smtp.test'
    const enqueue = vi.fn()
    await expect(queueInvitationEmail(enqueue, {
      invitationId: 'inv-1',
      email: 'ada@example.com',
      token: 'tok',
      expiresAt: '2026-12-01T00:00:00.000Z',
    })).resolves.toBeNull()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('enqueues a unique EMAIL_INVITATION job when SMTP is configured', async () => {
    setSmtp(true)
    const enqueue = vi.fn(async () => ({ id: 'job-1' }))
    const payload = {
      invitationId: 'inv-1',
      email: 'ada@example.com',
      token: 'tok',
      expiresAt: '2026-12-01T00:00:00.000Z',
    }
    await expect(queueInvitationEmail(enqueue, payload)).resolves.toBe('job-1')
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(
      INVITATION_EMAIL_JOB_TYPE,
      expect.stringMatching(/^invitation-email:inv-1:/),
      payload,
    )
  })

  it('returns null when enqueue fails so the invitation API can still return inviteLink', async () => {
    setSmtp(true)
    const enqueue = vi.fn(async () => {
      throw new Error('db unavailable')
    })
    await expect(queueInvitationEmail(enqueue, {
      invitationId: 'inv-1',
      email: 'ada@example.com',
      token: 'tok',
      expiresAt: '2026-12-01T00:00:00.000Z',
    })).resolves.toBeNull()
  })
})

describe('invitation queue wiring', () => {
  it('keeps GET /api/users on adminUserFields and routes invite mail through the helper', () => {
    const users = readFileSync(join(root, 'app/api/users/route.ts'), 'utf8')
    expect(users).toContain('select: adminUserFields')
    expect(users).toContain('queueInvitationEmail')
    expect(users).toContain('buildInviteLink')
    expect(users).not.toMatch(/enqueueJob\('EMAIL_INVITATION'/)
    expect(users).not.toMatch(/token: process\.env\.SMTP_HOST/)

    const link = readFileSync(join(root, 'app/api/users/invitations/[id]/link/route.ts'), 'utf8')
    expect(link).toContain('queueInvitationEmail')
    expect(link).not.toMatch(/invitation-email:\$\{id\}`/)

    const list = readFileSync(join(root, 'app/api/users/invitations/route.ts'), 'utf8')
    expect(list).toContain('latestDeliveryByInvitation')
    expect(list).toContain("orderBy: { createdAt: 'desc' }")

    const handlers = readFileSync(join(root, 'lib/jobHandlers.ts'), 'utf8')
    expect(handlers).toContain('deliverInvitationEmail')
    expect(handlers).not.toMatch(/return sendInvitationEmail/)
  })
})
