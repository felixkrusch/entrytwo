import { NextResponse } from 'next/server'
import {
  isGoogleOAuthConfigured,
  isMicrosoftOAuthConfigured,
  listConfiguredOAuthProviders,
} from '@/lib/auth'
import { isSmtpConfigured } from '@/lib/smtp'

/** Public: which sign-in methods this installation supports (no secrets). */
export async function GET() {
  const magicLink = isSmtpConfigured()
  const google = isGoogleOAuthConfigured()
  const microsoft = isMicrosoftOAuthConfigured()
  const oauth = listConfiguredOAuthProviders()
  const devCredentials = process.env.NODE_ENV !== 'production'

  return NextResponse.json(
    {
      magicLink,
      google,
      microsoft,
      oauth,
      devCredentials,
      // Instant email sign-in is available in non-production (dev cookie path)
      instantEmail: devCredentials,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
