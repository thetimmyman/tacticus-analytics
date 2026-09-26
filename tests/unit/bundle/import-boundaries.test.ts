import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const ignoredDirs = new Set([
  '.git',
  '.next',
  'node_modules',
  'coverage',
  'tmp'
])

const repoRoot = process.cwd()

const walkSourceFiles = (relativeRoot: string): string[] => {
  const absoluteRoot = path.join(repoRoot, relativeRoot)
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
  return out.sort()
}

const findImportOffenders = (
  files: string[],
  pattern: RegExp,
  allowedFiles: Set<string> = new Set()
): string[] => {
  const offenders: string[] = []
  for (const file of files) {
    if (allowedFiles.has(file)) continue
    const source = readFileSync(path.join(repoRoot, file), 'utf8')
    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0
      const line = source.slice(0, index).split('\n').length
      offenders.push(`${file}:${line}`)
    }
  }
  return offenders
}

describe('bundle import boundaries', () => {
  const appFiles = walkSourceFiles('app')
  const browserEntryFiles = ['instrumentation-client.ts', ...appFiles]

  it('keeps app code off the root @tacticus/charting barrel', () => {
    const rootChartingImport =
      /(?:from\s+|import\s*\(\s*|import\s+)['"]@tacticus\/charting['"]/g

    expect(findImportOffenders(appFiles, rootChartingImport)).toEqual([])
  })

  it('keeps the recharts component bundle behind the shared dynamic wrapper', () => {
    const chartingComponentsImport =
      /(?:from\s+|import\s*\(\s*|import\s+)['"]@tacticus\/charting\/components['"]/g
    const allowed = new Set(['app/components/RechartsWrapper.tsx'])

    expect(
      findImportOffenders(appFiles, chartingComponentsImport, allowed)
    ).toEqual([])
  })

  it('keeps browser Sentry imports tree-shakeable', () => {
    const namespaceImport =
      /import\s+\*\s+as\s+\w+\s+from\s+['"]@sentry\/nextjs['"]/g
    const commonJsRequire = /require\(\s*['"]@sentry\/nextjs['"]\s*\)/g

    expect(findImportOffenders(browserEntryFiles, namespaceImport)).toEqual([])
    expect(findImportOffenders(browserEntryFiles, commonJsRequire)).toEqual([])
  })

  it('keeps the post-login auth helper off shared first-load components', () => {
    const staticPostLoginHelperImport =
      /(?:from\s+|import\s+)['"]@\/app\/lib\/auth\/post-login-check['"]/g

    expect(findImportOffenders(appFiles, staticPostLoginHelperImport)).toEqual(
      []
    )
  })

  it('keeps shared dashboard chrome off static browser database imports', () => {
    const staticDbClientImport =
      /(?:from\s+|import\s+)['"]@\/app\/lib\/db\/client['"]/g
    const deferredDashboardDbFiles = [
      'app/components/SeasonSelector.tsx',
      'app/components/ThemeProvider.tsx',
      'app/lib/theme-system.ts',
      'app/components/BossLevelSelector.tsx',
      'app/components/boss-performance/hooks/useBossPerformanceData.tsx'
    ]

    expect(
      findImportOffenders(deferredDashboardDbFiles, staticDbClientImport)
    ).toEqual([])
  })
})
