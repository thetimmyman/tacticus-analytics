import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  verifySchemaProofInstallation,
  schemaBootstrapProofReceipt
} from '../../../apps/desktop/platform/macos/schema-bootstrap-proof.mjs'

import * as proof from '../../../apps/desktop/platform/macos/schema-bootstrap-proof.mjs'

test('maintained CLI refuses invalid invocations through direct and symlink-ancestor paths equally', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'synthetic-proof-cli-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const modulePath = fileURLToPath(
    new URL(
      '../../../apps/desktop/platform/macos/schema-bootstrap-proof.mjs',
      import.meta.url
    )
  )
  const ancestor = join(directory, 'module-parent')
  await symlink(join(modulePath, '..'), ancestor, 'dir')
  const alias = join(ancestor, 'schema-bootstrap-proof.mjs')
  const admission = join(directory, 'invalid-admission.json')
  const invalidShape = join(directory, 'invalid-admission-shape.json')
  const output = join(directory, 'schema-bootstrap-proof.json')
  await writeFile(admission, 'not-json')
  await writeFile(invalidShape, '{}')
  for (const args of [[], [admission, output], [invalidShape, output]]) {
    for (const entry of [modulePath, alias]) {
      const result = spawnSync(process.execPath, [entry, ...args], {
        env: { PATH: '/usr/bin:/bin' },
        timeout: 5000,
        encoding: 'utf8'
      })
      assert.equal(result.error, undefined)
      assert.equal(result.signal, null)
      assert.equal(result.status, 1)
      assert.equal(result.stdout, '')
      assert.equal(result.stderr, '')
    }
  }
  assert.deepEqual((await readdir(directory)).sort(), [
    'invalid-admission-shape.json',
    'invalid-admission.json',
    'module-parent'
  ])
})

test('child failure diagnostics distinguish missing output from safe failed and completed shapes', () => {
  assert.deepEqual(
    proof.schemaBootstrapChildFailure({
      code: 0,
      signal: null,
      outputRead: 'missing'
    }),
    {
      child: {
        exitCode: 0,
        signal: null,
        outputPresent: false,
        parseStage: 'missing'
      },
      failedGroup: 'admission',
      completedGroups: []
    }
  )
  const failed = proof.schemaBootstrapChildFailure({
    code: 1,
    signal: null,
    outputRead: 'read',
    outputBytes: Buffer.from(
      JSON.stringify({
        status: 'failed',
        actualInstalledMacRecovery: false,
        failedGroup: 'actual-bootstrap-rollback',
        completedGroups: [
          'fresh-default-comment',
          'fresh-default-comment',
          'private-path'
        ],
        rawError: 'SYNTHETIC-PRIVATE-CANARY'
      })
    )
  })
  assert.equal(failed.child.parseStage, 'failed-shape')
  assert.equal(failed.child.outputPresent, true)
  assert.equal(failed.failedGroup, 'actual-bootstrap-rollback')
  assert.deepEqual(failed.completedGroups, ['fresh-default-comment'])
  assert.equal(
    JSON.stringify(failed).includes('SYNTHETIC-PRIVATE-CANARY'),
    false
  )
  const completed = proof.schemaBootstrapChildFailure({
    code: 0,
    signal: null,
    outputRead: 'read',
    outputBytes: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        actualInstalledMacRecovery: true,
        groups: []
      })
    )
  })
  assert.equal(completed.child.parseStage, 'completed-shape')
  assert.equal(completed.failedGroup, 'admission')
  assert.deepEqual(completed.completedGroups, [])
})

const freshSubsteps = [
  'fresh-state-and-journal',
  'pg-initdb',
  'pg-start-ready',
  'default-comment-and-journal',
  'bootstrap-inspect',
  'auth-prerequisites-migrate-ready',
  'bootstrap-complete',
  'receipt-marker-retirement-relation',
  'fresh-native-startup-and-receipt'
]

