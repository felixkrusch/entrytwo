'use client'

import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from 'next-auth/react'

export const signIn = async (provider: string, options?: Record<string, unknown>) => {
  return nextAuthSignIn(provider, options)
}

export const signOut = async (options?: Record<string, unknown>) => {
  return nextAuthSignOut(options)
}