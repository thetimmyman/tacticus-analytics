// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const requireFromRoot = createRequire(path.join(root, 'package.json'))

const parts = (version: string) => version.split('.').map(Number)

function compare(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0)
  }
  return 0
}

// Only plain comparator ranges such as ">=4.8.4 <6.1.0"; anything else fails loudly.
function satisfies(version: string, range: string): boolean {
  return range
    .trim()
    .split(/\s+/u)
    .every((comparator) => {
      const match = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/u.exec(comparator)
      if (!match) throw new Error(`unsupported peer range: ${range}`)
      const order = compare(version, match[2])
      switch (match[1]) {
        case '>=':
          return order >= 0
        case '<=':
          return order <= 0
        case '>':
          return order > 0
        case '<':
          return order < 0
        default:
          return order === 0
      }
    })
}

describe('TypeScript side-by-side toolchain', () => {
  it('runs the native TypeScript 7 compiler as tsc', () => {
    const manifestPath = requireFromRoot.resolve(
      '@typescript/native/package.json'
    )
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name: string
      version: string
      bin: { tsc: string }
    }
    const binary = path.resolve(path.dirname(manifestPath), manifest.bin.tsc)

    expect(manifest.name, 'tsc must come from the typescript package').toBe(
      'typescript'
    )
    expect(
      parts(manifest.version)[0],
      'the typecheck scripts need TypeScript 7 behind tsc'
    ).toBeGreaterThanOrEqual(7)
    expect(
      execFileSync(process.execPath, [binary, '--version'], {
        encoding: 'utf8'
      })
    ).toMatch(/^Version 7\./u)
  })

  it('keeps the TypeScript 6 compiler API for next build, eslint and repo scripts', () => {
    const ts = requireFromRoot('typescript') as {
      createProgram?: unknown
      version: string
    }
    expect(
      typeof ts.createProgram,
      'TypeScript 7 ships no JS API; `typescript` must stay the 6.0 API package'
    ).toBe('function')
    expect(parts(ts.version)[0]).toBe(6)
  })

  it("satisfies typescript-eslint's TypeScript peer range", () => {
    const { version } = requireFromRoot('typescript/package.json') as {
      version: string
    }
    const { peerDependencies } = requireFromRoot(
      '@typescript-eslint/parser/package.json'
    ) as { peerDependencies: { typescript: string } }

    expect(
      satisfies(version, peerDependencies.typescript),
      `typescript ${version} is outside @typescript-eslint/parser's peer range ${peerDependencies.typescript}`
    ).toBe(true)
  })
})
