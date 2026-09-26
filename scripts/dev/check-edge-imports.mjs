#!/usr/bin/env node
// Relative imports under supabase/functions must stay inside it: the edge image
// copies only that tree, so Deno fails to boot the worker. `import type` counts.
// Usage: node scripts/dev/check-edge-imports.mjs [<functions-dir>]

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export function findEscapingImports(functionsDir) {
  const root = path.resolve(functionsDir)
  const files = []
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const target = path.join(dir, name)
      if (statSync(target).isDirectory()) visit(target)
      else if (/\.[cm]?[jt]sx?$/.test(name)) files.push(target)
    }
  }
  visit(root)

  const specifier =
    /(?:^|\n)\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g
  const offenders = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(specifier)) {
      const spec = match[1] ?? match[2]
      const resolved = path.resolve(path.dirname(file), spec)
      if (!resolved.startsWith(root + path.sep)) {
        offenders.push({ file: path.relative(root, file), spec })
      }
    }
  }
  return { scanned: files.length, offenders }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const dir = process.argv[2] ?? 'supabase/functions'
  const { scanned, offenders } = findEscapingImports(dir)
  if (scanned === 0) {
    console.error(
      `check-edge-imports: no source files under ${dir} — nothing was checked`
    )
    process.exit(1)
  }
  for (const { file, spec } of offenders) {
    console.error(
      `check-edge-imports: ${file} imports '${spec}', which resolves OUTSIDE ${dir} — absent from the edge image, the worker cannot boot`
    )
  }
  if (offenders.length > 0) process.exit(1)
  console.log(`check-edge-imports: ${scanned} files, no import escapes ${dir}`)
}
