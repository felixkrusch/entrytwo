import { readFile } from 'fs/promises'
import { join } from 'path'

const SKILL_BASE = join(process.cwd(), '.grok', 'skills')

// Map logical skill names to filesystem locations under .grok/skills
const SKILL_PATHS: Record<string, string[]> = {
  core: [
    join(SKILL_BASE, 'actions', 'core-principles', 'SKILL.md'),
    join(SKILL_BASE, 'trillion', 'SKILL.md'),
  ],
  'create-journal': [
    join(SKILL_BASE, 'actions', 'create-journal', 'SKILL.md'),
  ],
  'create-contact': [
    join(SKILL_BASE, 'actions', 'create-contact', 'SKILL.md'),
  ],
  'update-contact': [
    join(SKILL_BASE, 'actions', 'create-contact', 'SKILL.md'), // reuse for now; update-contact is small
  ],
  'create-invoice-draft': [
    join(SKILL_BASE, 'actions', 'create-invoice-draft', 'SKILL.md'),
  ],
}

export async function loadSkill(skill: string): Promise<string> {
  const normalized = (skill || '').toLowerCase().trim()
  const candidates = SKILL_PATHS[normalized] || [
    join(SKILL_BASE, normalized, 'SKILL.md'),
    join(SKILL_BASE, normalized + '.md'),
    join(SKILL_BASE, 'actions', normalized, 'SKILL.md'),
  ]

  for (const p of candidates) {
    try {
      const content = await readFile(p, 'utf8')
      if (content && content.trim()) return content.trim()
    } catch {}
  }

  // Fallback: try a direct relative under actions or root
  const fallbacks = [
    join(SKILL_BASE, 'actions', normalized, 'SKILL.md'),
    join(SKILL_BASE, normalized, 'SKILL.md'),
  ]
  for (const p of fallbacks) {
    try {
      const content = await readFile(p, 'utf8')
      if (content && content.trim()) return content.trim()
    } catch {}
  }

  return ''
}
