import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** The retired /api/auth-proxy could send login bodies to a host taken from NEXT_PUBLIC_SUPABASE_URL. */

const repoRoot = process.cwd()

const sourceExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.mdx',
  '.json',
  '.sql'
])
const ignoredDirs = new Set([
  '.git',
  '.next',
  'node_modules',
  'coverage',
  'tmp',
  '.wt'
])

const walkSourceFiles = (relativeRoot: string): string[] => {
  const absoluteRoot = path.join(repoRoot, relativeRoot)
  if (!existsSync(absoluteRoot)) return []
  const out: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignoredDirs.has(entry.name)) continue
      const absolutePath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      if (!sourceExtensions.has(path.extname(entry.name))) continue
      out.push(path.relative(repoRoot, absolutePath).replace(/\\/g, '/'))
    }
  }
  visit(absoluteRoot)
  return out
}

const CENSUS_ROOTS = [
  'app',
  'modules',
  'packages',
  'supabase',
  'scripts',
  'docs',
  'public',
  'tests'
]
const CENSUS_STANDALONE_FILES = ['proxy.ts', 'next.config.js']

const THIS_FILE = 'tests/unit/api/ps386-auth-proxy-retired.test.ts'

describe('PS-386: /api/auth-proxy is retired', () => {
  it('the route directory no longer exists', () => {
    expect(existsSync(path.join(repoRoot, 'app/api/auth-proxy'))).toBe(false)
  })

  it('no source file references /api/auth-proxy or auth-proxy', () => {
    const files = CENSUS_ROOTS.flatMap(walkSourceFiles).filter(
      (file) => file !== THIS_FILE
    )

    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(path.join(repoRoot, file), 'utf8')
      if (source.includes('auth-proxy')) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })

  it('the two standalone census files (proxy.ts, next.config.js) do not reference auth-proxy', () => {
    for (const file of CENSUS_STANDALONE_FILES) {
      const fullPath = path.join(repoRoot, file)
      if (!existsSync(fullPath)) continue
      const source = readFileSync(fullPath, 'utf8')
      expect(source).not.toContain('auth-proxy')
    }
  })

  it('positive control: the census still finds live source content', () => {
    const proxySource = readFileSync(path.join(repoRoot, 'proxy.ts'), 'utf8')
    expect(proxySource).toContain("pathname.startsWith('/api/')")

    const loginRoute = readFileSync(
      path.join(repoRoot, 'app/api/auth/login/route.ts'),
      'utf8'
    )
    expect(loginRoute).toContain('signInWithPassword')
  })
})
