import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('browser-reachable player_mapping identity boundary', () => {
  it('does not project auth UUIDs into Zone Management member queries', () => {
    const source = readSource(
      'app/(dashboard)/wars/_components/ZoneManagement.tsx'
    )

    expect(source).not.toMatch(
      /\.select\(\s*['"][^'"]*\buser_id\b[^'"]*['"]\s*\)/u
    )
  })

  it('does not project auth UUIDs into materialized-stat fallbacks', () => {
    const source = readSource('app/lib/hooks/member-stats-materialized.ts')

    expect(source).not.toMatch(/\buser_id\b/u)
  })

  it('does not subscribe browser clients to raw player_mapping changes', () => {
    const source = readSource('app/lib/hooks/shared/useGuildMembers.ts')

    expect(source).not.toMatch(/postgres_changes/u)
    expect(source).not.toMatch(/table:\s*['"]player_mapping['"]/u)
    expect(source).not.toMatch(/\bsubscribe\??\s*:/u)
  })
})
