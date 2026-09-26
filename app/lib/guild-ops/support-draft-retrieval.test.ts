import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { draftSupportAnswer } from '@/app/lib/guild-ops/support-draft-retrieval'
import { SUPPORT_KNOWLEDGE_BASE } from '@/app/lib/guild-ops/support-knowledge-base'

// Guards: citations come only from the static knowledge base, low-confidence questions
// hand off to a human, and the module has no path to Supabase/network I/O.

const SOURCE_ROUTE_FILES: Record<string, string> = {
  '/faq': 'app/(public)/faq/page.tsx',
  '/support-creator': 'app/(public)/support-creator/page.tsx',
  '/boss-playbooks': 'app/(dashboard)/boss-playbooks/page.tsx'
}

function markdownHeadingSlugs(source: string): Set<string> {
  return new Set(
    source
      .split('\n')
      .map((line) => line.match(/^#{1,6}\s+(.+)$/)?.[1])
      .filter((heading): heading is string => Boolean(heading))
      .map((heading) =>
        heading
          .toLowerCase()
          .replace(/[`*_]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
      )
  )
}

describe('draftSupportAnswer', () => {
  it('returns a matching KB answer whose sources are only real KB entries', () => {
    const result = draftSupportAnswer(
      'How do I add my Player API key for data sync?'
    )

    expect(result.needsHandoff).toBe(false)
    expect(result.answer).not.toBeNull()
    expect(result.sources.length).toBeGreaterThan(0)

    const knownIds = new Set(SUPPORT_KNOWLEDGE_BASE.map((entry) => entry.id))
    const knownSourceRefs = new Set(
      SUPPORT_KNOWLEDGE_BASE.map((entry) => entry.sourceRef)
    )
    for (const source of result.sources) {
      expect(knownIds.has(source.id)).toBe(true)
      expect(knownSourceRefs.has(source.sourceRef)).toBe(true)
    }
  })

  it('routes an unmatched question to human handoff instead of guessing', () => {
    const result = draftSupportAnswer(
      'zzqxw unrelated gibberish nonsense query 12345'
    )

    expect(result.needsHandoff).toBe(true)
    expect(result.answer).toBeNull()
    expect(result.sources).toEqual([])
    expect(result.confidence).toBe(0)
  })

  it('routes short ambiguous questions to handoff instead of keyword guessing', () => {
    for (const question of ['account hacked', 'delete guild', 'api broken']) {
      const result = draftSupportAnswer(question)

      expect(result.needsHandoff).toBe(true)
      expect(result.answer).toBeNull()
    }
  })

  it('matches multi-word keywords as phrases for known KB topics', () => {
    const result = draftSupportAnswer('no data')

    expect(result.needsHandoff).toBe(false)
    expect(result.sources[0]?.id).toBe('troubleshoot-no-data')
  })

  it('routes an empty question to human handoff', () => {
    const result = draftSupportAnswer('')

    expect(result.needsHandoff).toBe(true)
    expect(result.answer).toBeNull()
  })

  it('never returns confidence above 1', () => {
    const result = draftSupportAnswer(
      'token tracking regenerate season cap bomb cooldown'
    )
    expect(result.confidence).toBeLessThanOrEqual(1)
  })

  it('caps sources at 3 even when many entries match', () => {
    const result = draftSupportAnswer(
      'api key data sync privacy share view raid information'
    )
    expect(result.sources.length).toBeLessThanOrEqual(3)
  })

  it('retrieves the password-reset-lockout pattern with a public citation', () => {
    const result = draftSupportAnswer(
      "I tried to reset my password and now I'm locked out of my account"
    )

    expect(result.needsHandoff).toBe(false)
    expect(
      result.sources.some((source) => source.id === 'password-reset-lockout')
    ).toBe(true)
    expect(
      result.sources.every((source) => source.sourceRef.startsWith('/'))
    ).toBe(true)
    expect(result.answer).toMatch(/do not ask the player to post/i)
    expect(result.answer).not.toMatch(/relay your account email/i)
  })

  it('flags the open Herald notes-reverting issue as unresolved, not fixed', () => {
    const result = draftSupportAnswer(
      'my notes on a boss replay keep reverting after I save them'
    )

    expect(result.needsHandoff).toBe(false)
    expect(result.answer).toMatch(
      /known active issue|has not yet been confirmed fixed/i
    )
  })

  it('every KB entry sourceRef is a public route', () => {
    for (const entry of SUPPORT_KNOWLEDGE_BASE) {
      expect(entry.sourceRef.startsWith('/')).toBe(true)
    }
  })

  it('every KB sourceRef resolves to a committed file and anchor when provided', () => {
    for (const entry of SUPPORT_KNOWLEDGE_BASE) {
      const rawRef = entry.sourceRef
      const [rawPath, anchor] = rawRef.split('#')

      expect(rawPath).toBeTruthy()
      const sourceFile = SOURCE_ROUTE_FILES[rawPath ?? '']
      expect(sourceFile, entry.sourceRef).toBeTruthy()

      const absolutePath = join(process.cwd(), sourceFile ?? '')
      expect(existsSync(absolutePath), entry.sourceRef).toBe(true)

      if (!anchor) continue

      const source = readFileSync(absolutePath, 'utf-8')
      if (sourceFile?.endsWith('.md')) {
        expect(markdownHeadingSlugs(source).has(anchor), entry.sourceRef).toBe(
          true
        )
      } else {
        expect(source, entry.sourceRef).toContain(`id="${anchor}"`)
      }
    }
  })

  it('no KB entry mined from support history contains an email address', () => {
    const emailPattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
    for (const entry of SUPPORT_KNOWLEDGE_BASE) {
      expect(entry.question).not.toMatch(emailPattern)
      expect(entry.answer).not.toMatch(emailPattern)
    }
  })

  it('has no Supabase or network dependency (structural no-leak guarantee)', () => {
    const modulePath = join(
      process.cwd(),
      'app/lib/guild-ops/support-draft-retrieval.ts'
    )
    const source = readFileSync(modulePath, 'utf-8')
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import /.test(line))
      .join('\n')

    expect(importLines).not.toMatch(/supabase|app\/lib\/db/i)
    expect(source).not.toMatch(/fetch\(/)
  })
})
