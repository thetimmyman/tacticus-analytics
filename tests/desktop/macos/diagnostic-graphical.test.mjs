import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  extractDiagnosticBase,
  diagnosticObservation
} from '../../../apps/desktop/platform/macos/diagnostic-graphical.mjs'

async function fixture(t, extra = []) {
  const directory = await mkdtemp(join(tmpdir(), 'ta diagnostic archive '))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const archive = join(directory, 'base.zip'),
    output = join(directory, 'extracted')
  execFileSync(
    'python3',
    [
      '-c',
      `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as archive:
    for name in ['artifact.json', 'candidate.dmg', 'package-inventory.json']:
        archive.writestr(name, 'synthetic')
    for name, mode in json.loads(sys.argv[2]):
        info = zipfile.ZipInfo(name)
        info.external_attr = mode << 16
        archive.writestr(info, 'synthetic')
`,
      archive,
      JSON.stringify(extra)
    ],
    { stdio: 'pipe' }
  )
  return { archive, output }
}

test('missing or malformed diagnostic safety observations remain unsafe', () => {
  assert.deepEqual(diagnosticObservation(), {
    nodeAccess: true,
    positiveScore: false,
    negativeScore: false,
    serviceDisruption: true
  })
  assert.equal(
    diagnosticObservation({ nodeAccess: 'false', serviceDisruption: 0 })
      .nodeAccess,
    true
  )
  assert.equal(
    diagnosticObservation({ nodeAccess: false, serviceDisruption: false })
      .serviceDisruption,
    false
  )
})

test('diagnostic archive extracts only the fixed immutable base entries', async (t) => {
  const { archive, output } = await fixture(t, [['renderer.json', 0]])
  extractDiagnosticBase(archive, output)
  assert.equal(
    await readFile(join(output, 'candidate.dmg'), 'utf8'),
    'synthetic'
  )
  await assert.rejects(stat(join(output, 'renderer.json')), { code: 'ENOENT' })
})

for (const [name, extra] of [
  ['traversal', [['../escape', 0]]],
  ['symlink', [['renderer.json', 0o120777]]],
  ['duplicate', [['artifact.json', 0]]]
])
  test(
    'diagnostic archive refuses ' + name + ' before extracting any entry',
    async (t) => {
      const { archive, output } = await fixture(t, extra)
      assert.throws(() => extractDiagnosticBase(archive, output))
      await assert.rejects(stat(output), { code: 'ENOENT' })
    }
  )
