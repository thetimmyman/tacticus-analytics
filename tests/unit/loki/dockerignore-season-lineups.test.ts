import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('production Loki data packaging', () => {
  it('keeps the cumulative season lineup overlay in the Docker build context', () => {
    const dockerignore = readFileSync('.dockerignore', 'utf8')

    expect(dockerignore).toContain('data/loki-api/')
    expect(dockerignore).toContain('!data/loki-api/season-lineups.json')
  })
})
