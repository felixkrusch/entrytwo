import { z } from 'zod'
import { isSmtpConfigured } from './smtp'

function isGoogleOAuthConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

function isMicrosoftOAuthConfigured() {
  return !!(process.env.MICROSOFT_ENTRA_ID_ID && process.env.MICROSOFT_ENTRA_ID_SECRET)
}

export function hasProductionAuthMethod() {
  return isSmtpConfigured() || isGoogleOAuthConfigured() || isMicrosoftOAuthConfigured()
}

export function publicAuthBaseUrl() {
  return (
    process.env.AUTH_URL ||
    process.env.APP_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    ''
  ).replace(/\/$/, '')
}

const productionEnv = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      value => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must use PostgreSQL',
    ),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, 'ENCRYPTION_KEY must be 64 hex chars'),
  JOB_RUNNER_SECRET: z.string().min(32),
}).superRefine((_env, ctx) => {
  const pairs = [
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    ['MICROSOFT_ENTRA_ID_ID', 'MICROSOFT_ENTRA_ID_SECRET'],
    ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
  ] as const

  const smtp = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const
  const smtpSet = smtp.filter(key => Boolean(process.env[key]))
  if (smtpSet.length > 0 && smtpSet.length < smtp.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['SMTP_HOST'],
      message: 'SMTP_HOST, SMTP_USER, and SMTP_PASS must be configured together for magic links',
    })
  }

  for (const [left, right] of pairs) {
    if (Boolean(process.env[left]) !== Boolean(process.env[right])) {
      ctx.addIssue({
        code: 'custom',
        path: [left],
        message: `${left} and ${right} must be configured together`,
      })
    }
  }

  if (!hasProductionAuthMethod()) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH'],
      message:
        'Configure at least one production sign-in method: full SMTP (magic link) and/or Google OAuth and/or Microsoft Entra ID',
    })
  }

  const base = publicAuthBaseUrl()
  if (!base) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_URL'],
      message: 'AUTH_URL or APP_PUBLIC_URL is required in production (public https origin)',
    })
  } else {
    let parsed: URL | null = null
    try {
      parsed = new URL(base)
    } catch {
      ctx.addIssue({ code: 'custom', path: ['AUTH_URL'], message: 'AUTH_URL must be a valid URL' })
    }
    if (parsed) {
      const allowHttp = process.env.AUTH_ALLOW_HTTP === 'true'
      if (parsed.protocol !== 'https:' && !allowHttp) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_URL'],
          message: 'AUTH_URL must use https in production (set AUTH_ALLOW_HTTP=true only for lab installs)',
        })
      }
    }
  }

  if (process.env.AUTH_TRUST_HOST !== 'true') {
    // Warn-level via issue only when behind typical reverse proxies without explicit trust
    // We require explicit true so operators opt in to host header trust.
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_TRUST_HOST'],
      message: 'AUTH_TRUST_HOST must be "true" in production behind a reverse proxy (nginx/caddy/traefik)',
    })
  }
})

export function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== 'production') return
  const result = productionEnv.safeParse(process.env)
  if (!result.success) {
    throw new Error(
      `Invalid production environment: ${result.error.issues.map(issue => `${issue.path.join('.') || 'env'}: ${issue.message}`).join('; ')}`,
    )
  }
}

/** Non-throwing readiness snapshot for /api/health (prod and dev). */
export function authReadiness() {
  const base = publicAuthBaseUrl()
  return {
    smtp: isSmtpConfigured(),
    google: isGoogleOAuthConfigured(),
    microsoft: isMicrosoftOAuthConfigured(),
    hasAuthMethod: hasProductionAuthMethod() || process.env.NODE_ENV !== 'production',
    publicUrlConfigured: !!base,
    publicUrl: base || null,
    authSecretConfigured: !!(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32),
    trustHost: process.env.AUTH_TRUST_HOST === 'true' || process.env.NODE_ENV !== 'production',
    productionReady:
      process.env.NODE_ENV !== 'production'
        ? false
        : hasProductionAuthMethod() &&
          !!base &&
          !!(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32) &&
          process.env.AUTH_TRUST_HOST === 'true',
  }
}
