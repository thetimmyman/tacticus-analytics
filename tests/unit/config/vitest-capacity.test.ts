import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Vitest capacity', () => {
  it('caps repository-wide worker fan-out for the shared CI host', () => {
    const config = readFileSync(
      path.join(process.cwd(), 'vitest.config.ts'),
      'utf8'
    )

    expect(config).toMatch(/\bmaxWorkers:\s*2\b/u)
  })

  it('caps next build static-generation workers for the shared CI host', () => {
    const config = readFileSync(
      path.join(process.cwd(), 'next.config.js'),
      'utf8'
    )

    expect(config).toMatch(/\bcpus:\s*2\b/u)
  })
})
