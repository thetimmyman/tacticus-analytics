import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_ROOT = resolve(process.cwd(), 'app')

const collectTsxFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return collectTsxFiles(path)
    if (!entry.isFile() || !entry.name.endsWith('.tsx')) return []
    if (entry.name.endsWith('.test.tsx')) return []
    return [path]
  })

const directlyImportsDataTable = (source: string): boolean => {
  const imports = source.matchAll(
    /import[\s\S]*?from\s+['"](@\/app\/components\/ui(?:\/DataTable)?)['"]/g
  )
  return Array.from(imports).some(([statement]) =>
    statement.includes('DataTable')
  )
}

describe('DataTable React Server Component boundary', () => {
  it('keeps every direct production importer inside an explicit client module', () => {
    const offenders = collectTsxFiles(APP_ROOT).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      if (!directlyImportsDataTable(source)) return []

      const directiveIndex = source.indexOf("'use client'")
      const firstImportIndex = source.search(/\bimport\b/)
      return directiveIndex >= 0 && directiveIndex < firstImportIndex
        ? []
        : [relative(process.cwd(), path)]
    })

    expect(offenders).toEqual([])
  })
})
