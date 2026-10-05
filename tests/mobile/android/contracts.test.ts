import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'

const root = resolve('apps/mobile/android')
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8'))
const schema = readJson(`${root}/contracts/mobile-workspace.schema.v1.json`)
const fixture = readJson(`${root}/contracts/mobile-workspace.synthetic.v1.json`)
const validate = new Ajv2020({ strict: true }).compile(schema as object)

describe('Android portable boundary and retained acceptance', () => {
  it('validates the shared synthetic consumer and integer analytics semantics', () => {
    expect(validate(fixture)).toBe(true)
    const rows = (fixture as { raids: { damage: number; tokens: number }[] })
      .raids
    const damage = rows.reduce((sum, row) => sum + row.damage, 0)
    const tokens = rows.reduce((sum, row) => sum + row.tokens, 0)
    expect([damage, tokens, Math.floor(damage / tokens)]).toEqual([300, 2, 150])
  })

  it.each([
    { schemaVersion: 'mobile-workspace/v2' },
    { apiKey: 'synthetic-forbidden-field' },
    { player: false },
    { mode: 'verified' },
    {
      raids: [
        {
          player: 'Synthetic',
          boss: 'Synthetic',
          damage: 1.5,
          tokens: 0,
          observedAt: 0
        }
      ]
    }
  ])(
    'rejects incompatible or authority-bearing document changes %j',
    (change) => {
      expect(validate({ ...(fixture as object), ...change })).toBe(false)
    }
  )

  it('retains every provisional source without silently approving exclusions', () => {
    const matrix = readJson(
      resolve('docs/mobile/android/feature-matrix.json')
    ) as {
      rows: { source: string; status: string; reason: string }[]
      approvedExclusions: string[]
    }
    expect(matrix.rows).toHaveLength(339)
    expect(new Set(matrix.rows.map((row) => row.source)).size).toBe(339)
    for (const row of matrix.rows) {
      const exists = row.source.startsWith('sha256:')
        ? execFileSync('git', ['ls-files', 'app'], { encoding: 'utf8' })
            .trim()
            .split('\n')
            .some(
              (path) =>
                `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}` ===
                row.source
            )
        : existsSync(resolve(row.source))
      expect(exists, row.source).toBe(true)
      expect(['implemented', 'blocked', 'approved-exclusion']).toContain(
        row.status
      )
      expect(row.reason.length).toBeGreaterThan(0)
      if (row.status === 'approved-exclusion')
        expect(matrix.approvedExclusions).toContain(row.source)
    }
  })
})
