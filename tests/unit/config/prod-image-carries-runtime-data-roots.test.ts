import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Dockerfile.prod copies explicit paths, so a missing data root only fails in production. */

const ROOT_SRC = 'app/lib/data/game-data-root.ts'
const DOCKERFILE = 'docker/Dockerfile.prod'

function declaredRuntimeRoots(): string[] {
  const src = readFileSync(ROOT_SRC, 'utf8')
  const roots: string[] = []
  for (const m of src.matchAll(/path\.join\(\s*process\.cwd\(\),([^)]*)\)/gs)) {
    const segs = [...m[1].matchAll(/'([^']+)'/g)].map((s) => s[1])
    if (segs.length) roots.push(segs.join('/'))
  }
  return [...new Set(roots)]
}

function runnerCopyDestinations(): string[] {
  const df = readFileSync(DOCKERFILE, 'utf8')
  const runnerStart = df.indexOf('FROM base AS runner')
  expect(
    runnerStart,
    'Dockerfile.prod no longer has a `FROM base AS runner` stage; this test can no longer tell which COPYs reach the image'
  ).toBeGreaterThan(-1)
  const runner = df.slice(runnerStart)
  return [...runner.matchAll(/^COPY\s+.*?\s(\S+)\s*$/gm)].map((m) =>
    m[1].replace(/^\.\//, '').replace(/\/$/, '')
  )
}

describe('production image carries the runtime data roots', () => {
  it('declares roots this test can actually see', () => {
    // An extractor matching nothing would make every assertion vacuous.
    const roots = declaredRuntimeRoots()
    expect(roots.length).toBeGreaterThan(0)
    expect(roots).toContain('data/game-data')
  })

  it('copies every declared runtime root into the runner stage', () => {
    const dests = runnerCopyDestinations()
    expect(dests.length).toBeGreaterThan(0)

    const uncovered = declaredRuntimeRoots().filter(
      (root) => !dests.some((d) => d === root || d.startsWith(`${root}/`))
    )
    expect(
      uncovered,
      'These roots are read at runtime but never COPYed into the runner stage, ' +
        'so the image ships without them and the routes 500 at request time:\n' +
        uncovered.join('\n')
    ).toEqual([])
  })

  it('is not vacuous: an undeclared root is not matched by any COPY', () => {
    const dests = runnerCopyDestinations()
    const fake = 'data/zzz-root-that-does-not-exist'
    expect(dests.some((d) => d === fake || d.startsWith(`${fake}/`))).toBe(
      false
    )
  })
})
