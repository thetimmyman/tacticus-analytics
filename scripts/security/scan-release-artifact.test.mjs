import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluate } from './scan-release-artifact.mjs'

const script = fileURLToPath(
  new URL('./scan-release-artifact.mjs', import.meta.url)
)

test('flags private material and nothing else', () => {
  const bad = [
    '.env',
    'a/b/.env.local',
    'x/server.pem',
    'k/id_rsa',
    'a/secrets/t.txt',
    'w/data.sqlite',
    'workspace-owner.json'
  ]
  assert.equal(evaluate(bad.map((path) => ({ path }))).length, bad.length)
  const ok = [
    'app/index.js',
    'node_modules/credentials-helper/index.js',
    'lib/Pilot000c28.db.js',
    'notices/LICENSE'
  ]
  assert.deepEqual(evaluate(ok.map((path) => ({ path }))), [])
})

test('CLI exits nonzero on a tainted inventory and zero on a clean one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-release-'))
  try {
    const run = (files) => {
      const inventory = join(dir, 'inv.json')
      writeFileSync(inventory, JSON.stringify({ files }))
      try {
        execFileSync(
          process.execPath,
          [script, '--scan', '--inventory', inventory],
          { stdio: 'pipe' }
        )
        return 0
      } catch (error) {
        return error.status
      }
    }
    assert.equal(run([{ path: 'app/index.js' }]), 0)
    assert.equal(run([{ path: 'app/.env' }]), 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('malformed inventories fail closed', () => {
  for (const bad of [undefined, null, [], [{}], [{ path: 3 }]])
    assert.equal(evaluate(bad).length, 1)
})
