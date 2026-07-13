export type ApiAccess = 'public' | 'signed-webhook' | 'bootstrap-only' | 'authenticated' | 'accountant' | 'admin'

export type ApiAccessPolicy = {
  prefix: string
  access: ApiAccess
  description: string
  methods?: string[]
}

// Ordered from most specific to least specific. Unlisted API routes are authenticated by default.
export const API_ACCESS_POLICIES: ApiAccessPolicy[] = [
  { prefix: '/api/auth/', access: 'public', description: 'Auth.js and development authentication entry points' },
  { prefix: '/api/auth/totp/disable', access: 'authenticated', methods: ['POST'], description: 'User disables their own TOTP (requires primary auth)' },
  { prefix: '/api/health', access: 'public', description: 'Process health check' },
  { prefix: '/api/bootstrap/status', access: 'bootstrap-only', description: 'Initial installation status' },
  { prefix: '/api/onboarding', access: 'bootstrap-only', description: 'First-admin setup, closed after bootstrap' },
  { prefix: '/api/invitations/validate', access: 'public', description: 'Validate pending invitation token for unauthenticated invitees' },
  { prefix: '/api/webhooks/stripe', access: 'signed-webhook', description: 'Stripe signature verified in handler' },
  { prefix: '/api/webhooks/paypal', access: 'signed-webhook', description: 'PayPal signature verified in handler' },
  { prefix: '/api/jobs/run', access: 'signed-webhook', methods: ['POST'], description: 'Job runner bearer secret verified in handler' },
  { prefix: '/api/backup/', access: 'admin', description: 'Full financial backup and restore' },
  { prefix: '/api/admin/', access: 'admin', description: 'Administrative operations' },
  { prefix: '/api/users', access: 'admin', description: 'User and role management' },
  { prefix: '/api/settings', access: 'admin', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], description: 'Company settings mutations' },
  { prefix: '/api/settings', access: 'authenticated', methods: ['GET'], description: 'Company settings required by accounting forms' },
  { prefix: '/api/llm-config', access: 'admin', description: 'LLM configuration' },
  { prefix: '/api/bank-feeds', access: 'admin', description: 'Processor connections, imports, and matching' },
  { prefix: '/api/chat', access: 'accountant', description: 'AI accounting actions' },
  { prefix: '/api/accounts', access: 'admin', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], description: 'Chart of accounts mutations' },
  { prefix: '/api/tax-rates', access: 'admin', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], description: 'Tax configuration mutations' },
  { prefix: '/api/journal-entries', access: 'accountant', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], description: 'Journal mutations' },
  { prefix: '/api/accounting/restore', access: 'admin', methods: ['POST'], description: 'Destructive accounting restore' },
  { prefix: '/api/accounting', access: 'accountant', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], description: 'Branch, restore, merge, and reconciliation mutations' },
  { prefix: '/api/invoices', access: 'accountant', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], description: 'Invoice mutations and delivery' },
  { prefix: '/api/contacts', access: 'accountant', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], description: 'Contact mutations' },
  { prefix: '/api/recurring-invoices', access: 'accountant', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], description: 'Recurring invoice mutations' },
  { prefix: '/api/recurring-journal-entries', access: 'accountant', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], description: 'Recurring journal mutations' },
  { prefix: '/api/templates', access: 'accountant', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], description: 'Accounting template mutations' },
  { prefix: '/api/payments/', access: 'accountant', methods: ['POST'], description: 'Payment-link creation' },
  { prefix: '/api/feeds/import', access: 'accountant', methods: ['POST'], description: 'Financial feed imports' },
  { prefix: '/api/verify-suggestion', access: 'accountant', methods: ['POST'], description: 'AI-assisted accounting suggestion checks' },
  { prefix: '/api/receipts', access: 'admin', methods: ['DELETE'], description: 'Legacy receipt deletion' },
  { prefix: '/api/expense-claims', access: 'authenticated', description: 'Ownership and workflow authorization in claim services' },
  { prefix: '/api/files', access: 'authenticated', description: 'Private files with resource-level authorization' },
  { prefix: '/api', access: 'authenticated', description: 'Deny-by-default API fallback' },
]

export function getApiAccessPolicy(pathname: string, method = 'GET'): ApiAccessPolicy {
  const normalizedMethod = method.toUpperCase()
  return API_ACCESS_POLICIES.find(policy =>
    (!policy.methods || policy.methods.includes(normalizedMethod))
    && (pathname === policy.prefix
      || pathname.startsWith(`${policy.prefix}/`)
      || (policy.prefix.endsWith('/') && pathname.startsWith(policy.prefix)))
  ) || { prefix: '/api', access: 'authenticated', description: 'Deny-by-default API fallback' }
}

export function isPublicApiPath(pathname: string, method = 'GET') {
  const access = getApiAccessPolicy(pathname, method).access
  return access === 'public' || access === 'signed-webhook' || access === 'bootstrap-only'
}

export function isRoleAllowed(access: ApiAccess, role: 'ADMIN' | 'ACCOUNTANT' | 'VIEWER') {
  if (access === 'admin') return role === 'ADMIN'
  if (access === 'accountant') return role === 'ADMIN' || role === 'ACCOUNTANT'
  return true
}
