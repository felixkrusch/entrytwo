// lib/fxSources.ts
// Centralized fxSource classification for provisional vs authoritative rates.
// No DB schema change needed. Pure convention + helpers.
// Since there are no prior users, we can be strict in new code.

export type FxSourceCategory = 'BANK_FEED' | 'PROVISIONAL' | 'MANUAL' | 'WEAK';

const BANK_FEED_PREFIX = 'BANK_FEED';

const PROVISIONAL_VALUES = new Set([
  'PROVISIONAL',
  'ECB_PROVISIONAL',
  'MANUAL_PROVISIONAL',
  'LLM_PROVISIONAL',
]);

const WEAK_VALUES = new Set([
  'AI_AUTONOMOUS',
  'DERIVED_FROM_ENTRY',
  'AI_REMEMBERED',
  'ECB',
  'MANUAL', // when used without explicit user intent to lock it as final
]);

/**
 * Returns true if the source is an authoritative bank/card feed rate.
 * These are the "truth" and must win.
 */
export function isAuthoritativeBankFeed(src?: string | null): boolean {
  if (!src) return false;
  const s = src.trim().toUpperCase();
  return s.startsWith(BANK_FEED_PREFIX);
}

/**
 * Returns true if the source represents a provisional / estimated rate.
 * This includes explicit provisional markers and legacy weak sources.
 */
export function isProvisional(src?: string | null): boolean {
  if (!src) return true; // missing source for a foreign line → treat as provisional
  const s = src.trim().toUpperCase();

  if (isAuthoritativeBankFeed(s)) return false;

  if (PROVISIONAL_VALUES.has(s)) return true;

  // Legacy weak sources are treated as provisional for UI, reports, and new creation rules
  if (WEAK_VALUES.has(s)) return true;

  // Any source containing the word "PROVISIONAL" anywhere
  if (s.includes('PROVISIONAL')) return true;

  return false;
}

/**
 * Classify the source for UI badges and logic.
 */
export function getFxCategory(src?: string | null): FxSourceCategory {
  if (!src) return 'PROVISIONAL';
  const s = src.trim().toUpperCase();

  if (isAuthoritativeBankFeed(s)) return 'BANK_FEED';
  if (PROVISIONAL_VALUES.has(s) || s.includes('PROVISIONAL')) return 'PROVISIONAL';
  if (s === 'MANUAL') return 'MANUAL';
  if (WEAK_VALUES.has(s)) return 'WEAK';
  // Unknown but not bank feed → be conservative and treat as provisional
  return 'PROVISIONAL';
}

/**
 * Normalize a source for a new foreign line that needs to be marked provisional.
 * Prefers explicit provisional labels.
 */
export function normalizeToProvisional(preferred?: string | null): string {
  if (preferred) {
    const s = preferred.trim().toUpperCase();
    if (s.includes('PROVISIONAL')) return s;
    if (s === 'ECB') return 'ECB_PROVISIONAL';
    if (s === 'MANUAL') return 'MANUAL_PROVISIONAL';
    if (s === 'LLM' || s === 'AI' || s.includes('LLM') || s.includes('GROK')) return 'LLM_PROVISIONAL';
  }
  return 'LLM_PROVISIONAL';  // Default for model-supplied provisional rates on attached documents
}

/**
 * Human-friendly label for UI.
 */
export function getFxSourceLabel(src?: string | null): string {
  if (!src) return 'provisional (no rate)';
  const cat = getFxCategory(src);
  if (cat === 'BANK_FEED') return 'feed';
  if (cat === 'PROVISIONAL') {
    const s = (src || '').toUpperCase();
    if (s.includes('LLM')) return 'provisional (LLM estimate)';
    return 'provisional';
  }
  if (cat === 'MANUAL') return 'manual';
  if (cat === 'WEAK') return 'estimated';
  return src;
}

/**
 * Should we show the green authoritative "feed" badge?
 */
export function shouldShowFeedBadge(src?: string | null): boolean {
  return isAuthoritativeBankFeed(src);
}
