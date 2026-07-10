// lib/__tests__/fxSources.test.ts
import { describe, it, expect } from 'vitest'
import {
  isAuthoritativeBankFeed,
  isProvisional,
  getFxCategory,
  normalizeToProvisional,
  shouldShowFeedBadge,
} from '../fxSources'

describe('fxSources helpers', () => {
  it('recognizes BANK_FEED sources as authoritative', () => {
    expect(isAuthoritativeBankFeed('BANK_FEED:statement:visa-123')).toBe(true)
    expect(isAuthoritativeBankFeed('BANK_FEED:stripe:pi_abc')).toBe(true)
    expect(isAuthoritativeBankFeed('BANK_FEED:paypal:pp_xyz')).toBe(true)
    expect(isAuthoritativeBankFeed('bank_feed:foo')).toBe(true) // case insensitive
    expect(isAuthoritativeBankFeed('PROVISIONAL')).toBe(false)
    expect(isAuthoritativeBankFeed(null)).toBe(false)
  })

  it('treats missing source and weak sources as provisional', () => {
    expect(isProvisional(null)).toBe(true)
    expect(isProvisional(undefined)).toBe(true)
    expect(isProvisional('AI_AUTONOMOUS')).toBe(true)
    expect(isProvisional('DERIVED_FROM_ENTRY')).toBe(true)
    expect(isProvisional('ECB')).toBe(true)
    expect(isProvisional('MANUAL')).toBe(true)
    expect(isProvisional('PROVISIONAL')).toBe(true)
    expect(isProvisional('ECB_PROVISIONAL')).toBe(true)
    expect(isProvisional('BANK_FEED:statement:x')).toBe(false)
  })

  it('classifies correctly', () => {
    expect(getFxCategory('BANK_FEED:stripe:xx')).toBe('BANK_FEED')
    expect(getFxCategory('PROVISIONAL')).toBe('PROVISIONAL')
    expect(getFxCategory('ECB_PROVISIONAL')).toBe('PROVISIONAL')
    expect(getFxCategory('MANUAL')).toBe('MANUAL')
    expect(getFxCategory('AI_AUTONOMOUS')).toBe('WEAK')
    expect(getFxCategory(null)).toBe('PROVISIONAL')
  })

  it('normalizes to provisional labels', () => {
    expect(normalizeToProvisional('ECB')).toBe('ECB_PROVISIONAL')
    expect(normalizeToProvisional('MANUAL')).toBe('MANUAL_PROVISIONAL')
    expect(normalizeToProvisional('something')).toBe('LLM_PROVISIONAL')
    expect(normalizeToProvisional(null)).toBe('LLM_PROVISIONAL')
  })

  it('feed badge only for authoritative', () => {
    expect(shouldShowFeedBadge('BANK_FEED:statement:xx')).toBe(true)
    expect(shouldShowFeedBadge('PROVISIONAL')).toBe(false)
    expect(shouldShowFeedBadge(null)).toBe(false)
  })
})