for (const substep of freshSubsteps) {
  test(`fresh proof retains the first ${substep} failure through cleanup`, async () => {
    const trace = proof.schemaBootstrapProofTrace()
    const original = new Error('SYNTHETIC-PRIVATE-CANARY')
    let cleaned = false
    await assert.rejects(
      trace.step('fresh-native-startup-and-receipt', async () => {
        try {
          await trace.step(substep, async () => {
            throw original
          })
        } finally {
          cleaned = true
          throw new Error('SYNTHETIC-CLEANUP-CANARY')
        }
      }),
      (error) => error === original
    )
    assert.equal(cleaned, true)
    assert.deepEqual(trace.failure(), { failedSubstep: substep })
    const projected = proof.schemaBootstrapChildFailure({
      code: 1,
      signal: null,
      outputRead: 'read',
      outputBytes: Buffer.from(
        JSON.stringify({
          status: 'failed',
          actualInstalledMacRecovery: false,
          failedGroup: 'fresh-default-comment',
          completedGroups: [],
          ...trace.failure(),
          error: original.message,
          stack: original.stack
        })
      )
    })
    assert.equal(projected.failedSubstep, substep)
    assert.equal(projected.failedGroup, 'fresh-default-comment')
    assert.deepEqual(projected.completedGroups, [])
    assert.equal(JSON.stringify(projected).includes('CANARY'), false)
  })
}

test('fresh proof trace leaves successful results unchanged and refuses unknown labels before action', async () => {
  const trace = proof.schemaBootstrapProofTrace()
  const result = { synthetic: true }
  assert.equal(await trace.step('pg-initdb', async () => result), result)
  assert.deepEqual(trace.failure(), {})
  let invoked = false
  await assert.rejects(
    trace.step('SYNTHETIC-PRIVATE-CANARY', async () => {
      invoked = true
    }),
    { code: 'EPROOF' }
  )
  assert.equal(invoked, false)
  assert.deepEqual(trace.failure(), {})
})

test('fresh substep projection rejects unknown metadata and labels outside the fresh group', () => {
  for (const failedGroup of [
    'fresh-default-comment',
    'actual-bootstrap-rollback',
    'private-group'
  ]) {
    for (const failedSubstep of [
      'SYNTHETIC-PRIVATE-CANARY',
      {},
      null,
      7,
      ['pg-initdb'],
      'pg-initdb'
    ]) {
      const projected = proof.schemaBootstrapChildFailure({
        code: 1,
        signal: null,
        outputRead: 'read',
        outputBytes: Buffer.from(
          JSON.stringify({
            status: 'failed',
            actualInstalledMacRecovery: false,
            failedGroup,
            failedSubstep,
            rawError: 'SYNTHETIC-PRIVATE-CANARY',
            command: 'SYNTHETIC-PRIVATE-CANARY'
          })
        )
      })
      assert.equal(
        Object.hasOwn(projected, 'failedSubstep'),
        failedGroup === 'fresh-default-comment' && failedSubstep === 'pg-initdb'
      )
      assert.equal(JSON.stringify(projected).includes('CANARY'), false)
    }
  }
})

