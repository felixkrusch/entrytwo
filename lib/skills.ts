import { readFile } from 'fs/promises'
import { createHash } from 'crypto'

// Map logical skill names to filesystem locations under .grok/skills
const SKILL_PATHS: Record<string, URL[]> = {
  core: [
    new URL('../.grok/skills/actions/core-principles/SKILL.md', import.meta.url),
    new URL('../.grok/skills/trillion/SKILL.md', import.meta.url),
  ],
  'create-journal': [
    new URL('../.grok/skills/actions/create-journal/SKILL.md', import.meta.url),
  ],
  'create-contact': [
    new URL('../.grok/skills/actions/create-contact/SKILL.md', import.meta.url),
  ],
  'update-contact': [
    new URL('../.grok/skills/actions/create-contact/SKILL.md', import.meta.url),
  ],
  'create-invoice-draft': [
    new URL('../.grok/skills/actions/create-invoice-draft/SKILL.md', import.meta.url),
  ],
  'extract-bank-statement': [
    new URL('../.grok/skills/actions/extract-bank-statement/SKILL.md', import.meta.url),
  ],
}

export async function loadSkill(skill: string): Promise<string> {
  return (await loadVersionedSkill(skill))?.content || ''
}

export type VersionedSkill = { name: string; version: string; content: string }

export async function loadVersionedSkill(skill: string): Promise<VersionedSkill | null> {
  const normalized = (skill || '').toLowerCase().trim()
  const candidates = SKILL_PATHS[normalized] || []

  for (const p of candidates) {
    try {
      const content = await readFile(p, 'utf8')
      if (content && content.trim()) return versioned(normalized, content)
    } catch {}
  }

  return null
}

function versioned(name: string, content: string): VersionedSkill {
  const normalized = content.trim()
  return { name, content: normalized, version: `sha256:${createHash('sha256').update(normalized).digest('hex')}` }
}
