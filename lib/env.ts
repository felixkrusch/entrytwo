import { z } from 'zod'

const productionEnv = z.object({
  DATABASE_URL: z.string().url().refine(value => value.startsWith('postgresql://') || value.startsWith('postgres://'), 'DATABASE_URL must use PostgreSQL'),
  AUTH_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  JOB_RUNNER_SECRET: z.string().min(32),
}).superRefine((env, ctx) => {
  const pairs = [
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
    ['MICROSOFT_ENTRA_ID_ID', 'MICROSOFT_ENTRA_ID_SECRET'], ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
  ] as const
  for (const [left, right] of pairs) if (Boolean(process.env[left]) !== Boolean(process.env[right])) ctx.addIssue({ code: 'custom', path: [left], message: `${left} and ${right} must be configured together` })
})

export function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== 'production') return
  const result = productionEnv.safeParse(process.env)
  if (!result.success) throw new Error(`Invalid production environment: ${result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
}
