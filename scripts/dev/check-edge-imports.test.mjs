import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findEscapingImports } from './check-edge-imports.mjs'

function fixture(entrySource) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'edge-imports-'))
  const fns = path.join(root, 'supabase', 'functions')
  mkdirSync(path.join(fns, '_shared'), { recursive: true })
  mkdirSync(path.join(fns, 'fn'), { recursive: true })
  mkdirSync(path.join(root, 'packages', 'app-core', 'src'), { recursive: true })
  writeFileSync(
    path.join(root, 'packages/app-core/src/database.generated.ts'),
    'export type Database = {}\n'
  )
  writeFileSync(path.join(fns, '_shared/client.ts'), 'export const x = 1\n')
  writeFileSync(path.join(fns, 'fn/index.ts'), entrySource)
  return { fns, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('an `import type` that climbs out of supabase/functions is an offender', () => {
  const { fns, cleanup } = fixture(
    "import type { Database } from '../../../packages/app-core/src/database.generated.ts'\nimport { x } from '../_shared/client.ts'\n"
  )
  const { offenders } = findEscapingImports(fns)
  cleanup()
  assert.deepEqual(offenders, [
    {
      file: 'fn/index.ts',
      spec: '../../../packages/app-core/src/database.generated.ts'
    }
  ])
})

test('POSITIVE CONTROL: imports that stay inside supabase/functions pass', () => {
  const { fns, cleanup } = fixture(
    "import { x } from '../_shared/client.ts'\nexport { x }\n"
  )
  const { scanned, offenders } = findEscapingImports(fns)
  cleanup()
  assert.equal(scanned, 2)
  assert.deepEqual(offenders, [])
})

test('the real tree has no escaping imports', () => {
  const { scanned, offenders } = findEscapingImports(
    path.join(import.meta.dirname, '..', '..', 'supabase', 'functions')
  )
  assert.ok(scanned > 10, `only ${scanned} files scanned`)
  assert.deepEqual(offenders, [])
})