test('child failure diagnostics emit finite opaque states for malformed output and unknown exits', () => {
  for (const [outputRead, outputBytes, stage, present] of [
    ['unreadable', undefined, 'unreadable', null],
    ['read', Buffer.alloc(65537), 'oversized', true],
    ['read', Buffer.from('SYNTHETIC-PRIVATE-CANARY'), 'invalid-json', true],
    ['read', Buffer.from('null'), 'invalid-shape', true],
    [
      'read',
      Buffer.from('{"status":"failed","actualInstalledMacRecovery":true}'),
      'invalid-shape',
      true
    ]
  ]) {
    const result = proof.schemaBootstrapChildFailure({
      code: false,
      signal: 'SYNTHETIC-PRIVATE-CANARY',
      outputRead,
      outputBytes
    })
    assert.equal(result.child.exitCode, null)
    assert.equal(result.child.signal, 'other')
    assert.equal(result.child.parseStage, stage)
    assert.equal(result.child.outputPresent, present)
    assert.equal(
      JSON.stringify(result).includes('SYNTHETIC-PRIVATE-CANARY'),
      false
    )
    assert.deepEqual(result.completedGroups, [])
  }
  assert.equal(
    proof.schemaBootstrapChildFailure({
      code: 999,
      signal: 'SIGTERM',
      outputRead: 'missing'
    }).child.exitCode,
    null
  )
  assert.equal(
    proof.schemaBootstrapChildFailure({
      code: null,
      signal: 'SIGTERM',
      outputRead: 'missing'
    }).child.signal,
    'SIGTERM'
  )
})

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const componentPaths = [
  'Contents/MacOS/TacticusAnalytics',
  ...[
    'bin/node',
    'postgres/bin/initdb',
    'postgres/bin/postgres',
    'postgres/bin/psql',
    'auth/auth',
    'postgrest/postgrest'
  ].map((path) => 'Contents/Resources/runtime/' + path)
]
const refused = {
  code: 'EPROOF',
  message: 'Installed schema recovery proof refused'
}
const sourcePaths = [
  'apps/desktop/platform/macos/schema-bootstrap-proof.mjs',
  'apps/desktop/platform/macos/schema-bootstrap.mjs',
  'apps/desktop/platform/macos/services.mjs',
  'apps/desktop/platform/macos/workspace.mjs',
  'apps/desktop/proof/synthetic-import.mjs',
  'apps/desktop/local-schema/canonical-objects.sql',
  'apps/desktop/local-schema/authority.sql',
  'apps/desktop/local-schema/manifest.json'
]
async function fixture(t) {
  const installed = await mkdtemp(join(tmpdir(), 'synthetic-schema-proof-'))
  t.after(() => rm(installed, { recursive: true, force: true }))
  const files = [],
    sourceHashes = {}
  for (const path of sourcePaths) {
    const full = 'Contents/Resources/runtime/' + path
    const bytes = Buffer.from('synthetic-public-fixture:' + path)
    await mkdir(join(installed, full, '..'), { recursive: true })
    await writeFile(join(installed, full), bytes)
    files.push({ path: full, bytes: bytes.length, sha256: hash(bytes) })
    sourceHashes[path] = hash(bytes)
  }
  for (const path of componentPaths) {
    const bytes = Buffer.from('synthetic-public-component:' + path)
    await mkdir(join(installed, path, '..'), { recursive: true })
    await writeFile(join(installed, path), bytes)
    files.push({ path, bytes: bytes.length, sha256: hash(bytes) })
  }
  const manifest = {
    schemaVersion: 1,
    platform: 'macos',
    architecture: 'arm64',
    sourceCommit: 'a'.repeat(40),
    kind: 'unsigned-developer-candidate',
    rights: 'review-required',
    minimumOS: '15.0',
    files
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  await writeFile(
    join(installed, 'Contents/Resources/package-inventory.json'),
    manifestBytes
  )
  const admission = {
    schemaVersion: 1,
    sourceCommit: 'a'.repeat(40),
    artifactSha256: 'b'.repeat(64),
    architecture: 'arm64',
    inventorySha256: hash(manifestBytes),
    sourceHashes
  }
  return { installed, admission, manifest, manifestBytes, files }
}
test('installed proof admits only the complete source-bound copied inventory', async (t) => {
  const f = await fixture(t)
  const result = await verifySchemaProofInstallation(f)
  assert.equal(result.files, 15)
  assert.equal(result.inventorySha256, f.admission.inventorySha256)
  assert.equal(result.sourceCommit, 'a'.repeat(40))
})
async function directoryFixture(t) {
  const f = await fixture(t)
  await mkdir(
    join(f.installed, 'Contents/Resources/empty-parent/empty-child'),
    {
      recursive: true
    }
  )
  f.manifest.schemaVersion = 2
  f.manifest.directories = []
  const walk = async (path = '') => {
    for (const entry of await readdir(join(f.installed, path), {
      withFileTypes: true
    })) {
      if (!entry.isDirectory()) continue
      const relative = path ? path + '/' + entry.name : entry.name
      f.manifest.directories.push(relative)
      await walk(relative)
    }
  }
  await walk()
  return f
}
async function writeManifest(f) {
  const bytes = Buffer.from(JSON.stringify(f.manifest))
  await writeFile(
    join(f.installed, 'Contents/Resources/package-inventory.json'),
    bytes
  )
  f.admission.inventorySha256 = hash(bytes)
}
test('directory manifest admits its exact declared empty hierarchy and refuses copied changes', async (t) => {
  for (const kind of [
    'unchanged',
    'injected-empty',
    'missing-empty',
    'directory-to-file',
    'directory-to-link',
    'changed-file',
    'missing-file',
    'escaping-link'
  ]) {
    await t.test(kind, async (t) => {
      const f = await directoryFixture(t)
      const empty = join(
        f.installed,
        'Contents/Resources/empty-parent/empty-child'
      )
      if (kind === 'injected-empty')
        await mkdir(join(f.installed, 'not-in-manifest'))
      if (kind === 'missing-empty') await rm(empty, { recursive: true })
      if (kind === 'directory-to-file' || kind === 'directory-to-link') {
        await rm(empty, { recursive: true })
        if (kind === 'directory-to-file') await writeFile(empty, 'canary')
        else await symlink('../runtime', empty)
      }
      const first = join(f.installed, f.files[0].path)
      if (kind === 'changed-file') await writeFile(first, 'canary')
      if (kind === 'missing-file') await rm(first)
      if (kind === 'escaping-link') {
        await rm(first)
        await symlink('/dev/null', first)
        f.manifest.files[0] = { path: f.files[0].path, link: '/dev/null' }
      }
      await writeManifest(f)
      if (kind === 'unchanged')
        assert.equal((await verifySchemaProofInstallation(f)).files, 15)
      else await assert.rejects(verifySchemaProofInstallation(f), refused)
    })
  }
})
test('directory manifest rejects malformed, duplicate, overlapping or incomplete ancestry authority', async (t) => {
  for (const kind of [
    'not-array',
    'duplicate',
    'file-overlap',
    'manifest-overlap',
    'absolute',
    'traversal',
    'empty',
    'dot',
    'control',
    'too-long',
    'too-many',
    'missing-directory-parent',
    'missing-file-parent',
    'unknown-key'
  ]) {
    await t.test(kind, async (t) => {
      const f = await directoryFixture(t)
      const paths = f.manifest.directories
      if (kind === 'not-array') f.manifest.directories = {}
      if (kind === 'duplicate') paths.push(paths[0])
      if (kind === 'file-overlap') paths.push(f.files[0].path)
      if (kind === 'manifest-overlap')
        paths.push('Contents/Resources/package-inventory.json')
      if (kind === 'absolute') paths.push('/outside')
      if (kind === 'traversal') paths.push('Contents/../outside')
      if (kind === 'empty') paths.push('')
      if (kind === 'dot') paths.push('Contents/./Resources')
      if (kind === 'control') paths.push('Contents/\u0000canary')
      if (kind === 'too-long') paths.push('x'.repeat(4097))
      if (kind === 'too-many')
        f.manifest.directories = Array(25001).fill('Contents')
      if (kind === 'missing-directory-parent')
        f.manifest.directories = paths.filter(
          (path) => path !== 'Contents/Resources/empty-parent'
        )
      if (kind === 'missing-file-parent')
        f.manifest.directories = paths.filter(
          (path) => path !== 'Contents/MacOS'
        )
      if (kind === 'unknown-key') f.manifest.untrusted = true
      await writeManifest(f)
      await assert.rejects(verifySchemaProofInstallation(f), refused)
    })
  }
})
test('unknown, changed, missing or escaping installed entries refuse before imports', async (t) => {
  for (const kind of [
    'unknown',
    'empty-directory',
    'changed',
    'missing',
    'symlink',
    'manifest',
    'source-pin'
  ]) {
    await t.test(kind, async (t) => {
      const f = await fixture(t),
        first = join(f.installed, f.files[0].path)
      if (kind === 'unknown')
        await writeFile(join(f.installed, 'unexpected'), 'private canary')
      if (kind === 'empty-directory')
        await mkdir(join(f.installed, 'unexpected-directory'))
      if (kind === 'changed') await writeFile(first, 'changed')
      if (kind === 'missing') await rm(first)
      if (kind === 'symlink') {
        await rm(first)
        await symlink('/dev/null', first)
      }
      if (kind === 'manifest')
        await writeFile(
          join(f.installed, 'Contents/Resources/package-inventory.json'),
          '{}'
        )
      if (kind === 'source-pin')
        f.admission.sourceHashes[sourcePaths[0]] = 'c'.repeat(64)
      await assert.rejects(verifySchemaProofInstallation(f), refused)
    })
  }
})
test('duplicate, unsafe, foreign-source and unsupported inventory authority refuse', async (t) => {
  for (const kind of [
    'duplicate',
    'traversal',
    'source',
    'architecture',
    'version',
    'component'
  ]) {
    await t.test(kind, async (t) => {
      const f = await fixture(t)
      if (kind === 'duplicate') f.manifest.files.push(f.manifest.files[0])
      if (kind === 'component') {
        const removed = f.manifest.files.pop()
        await rm(join(f.installed, removed.path))
      }
      if (kind === 'traversal') f.manifest.files[0].path = '../outside'
      if (kind === 'source') f.manifest.sourceCommit = 'd'.repeat(40)
      if (kind === 'architecture') f.manifest.architecture = 'x64'
      if (kind === 'version') f.admission.schemaVersion = 2
      const bytes = Buffer.from(JSON.stringify(f.manifest))
      await writeFile(
        join(f.installed, 'Contents/Resources/package-inventory.json'),
        bytes
      )
      f.admission.inventorySha256 = hash(bytes)
      await assert.rejects(verifySchemaProofInstallation(f), refused)
    })
  }
})
test('installation refusal exposes only the fixed failing admission stage', async (t) => {
  for (const stage of [
    'admission',
    'installation-root',
    'manifest-read',
    'manifest-hash',
    'manifest-decode',
    'manifest-shape',
    'manifest-metadata',
    'inventory-path',
    'directory-set',
    'entry-set',
    'entry-file',
    'entry-link',
    'entry-completeness',
    'component-presence',
    'source-authority'
  ]) {
    await t.test(stage, async (t) => {
      const f = await fixture(t)
      const canary = 'SYNTHETIC_PRIVATE_CANARY'
      const first = join(f.installed, f.files[0].path)
      let changedManifest
      if (stage === 'admission') f.admission.sourceCommit = canary
      if (stage === 'installation-root') f.installed += '/' + canary
      if (stage === 'manifest-read')
        await rm(join(f.installed, 'Contents/Resources/package-inventory.json'))
      if (stage === 'manifest-hash')
        await writeFile(
          join(f.installed, 'Contents/Resources/package-inventory.json'),
          canary
        )
      if (stage === 'manifest-decode') changedManifest = Buffer.from([0xff])
      if (stage === 'manifest-shape') changedManifest = Buffer.from('[]')
      if (stage === 'manifest-metadata') {
        f.manifest.sourceCommit = 'd'.repeat(40)
        changedManifest = Buffer.from(JSON.stringify(f.manifest))
      }
      if (stage === 'inventory-path') {
        f.manifest.files.push(f.manifest.files[0])
        changedManifest = Buffer.from(JSON.stringify(f.manifest))
      }
      if (stage === 'directory-set') await mkdir(join(f.installed, canary))
      if (stage === 'entry-set')
        await writeFile(join(f.installed, canary), canary)
      if (stage === 'entry-file') await writeFile(first, canary)
      if (stage === 'entry-link') {
        await rm(first)
        await symlink('/dev/null', first)
        f.manifest.files[0] = { path: f.files[0].path, link: '/dev/null' }
        changedManifest = Buffer.from(JSON.stringify(f.manifest))
      }
      if (stage === 'entry-completeness') await rm(first)
      if (stage === 'component-presence') {
        const removed = f.manifest.files.pop()
        await rm(join(f.installed, removed.path))
        const replacement = removed.path + '-replacement'
        await writeFile(join(f.installed, replacement), canary)
        f.manifest.files.push({
          path: replacement,
          bytes: Buffer.byteLength(canary),
          sha256: hash(canary)
        })
        changedManifest = Buffer.from(JSON.stringify(f.manifest))
      }
      if (stage === 'source-authority')
        f.admission.sourceHashes[sourcePaths[0]] = 'c'.repeat(64)
      if (changedManifest) {
        await writeFile(
          join(f.installed, 'Contents/Resources/package-inventory.json'),
          changedManifest
        )
        f.admission.inventorySha256 = hash(changedManifest)
      }
      await assert.rejects(verifySchemaProofInstallation(f), (error) => {
        assert.equal(error.code, refused.code)
        assert.equal(error.message, refused.message)
        assert.equal(error.stage, stage)
        assert.deepEqual(Object.keys(error).sort(), ['code', 'stage'])
        assert.equal(JSON.stringify(error).includes(canary), false)
        assert.equal(JSON.stringify(error).includes(f.installed), false)
        return true
      })
    })
  }
})
const observations = {
  'fresh-default-comment': {
    defaultComment: true,
    nativeStartup: true,
    canonicalReceipt: true,
    marker: true,
    journalRetired: true
  },
  'committed-marker-loss': {
    dataPreserved: true,
    credentialsPreserved: true,
    databasePreserved: true,
    recoveredMarker: true,
    secondOpen: true,
    dataSha256: 'c'.repeat(64),
    credentialsSha256: 'd'.repeat(64),
    databaseSha256: 'e'.repeat(64)
  },
  'post-commit-filesystem-denial': {
    commitObserved: true,
    markerWriteRefused: true,
    journalPreserved: true,
    recovered: true,
    conserved: true
  },
  'actual-bootstrap-rollback': {
    latched: true,
    backendTerminated: true,
    nonzeroClientExit: true,
    schemaRolledBack: true,
    journalPreserved: true,
    resumed: true
  },
  'genuine-legacy-workspace': {
    legacySourceSha256: 'f'.repeat(64),
    markerPreserved: true,
    defaultCommentPreserved: true,
    noJournal: true,
    dataPreserved: true,
    credentialsPreserved: true,
    databasePreserved: true
  },
  'unknown-and-conflicting-authority': {
    negativeCases: 10,
    allRefused: true,
    conserved: true
  },
  'state-directory-identity': {
    cases: 2,
    allRefused: true,
    replacementUntouched: true,
    originalPreserved: true
  },
  'public-catalog-footprint': {
    negativeCases: 5,
    allRefused: true,
    pgcryptoAvailability: 'absent',
    pgcryptoMembership: 'not-established'
  }
}
test('receipt retains fixed measured scope and explicit unestablished extension coverage', () => {
  const result = schemaBootstrapProofReceipt({
    binding: {
      sourceCommit: 'a'.repeat(40),
      artifactSha256: 'b'.repeat(64),
      architecture: 'arm64',
      inventorySha256: 'c'.repeat(64),
      files: 15
    },
    observations,
    runtimes: {
      node: '22.23.3',
      postgres: '18.6',
      auth: '2.197.0',
      postgrest: '16.4'
    },
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z'
  })
  assert.equal(result.groups.length, 8)
  assert.equal(
    result.groups[7].observations.pgcryptoMembership,
    'not-established'
  )
  assert.equal(result.actualInstalledMacRecovery, true)
  assert.equal(result.graphicalQualification, 'separate-primary-verdict')
  assert.equal(result.fullParity, 'unqualified')
})
test('receipt refuses incomplete, failed or sensitive observations rather than inventing passes', () => {
  for (const kind of ['missing', 'false', 'raw', 'extension']) {
    const changed = structuredClone(observations)
    if (kind === 'missing') delete changed['actual-bootstrap-rollback']
    if (kind === 'false') changed['fresh-default-comment'].marker = false
    if (kind === 'raw')
      changed['fresh-default-comment'].rawError = 'SYNTHETIC-PRIVATE-CANARY'
    if (kind === 'extension')
      changed['public-catalog-footprint'].pgcryptoAvailability = 'present'
    assert.throws(
      () =>
        schemaBootstrapProofReceipt({
          binding: {
            sourceCommit: 'a'.repeat(40),
            artifactSha256: 'b'.repeat(64),
            architecture: 'arm64',
            inventorySha256: 'c'.repeat(64),
            files: 15
          },
          observations: changed,
          runtimes: {
            node: '22.23.3',
            postgres: '18.6',
            auth: '2.197.0',
            postgrest: '16.4'
          },
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:01:00.000Z'
        }),
      refused
    )
  }
})

test('receipt refuses invalid timestamps with the fixed public error', () => {
  assert.throws(
    () =>
      schemaBootstrapProofReceipt({
        binding: {
          sourceCommit: 'a'.repeat(40),
          artifactSha256: 'b'.repeat(64),
          architecture: 'arm64',
          inventorySha256: 'c'.repeat(64),
          files: 15
        },
        observations,
        runtimes: {
          node: '22.23.3',
          postgres: '18.6',
          auth: '2.197.0',
          postgrest: '16.4'
        },
        startedAt: 'not a timestamp',
        completedAt: '2026-01-01T00:01:00.000Z'
      }),
    refused
  )
})

test('rollback fence retains the complete SQL prefix and advertises ready only afterward', () => {
  const sql =
    "BEGIN;\nSELECT 7;\nSELECT 11;\nDO $receipt$ BEGIN EXECUTE format('receipt'); END $receipt$;\nCOMMIT;"
  const result = proof.schemaBootstrapRollbackFence(sql)
  assert.equal(
    result.input,
    "BEGIN;\nSELECT 7;\nSELECT 11;\nSET LOCAL application_name='desktop-schema-rollback-ready';\n"
  )
  assert.equal(result.readyApplicationName, 'desktop-schema-rollback-ready')
  assert.throws(
    () => proof.schemaBootstrapRollbackFence('BEGIN; SELECT 7; COMMIT;'),
    refused
  )
})
test('rollback termination admission refuses an early idle interval and ambiguous or malformed backends', () => {
  const row = {
    pid: 4321,
    application_name: 'desktop-schema-rollback',
    usename: 'desktop_owner',
    datname: 'postgres',
    state: 'idle in transaction',
    wait_event: 'ClientRead'
  }
  assert.equal(proof.schemaBootstrapRollbackBackend([row]), undefined)
  assert.equal(proof.schemaBootstrapRollbackBackend([]), undefined)
  const ready = { ...row, application_name: 'desktop-schema-rollback-ready' }
  assert.equal(
    proof.schemaBootstrapRollbackBackend([{ ...ready, state: 'active' }]),
    undefined
  )
  assert.equal(
    proof.schemaBootstrapRollbackBackend([
      { ...ready, usename: 'other_owner' }
    ]),
    undefined
  )
  assert.equal(proof.schemaBootstrapRollbackBackend([ready]), 4321)
  assert.throws(
    () =>
      proof.schemaBootstrapRollbackBackend([ready, { ...ready, pid: 4322 }]),
    refused
  )
  assert.throws(
    () => proof.schemaBootstrapRollbackBackend([{ ...ready, pid: -1 }]),
    refused
  )
})
test('later proof failure retains exactly primary evidence without creating a success attachment', async (t) => {
  const working = await mkdtemp(join(tmpdir(), 'synthetic-primary-source-'))
  const output = await mkdtemp(join(tmpdir(), 'synthetic-primary-evidence-'))
  t.after(() => rm(working, { recursive: true, force: true }))
  t.after(() => rm(output, { recursive: true, force: true }))
  const names = [
    'device-session.json',
    'renderer.json',
    'renderer.png',
    'storage-first.json',
    'storage-second.json'
  ]
  for (const name of names)
    await writeFile(join(working, name), 'synthetic-primary:' + name)
  await writeFile(join(working, 'credentials.json'), 'SYNTHETIC-PRIVATE-CANARY')
  await writeFile(
    join(working, 'schema-bootstrap-proof.json'),
    'SYNTHETIC-NOT-A-PASS'
  )
  await writeFile(
    join(working, 'platform-evidence.json'),
    'SYNTHETIC-NOT-A-PASS'
  )
  assert.equal(
    await proof.retainSchemaProofPrimaryEvidence({ working, output }),
    5
  )
  assert.deepEqual((await readdir(output)).sort(), [...names].sort())
  for (const name of names)
    assert.equal(
      await readFile(join(output, name), 'utf8'),
      'synthetic-primary:' + name
    )
})
