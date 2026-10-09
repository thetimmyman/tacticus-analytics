import { constants } from 'node:fs'
import {
  open,
  lstat,
  realpath,
  readdir,
  readlink,
  writeFile,
  mkdir,
  rm,
  cp,
  chmod,
  rename,
  symlink,
  link
} from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { resolve, join, dirname, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

const failed = () =>
  Object.assign(new Error('Installed schema recovery proof refused'), {
    code: 'EPROOF'
  })
const requireProof = (value) => {
  if (!value) throw failed()
}
const sha = (value) => createHash('sha256').update(value).digest('hex')
const hex = (value, length = 64) =>
  typeof value === 'string' &&
  new RegExp('^[a-f0-9]{' + length + '}$', 'u').test(value)
const exactKeys = (value, keys) =>
  value &&
  !Array.isArray(value) &&
  typeof value === 'object' &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',')
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
const manifestPath = 'Contents/Resources/package-inventory.json'
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
const groups = {
  'fresh-default-comment': [
    'defaultComment',
    'nativeStartup',
    'canonicalReceipt',
    'marker',
    'journalRetired'
  ],
  'committed-marker-loss': [
    'dataPreserved',
    'credentialsPreserved',
    'databasePreserved',
    'recoveredMarker',
    'secondOpen',
    'dataSha256',
    'credentialsSha256',
    'databaseSha256'
  ],
  'post-commit-filesystem-denial': [
    'commitObserved',
    'markerWriteRefused',
    'journalPreserved',
    'recovered',
    'conserved'
  ],
  'actual-bootstrap-rollback': [
    'latched',
    'backendTerminated',
    'nonzeroClientExit',
    'schemaRolledBack',
    'journalPreserved',
    'resumed'
  ],
  'genuine-legacy-workspace': [
    'legacySourceSha256',
    'markerPreserved',
    'defaultCommentPreserved',
    'noJournal',
    'dataPreserved',
    'credentialsPreserved',
    'databasePreserved'
  ],
  'unknown-and-conflicting-authority': [
    'negativeCases',
    'allRefused',
    'conserved'
  ],
  'state-directory-identity': [
    'cases',
    'allRefused',
    'replacementUntouched',
    'originalPreserved'
  ],
  'public-catalog-footprint': [
    'negativeCases',
    'allRefused',
    'pgcryptoAvailability',
    'pgcryptoMembership'
  ]
}
function admissionFields(admission) {
  requireProof(
    exactKeys(admission, [
      'schemaVersion',
      'sourceCommit',
      'artifactSha256',
      'architecture',
      'inventorySha256',
      'sourceHashes'
    ])
  )
  requireProof(
    admission.schemaVersion === 1 &&
      hex(admission.sourceCommit, 40) &&
      hex(admission.artifactSha256) &&
      hex(admission.inventorySha256) &&
      ['arm64', 'x64'].includes(admission.architecture) &&
      exactKeys(admission.sourceHashes, sourcePaths) &&
      Object.values(admission.sourceHashes).every((value) => hex(value))
  )
}
async function boundedFile(path, limit) {
  let file
  try {
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const info = await file.stat()
    requireProof(info.isFile() && info.size <= limit)
    const bytes = await file.readFile()
    requireProof(bytes.length <= limit)
    return bytes
  } catch {
    throw failed()
  } finally {
    await file?.close()
  }
}
async function fileDigest(path, bytes) {
  let file
  try {
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const info = await file.stat()
    requireProof(
      info.isFile() && info.size === bytes && bytes <= 512 * 1024 * 1024
    )
    const digest = createHash('sha256'),
      buffer = Buffer.alloc(64 * 1024)
    let total = 0
    for (;;) {
      const read = await file.read(buffer, 0, buffer.length, null)
      if (!read.bytesRead) break
      total += read.bytesRead
      requireProof(total <= bytes)
      digest.update(buffer.subarray(0, read.bytesRead))
    }
    requireProof(total === bytes)
    return digest.digest('hex')
  } finally {
    await file?.close()
  }
}
export async function verifySchemaProofInstallation({ installed, admission }) {
  // Fixed stages identify the refused gate without exposing paths or contents.
  let stage = 'admission'
  try {
    admissionFields(admission)
    stage = 'installation-root'
    requireProof(isAbsolute(installed))
    const info = await lstat(installed)
    requireProof(info.isDirectory() && !info.isSymbolicLink())
    const root = await realpath(installed)
    stage = 'manifest-read'
    const manifestBytes = await boundedFile(
      join(root, manifestPath),
      8 * 1024 * 1024
    )
    stage = 'manifest-hash'
    requireProof(sha(manifestBytes) === admission.inventorySha256)
    stage = 'manifest-decode'
    const manifest = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)
    )
    stage = 'manifest-shape'
    requireProof(
      exactKeys(manifest, [
        'schemaVersion',
        'platform',
        'architecture',
        'sourceCommit',
        'kind',
        'rights',
        'minimumOS',
        'files',
        ...(manifest.schemaVersion === 2 ? ['directories'] : [])
      ])
    )
    stage = 'manifest-metadata'
    requireProof(
      [1, 2].includes(manifest.schemaVersion) &&
        manifest.platform === 'macos' &&
        manifest.sourceCommit === admission.sourceCommit &&
        manifest.architecture === admission.architecture &&
        manifest.kind === 'unsigned-developer-candidate' &&
        manifest.rights === 'review-required' &&
        manifest.minimumOS === '15.0' &&
        Array.isArray(manifest.files) &&
        manifest.files.length >= sourcePaths.length + componentPaths.length &&
        manifest.files.length <= 25000
    )
    const expected = new Map()
    let totalBytes = 0
    for (const row of manifest.files) {
      stage = 'inventory-path'
      requireProof(
        typeof row?.path === 'string' &&
          row.path.length <= 4096 &&
          !/[\0-\x1f\\]/u.test(row.path) &&
          !isAbsolute(row.path) &&
          row.path
            .split('/')
            .every((part) => part && part !== '.' && part !== '..') &&
          row.path !== manifestPath &&
          !expected.has(row.path)
      )
      if (Object.hasOwn(row, 'link')) {
        stage = 'inventory-link'
        requireProof(
          exactKeys(row, ['path', 'link']) &&
            typeof row.link === 'string' &&
            row.link.length > 0 &&
            row.link.length <= 4096 &&
            !/[\0-\x1f]/u.test(row.link)
        )
      } else {
        stage = 'inventory-file'
        requireProof(
          exactKeys(row, ['path', 'bytes', 'sha256']) &&
            Number.isSafeInteger(row.bytes) &&
            row.bytes >= 0 &&
            hex(row.sha256)
        )
        totalBytes += row.bytes
        requireProof(totalBytes <= 2 * 1024 * 1024 * 1024)
      }
      expected.set(row.path, row)
    }
    const directories = new Set([''])
    if (manifest.schemaVersion === 2) {
      // Directory authority comes from the pre-install manifest, including
      // empty resources and contained link targets. No directory is inferred
      // from the copied package or admitted merely because it is empty.
      stage = 'directory-inventory'
      requireProof(
        Array.isArray(manifest.directories) &&
          manifest.directories.length <= 25000
      )
      for (const path of manifest.directories) {
        requireProof(
          typeof path === 'string' &&
            path.length <= 4096 &&
            !isAbsolute(path) &&
            !/[\0-\x1f]/u.test(path) &&
            path
              .split('/')
              .every((part) => part && part !== '.' && part !== '..') &&
            !directories.has(path) &&
            !expected.has(path) &&
            path !== manifestPath
        )
        directories.add(path)
      }
      for (const path of [...expected.keys(), manifestPath, ...directories]) {
        let parent = dirname(path)
        while (parent !== '.') {
          requireProof(directories.has(parent))
          parent = dirname(parent)
        }
      }
    } else {
      // Legacy manifests retain their original ancestor-only contract.
      for (const path of [...expected.keys(), manifestPath]) {
        let parent = dirname(path)
        while (parent !== '.') {
          directories.add(parent)
          parent = dirname(parent)
        }
      }
    }
    const observed = new Set(),
      observedDirectories = new Set([''])
    const walk = async (path = '') => {
      stage = 'entry-list'
      for (const entry of await readdir(join(root, path), {
        withFileTypes: true
      })) {
        const name = path ? path + '/' + entry.name : entry.name
        stage = 'entry-name'
        requireProof(!/[\0-\x1f]/u.test(name))
        if (entry.isDirectory()) {
          stage = 'directory-set'
          requireProof(directories.has(name))
          observedDirectories.add(name)
          await walk(name)
          continue
        }
        if (name === manifestPath) {
          stage = 'manifest-entry'
          requireProof(entry.isFile())
          continue
        }
        const row = expected.get(name)
        stage = 'entry-set'
        requireProof(row && !observed.has(name))
        if (entry.isSymbolicLink()) {
          stage = 'entry-link'
          requireProof(
            Object.hasOwn(row, 'link') &&
              (await readlink(join(root, name))) === row.link
          )
          const part = relative(root, await realpath(join(root, name)))
          requireProof(!part.startsWith('..') && !isAbsolute(part))
        } else {
          stage = 'entry-file'
          requireProof(
            entry.isFile() &&
              !Object.hasOwn(row, 'link') &&
              (await fileDigest(join(root, name), row.bytes)) === row.sha256
          )
        }
        observed.add(name)
      }
    }
    await walk()
    stage = 'entry-completeness'
    requireProof(observed.size === expected.size)
    stage = 'directory-completeness'
    requireProof(observedDirectories.size === directories.size)
    stage = 'component-presence'
    for (const path of componentPaths) {
      const row = expected.get(path)
      requireProof(row && !Object.hasOwn(row, 'link'))
    }
    stage = 'source-authority'
    for (const path of sourcePaths) {
      const row = expected.get('Contents/Resources/runtime/' + path)
      requireProof(
        row &&
          row.sha256 === admission.sourceHashes[path] &&
          !Object.hasOwn(row, 'link')
      )
    }
    return {
      sourceCommit: admission.sourceCommit,
      artifactSha256: admission.artifactSha256,
      architecture: admission.architecture,
      inventorySha256: admission.inventorySha256,
      files: observed.size
    }
  } catch {
    throw Object.assign(failed(), { stage })
  }
}
export function schemaBootstrapProofReceipt({
  binding,
  observations,
  runtimes,
  startedAt,
  completedAt
}) {
  requireProof(
    exactKeys(binding, [
      'sourceCommit',
      'artifactSha256',
      'architecture',
      'inventorySha256',
      'files'
    ]) &&
      hex(binding.sourceCommit, 40) &&
      hex(binding.artifactSha256) &&
      hex(binding.inventorySha256) &&
      ['arm64', 'x64'].includes(binding.architecture) &&
      Number.isSafeInteger(binding.files) &&
      binding.files >= sourcePaths.length + componentPaths.length &&
      binding.files <= 25000
  )
  requireProof(
    exactKeys(runtimes, ['node', 'postgres', 'auth', 'postgrest']) &&
      runtimes.node === '22.23.3' &&
      runtimes.postgres === '18.6' &&
      runtimes.auth === '2.197.0' &&
      runtimes.postgrest === '16.4'
  )
  requireProof(
    typeof startedAt === 'string' &&
      typeof completedAt === 'string' &&
      Number.isFinite(Date.parse(startedAt)) &&
      Number.isFinite(Date.parse(completedAt)) &&
      new Date(startedAt).toISOString() === startedAt &&
      new Date(completedAt).toISOString() === completedAt &&
      Date.parse(completedAt) >= Date.parse(startedAt)
  )
  requireProof(exactKeys(observations, Object.keys(groups)))
  const projected = []
  for (const [name, keys] of Object.entries(groups)) {
    const value = observations[name]
    requireProof(exactKeys(value, keys))
    for (const key of keys) {
      if (key.endsWith('Sha256')) requireProof(hex(value[key]))
      else if (key === 'negativeCases')
        requireProof(
          value[key] === (name === 'public-catalog-footprint' ? 5 : 10)
        )
      else if (key === 'cases') requireProof(value[key] === 2)
      else if (key === 'pgcryptoAvailability')
        requireProof(['absent', 'present'].includes(value[key]))
      else if (key === 'pgcryptoMembership')
        requireProof(
          value[key] ===
            (value.pgcryptoAvailability === 'absent'
              ? 'not-established'
              : 'established')
        )
      else requireProof(value[key] === true)
    }
    projected.push({ name, passed: true, observations: { ...value } })
  }
  return {
    schemaVersion: 1,
    synthetic: true,
    ...binding,
    startedAt,
    completedAt,
    actualInstalledMacRecovery: true,
    groups: projected,
    runtimes: { ...runtimes },
    graphicalQualification: 'separate-primary-verdict',
    execution: 'normal-native-owner-guard-and-loopback-only-policy',
    faultScope: 'controlled-synthetic-filesystem-and-owned-database-faults',
    acknowledgementLoss: 'not-run',
    hostileSameUIDRace: 'unqualified',
    signing: 'unqualified',
    notarization: 'unqualified',
    physical: 'unqualified',
    fullParity: 'unqualified'
  }
}

// This diagnostic statement follows the unchanged product SQL prefix. The
// connection's initial name cannot prove that psql has executed that prefix.
export function schemaBootstrapRollbackFence(sql) {
  const delimiter = '\nDO $receipt$ BEGIN EXECUTE format('
  requireProof(
    typeof sql === 'string' &&
      sql.length <= 33 * 1024 * 1024 &&
      sql.startsWith('BEGIN;') &&
      sql.endsWith('COMMIT;') &&
      sql.indexOf(delimiter) > 0 &&
      sql.indexOf(delimiter) === sql.lastIndexOf(delimiter)
  )
  const readyApplicationName = 'desktop-schema-rollback-ready'
  return {
    input:
      sql.slice(0, sql.indexOf(delimiter)) +
      "\nSET LOCAL application_name='desktop-schema-rollback-ready';\n",
    readyApplicationName
  }
}
// Only a unique actual backend that has executed the post-prefix marker may
// be terminated. An early ClientRead between product commands is not ready.
export function schemaBootstrapRollbackBackend(rows) {
  requireProof(Array.isArray(rows) && rows.length <= 1)
  if (!rows.length) return undefined
  const row = rows[0]
  requireProof(
    exactKeys(row, [
      'pid',
      'application_name',
      'usename',
      'datname',
      'state',
      'wait_event'
    ]) &&
      Number.isSafeInteger(row.pid) &&
      row.pid > 1 &&
      row.pid <= 2147483647 &&
      ['application_name', 'usename', 'datname'].every(
        (key) => typeof row[key] === 'string' && row[key].length <= 128
      ) &&
      ['state', 'wait_event'].every(
        (key) =>
          row[key] === null ||
          (typeof row[key] === 'string' && row[key].length <= 128)
      )
  )
  return row.application_name === 'desktop-schema-rollback-ready' &&
    row.usename === 'desktop_owner' &&
    row.datname === 'postgres' &&
    row.state === 'idle in transaction' &&
    row.wait_event === 'ClientRead'
    ? row.pid
    : undefined
}
export async function retainSchemaProofPrimaryEvidence({ working, output }) {
  try {
    requireProof(
      isAbsolute(working) && isAbsolute(output) && working !== output
    )
    await privateDirectory(working)
    await privateDirectory(output)
    const names = [
      'device-session.json',
      'renderer.json',
      'renderer.png',
      'storage-first.json',
      'storage-second.json'
    ]
    for (const name of names) {
      const bytes = await boundedFile(
        join(working, name),
        name.endsWith('.png') ? 16 * 1024 * 1024 : 1024 * 1024
      )
      await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o600 })
    }
    return names.length
  } catch {
    throw failed()
  }
}

// Fixture-only exact public legacy bootstrap. Never replaces installed product bytes.
const legacyServicesSha256 =
  '0a63745cf55dbed3067f0804d16b9a702149afafd789371f63b408cb37742386'
const legacyServicesBase64 =
  'aW1wb3J0IHsgc3Bhd24gfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnCmltcG9ydCB7IGNyZWF0ZUhtYWMsIGNyZWF0ZUhhc2gsIHJhbmRvbUJ5dGVzLCByYW5kb21VVUlEIH0gZnJvbSAnbm9kZTpjcnlwdG8nCmltcG9ydCB7IGNyZWF0ZVNlcnZlciB9IGZyb20gJ25vZGU6bmV0JwppbXBvcnQgeyBta2RpciwgcmVhZEZpbGUsIHdyaXRlRmlsZSwgc3RhdCwgbHN0YXQgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJwppbXBvcnQgeyBjcmVhdGVXcml0ZVN0cmVhbSB9IGZyb20gJ25vZGU6ZnMnCmltcG9ydCB7IHJlc29sdmUsIGpvaW4sIGJhc2VuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJwppbXBvcnQgeyBzZXRUaW1lb3V0IGFzIGRlbGF5IH0gZnJvbSAnbm9kZTp0aW1lcnMvcHJvbWlzZXMnCgpjb25zdCBzZWNyZXQgPSAoKSA9PiByYW5kb21CeXRlcygzMikudG9TdHJpbmcoJ2hleCcpCmV4cG9ydCBmdW5jdGlvbiBzaWduZWRUb2tlbihrZXksIHJvbGUpIHsKICBjb25zdCBlbmNvZGUgPSAodmFsdWUpID0+CiAgICBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeSh2YWx1ZSkpLnRvU3RyaW5nKCdiYXNlNjR1cmwnKQogIGNvbnN0IGJvZHkgPSBgJHtlbmNvZGUoeyBhbGc6ICdIUzI1NicsIHR5cDogJ0pXVCcgfSl9LiR7ZW5jb2RlKHsgcm9sZSwgaXNzOiAnZGVza3RvcCcsIGlhdDogTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCksIGV4cDogTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgKyA4NjQwMCB9KX1gCiAgcmV0dXJuIGAke2JvZHl9LiR7Y3JlYXRlSG1hYygnc2hhMjU2Jywga2V5KS51cGRhdGUoYm9keSkuZGlnZXN0KCdiYXNlNjR1cmwnKX1gCn0KYXN5bmMgZnVuY3Rpb24gZnJlZVBvcnQoKSB7CiAgY29uc3Qgc2VydmVyID0gY3JlYXRlU2VydmVyKCkKICBhd2FpdCBuZXcgUHJvbWlzZSgoYWNjZXB0LCByZWplY3QpID0+IHsKICAgIHNlcnZlci5vbmNlKCdlcnJvcicsIHJlamVjdCkKICAgIHNlcnZlci5saXN0ZW4oMCwgJzEyNy4wLjAuMScsIGFjY2VwdCkKICB9KQogIGNvbnN0IHBvcnQgPSBzZXJ2ZXIuYWRkcmVzcygpLnBvcnQKICBhd2FpdCBuZXcgUHJvbWlzZSgoYWNjZXB0KSA9PiBzZXJ2ZXIuY2xvc2UoYWNjZXB0KSkKICByZXR1cm4gcG9ydAp9CmFzeW5jIGZ1bmN0aW9uIHJ1bihmaWxlLCBhcmdzLCBvcHRpb25zKSB7CiAgY29uc3QgY2hpbGQgPSBzcGF3bihmaWxlLCBhcmdzLCB7CiAgICAuLi5vcHRpb25zLAogICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddCiAgfSkKICBsZXQgc3Rkb3V0ID0gJycsCiAgICBzdGRlcnIgPSAnJwogIGNoaWxkLnN0ZG91dC5vbignZGF0YScsICh2KSA9PiB7CiAgICBzdGRvdXQgKz0gdgogIH0pCiAgY2hpbGQuc3RkZXJyLm9uKCdkYXRhJywgKHYpID0+IHsKICAgIHN0ZGVyciArPSB2CiAgfSkKICBhd2FpdCBuZXcgUHJvbWlzZSgoYWNjZXB0LCByZWplY3QpID0+IHsKICAgIGNoaWxkLm9uY2UoJ2Vycm9yJywgcmVqZWN0KQogICAgY2hpbGQub25jZSgnZXhpdCcsIChjb2RlKSA9PgogICAgICBjb2RlID09PSAwCiAgICAgICAgPyBhY2NlcHQoKQogICAgICAgIDogcmVqZWN0KG5ldyBFcnJvcihgJHtmaWxlfSBleGl0ZWQgJHtjb2RlfTogJHtzdGRlcnIuc2xpY2UoLTEyMDApfWApKQogICAgKQogIH0pCiAgcmV0dXJuIHN0ZG91dAp9CmV4cG9ydCBhc3luYyBmdW5jdGlvbiBuYXRpdmVTZXJ2aWNlcyh7CiAgc3RhdGUsCiAgYmluYXJpZXMsCiAgc2NoZW1hRGlyZWN0b3J5LAogIGxpYnJhcnlQYXRoLAogIGNvbmZpbmUgPSAoZmlsZSwgYXJncykgPT4gW2ZpbGUsIGFyZ3NdCn0pIHsKICBzdGF0ZSA9IHJlc29sdmUoc3RhdGUpCiAgYXdhaXQgbWtkaXIoc3RhdGUsIHsgcmVjdXJzaXZlOiB0cnVlLCBtb2RlOiAwbzcwMCB9KQogIGNvbnN0IGluZm8gPSBhd2FpdCBsc3RhdChzdGF0ZSkKICBpZiAoCiAgICBpbmZvLmlzU3ltYm9saWNMaW5rKCkgfHwKICAgICh0eXBlb2YgcHJvY2Vzcy5nZXR1aWQgPT09ICdmdW5jdGlvbicgJiYgaW5mby51aWQgIT09IHByb2Nlc3MuZ2V0dWlkKCkpIHx8CiAgICAoaW5mby5tb2RlICYgMG8wNzcpICE9PSAwCiAgKQogICAgdGhyb3cgbmV3IEVycm9yKCdTdGF0ZSBkaXJlY3RvcnkgbXVzdCBiZSBwcml2YXRlJykKICBjb25zdCBsb2NrUGF0aCA9IGpvaW4oc3RhdGUsICdydW5uaW5nLmxvY2snKQogIC8vIE5ldmVyIHJlY292ZXIgYSBzdGFsZSBsb2NrIGJ5IGd1ZXNzaW5nIHdoaWNoIHByb2Nlc3Mgb3ducyBpdC4KICBjb25zdCBzY2hlbWFIYXNoID0gY3JlYXRlSGFzaCgnc2hhMjU2JykKICAgIC51cGRhdGUoYXdhaXQgcmVhZEZpbGUoam9pbihzY2hlbWFEaXJlY3RvcnksICdjYW5vbmljYWwtb2JqZWN0cy5zcWwnKSkpCiAgICAudXBkYXRlKGF3YWl0IHJlYWRGaWxlKGpvaW4oc2NoZW1hRGlyZWN0b3J5LCAnYXV0aG9yaXR5LnNxbCcpKSkKICAgIC5kaWdlc3QoJ2hleCcpCiAgYXdhaXQgd3JpdGVGaWxlKGxvY2tQYXRoLCBTdHJpbmcocHJvY2Vzcy5waWQpLCB7IGZsYWc6ICd3eCcsIG1vZGU6IDBvNjAwIH0pCiAgbGV0IG5lZWRzU2NoZW1hID0gdHJ1ZQogIHRyeSB7CiAgICBpZiAoKGF3YWl0IHJlYWRGaWxlKGpvaW4oc3RhdGUsICdzY2hlbWEtdmVyc2lvbicpLCAndXRmOCcpKSAhPT0gc2NoZW1hSGFzaCkKICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbmNvbXBhdGlibGUgbG9jYWwgc2NoZW1hOyBhY3RpdmF0aW9uIHJlZnVzZWQnKQogICAgbmVlZHNTY2hlbWEgPSBmYWxzZQogIH0gY2F0Y2ggKGVycm9yKSB7CiAgICBpZiAoZXJyb3IuY29kZSAhPT0gJ0VOT0VOVCcpIHsKICAgICAgYXdhaXQgKGF3YWl0IGltcG9ydCgnbm9kZTpmcy9wcm9taXNlcycpKS51bmxpbmsobG9ja1BhdGgpCiAgICAgIHRocm93IGVycm9yCiAgICB9CiAgfQogIGNvbnN0IGNoaWxkcmVuID0gW10KICAvLyBDb25maW5lbWVudCBtYXkgZXhlYyB0aHJvdWdoIGEgd3JhcHBlciAodGhlIHF1YWxpZmljYXRpb24gbmV0d29yayBwb2xpY3kpLAogIC8vIHNvIHRoZSBzaHV0ZG93biBzaWduYWwgZm9sbG93cyB0aGUgbG9naWNhbCBiaW5hcnksIG5vdCB0aGUgc3Bhd25lZCBvbmUuCiAgY29uc3QgbG9naWNhbCA9IG5ldyBXZWFrTWFwKCkKICBjb25zdCBleGVjID0gKGZpbGUsIGFyZ3MsIG9wdGlvbnMpID0+IHJ1biguLi5jb25maW5lKGZpbGUsIGFyZ3MpLCBvcHRpb25zKQogIGNvbnN0IHsgdW5saW5rIH0gPSBhd2FpdCBpbXBvcnQoJ25vZGU6ZnMvcHJvbWlzZXMnKQogIGNvbnN0IG9uSW50ZXJydXB0ID0gKCkgPT4gewogICAgdm9pZCBzdG9wKCkuZmluYWxseSgoKSA9PiBwcm9jZXNzLmV4aXQoMTMwKSkKICB9CiAgcHJvY2Vzcy5vbmNlKCdTSUdJTlQnLCBvbkludGVycnVwdCkKICBwcm9jZXNzLm9uY2UoJ1NJR1RFUk0nLCBvbkludGVycnVwdCkKICBsZXQgc3RvcHBpbmcgPSBmYWxzZQogIGxldCBzdG9wUHJvbWlzZQogIGxldCBmYXVsdAogIGNvbnN0IHN0b3AgPSAoKSA9PiB7CiAgICBpZiAoc3RvcFByb21pc2UpIHJldHVybiBzdG9wUHJvbWlzZQogICAgc3RvcHBpbmcgPSB0cnVlCiAgICBwcm9jZXNzLnJlbW92ZUxpc3RlbmVyKCdTSUdJTlQnLCBvbkludGVycnVwdCkKICAgIHByb2Nlc3MucmVtb3ZlTGlzdGVuZXIoJ1NJR1RFUk0nLCBvbkludGVycnVwdCkKICAgIHN0b3BQcm9taXNlID0gKGFzeW5jICgpID0+IHsKICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBbLi4uY2hpbGRyZW5dLnJldmVyc2UoKSkgewogICAgICAgIGlmIChjaGlsZC5leGl0Q29kZSAhPT0gbnVsbCB8fCBjaGlsZC5zaWduYWxDb2RlICE9PSBudWxsKSBjb250aW51ZQogICAgICAgIGNvbnN0IGV4aXRlZCA9IG5ldyBQcm9taXNlKChhY2NlcHQpID0+IGNoaWxkLm9uY2UoJ2V4aXQnLCBhY2NlcHQpKQogICAgICAgIC8vIFBvc3RncmVTUUwgdHJlYXRzIFNJR1RFUk0gYXMgYSBzbWFydCBzaHV0ZG93biB0aGF0IHdhaXRzIGZvciBjbGllbnRzOwogICAgICAgIC8vIFNJR0lOVCBpcyBpdHMgZmFzdCBzaHV0ZG93biwgc28gaXQgaXMgbm90IFNJR0tJTExlZCBpbnRvIHJlY292ZXJ5LgogICAgICAgIGNoaWxkLmtpbGwoCiAgICAgICAgICBsb2dpY2FsLmdldChjaGlsZCkgPT09IGJpbmFyaWVzLnBvc3RncmVzID8gJ1NJR0lOVCcgOiAnU0lHVEVSTScKICAgICAgICApCiAgICAgICAgYXdhaXQgUHJvbWlzZS5yYWNlKFtleGl0ZWQsIGRlbGF5KDUwMDAsIHVuZGVmaW5lZCwgeyByZWY6IGZhbHNlIH0pXSkKICAgICAgICBpZiAoY2hpbGQuZXhpdENvZGUgPT09IG51bGwgJiYgY2hpbGQuc2lnbmFsQ29kZSA9PT0gbnVsbCkgewogICAgICAgICAgY2hpbGQua2lsbCgnU0lHS0lMTCcpCiAgICAgICAgICBhd2FpdCBleGl0ZWQKICAgICAgICB9CiAgICAgIH0KICAgICAgYXdhaXQgdW5saW5rKGxvY2tQYXRoKS5jYXRjaCgoKSA9PiB7fSkKICAgIH0pKCkKICAgIHJldHVybiBzdG9wUHJvbWlzZQogIH0KICB0cnkgewogICAgbGV0IGNyZWRlbnRpYWxzCiAgICB0cnkgewogICAgICBjcmVkZW50aWFscyA9IEpTT04ucGFyc2UoCiAgICAgICAgYXdhaXQgcmVhZEZpbGUoam9pbihzdGF0ZSwgJ2NyZWRlbnRpYWxzLmpzb24nKSwgJ3V0ZjgnKQogICAgICApCiAgICB9IGNhdGNoIChlcnJvcikgewogICAgICBpZiAoZXJyb3IuY29kZSAhPT0gJ0VOT0VOVCcpIHRocm93IGVycm9yCiAgICAgIGNyZWRlbnRpYWxzID0gewogICAgICAgIG93bmVyOiBzZWNyZXQoKSwKICAgICAgICBhdXRoOiBzZWNyZXQoKSwKICAgICAgICByZXN0OiBzZWNyZXQoKSwKICAgICAgICBqd3Q6IHNlY3JldCgpCiAgICAgIH0KICAgICAgYXdhaXQgd3JpdGVGaWxlKAogICAgICAgIGpvaW4oc3RhdGUsICdjcmVkZW50aWFscy5qc29uJyksCiAgICAgICAgSlNPTi5zdHJpbmdpZnkoY3JlZGVudGlhbHMpLAogICAgICAgIHsgZmxhZzogJ3d4JywgbW9kZTogMG82MDAgfQogICAgICApCiAgICB9CiAgICBpZiAoCiAgICAgIFsnb3duZXInLCAnYXV0aCcsICdyZXN0JywgJ2p3dCddLnNvbWUoCiAgICAgICAgKGtleSkgPT4gIS9eW2EtZjAtOV17NjR9JC8udGVzdChjcmVkZW50aWFsc1trZXldKQogICAgICApCiAgICApCiAgICAgIHRocm93IG5ldyBFcnJvcignQ29ycnVwdCBsb2NhbCBjcmVkZW50aWFsczsgcmVmdXNpbmcgYWN0aXZhdGlvbicpCiAgICBjb25zdCBwb3J0cyA9IHsKICAgICAgZGI6IGF3YWl0IGZyZWVQb3J0KCksCiAgICAgIGF1dGg6IGF3YWl0IGZyZWVQb3J0KCksCiAgICAgIHJlc3Q6IGF3YWl0IGZyZWVQb3J0KCkKICAgIH0KICAgIGNvbnN0IHBnRW52ID0gewogICAgICBQQVRIOiBwcm9jZXNzLmVudi5QQVRILAogICAgICBMQU5HOiAnQy5VVEYtOCcsCiAgICAgIC4uLihsaWJyYXJ5UGF0aCA/IHsgTERfTElCUkFSWV9QQVRIOiBsaWJyYXJ5UGF0aCB9IDoge30pLAogICAgICBQR1BBU1NXT1JEOiBjcmVkZW50aWFscy5vd25lcgogICAgfQogICAgY29uc3QgcHNxbCA9IGFzeW5jIChzcWwpID0+IHsKICAgICAgY29uc3QgcGF0aCA9IGpvaW4oc3RhdGUsIGBjb21tYW5kLSR7cmFuZG9tVVVJRCgpfS5zcWxgKQogICAgICBhd2FpdCB3cml0ZUZpbGUocGF0aCwgc3FsLCB7IG1vZGU6IDBvNjAwIH0pCiAgICAgIHRyeSB7CiAgICAgICAgcmV0dXJuIGF3YWl0IGV4ZWMoCiAgICAgICAgICBiaW5hcmllcy5wc3FsLAogICAgICAgICAgWwogICAgICAgICAgICAnLVgnLAogICAgICAgICAgICAnLXYnLAogICAgICAgICAgICAnT05fRVJST1JfU1RPUD0xJywKICAgICAgICAgICAgJy1oJywKICAgICAgICAgICAgJzEyNy4wLjAuMScsCiAgICAgICAgICAgICctcCcsCiAgICAgICAgICAgIFN0cmluZyhwb3J0cy5kYiksCiAgICAgICAgICAgICctVScsCiAgICAgICAgICAgICdkZXNrdG9wX293bmVyJywKICAgICAgICAgICAgJy1kJywKICAgICAgICAgICAgJ3Bvc3RncmVzJywKICAgICAgICAgICAgJy1BdCcsCiAgICAgICAgICAgICctZicsCiAgICAgICAgICAgIHBhdGgKICAgICAgICAgIF0sCiAgICAgICAgICB7IGVudjogcGdFbnYgfQogICAgICAgICkKICAgICAgfSBmaW5hbGx5IHsKICAgICAgICBhd2FpdCB1bmxpbmsocGF0aCkuY2F0Y2goKCkgPT4ge30pCiAgICAgIH0KICAgIH0KICAgIGNvbnN0IGxhdW5jaCA9ICgKICAgICAgZmlsZSwKICAgICAgYXJncywKICAgICAgZW52LAogICAgICBjd2QgPSBzdGF0ZSwKICAgICAgZXBoZW1lcmFsID0gZmFsc2UsCiAgICAgIG5hdGl2ZUlQQyA9IGZhbHNlLAogICAgICBjb25maW5lZCA9IHRydWUKICAgICkgPT4gewogICAgICBjb25zdCBsb2cgPSBjcmVhdGVXcml0ZVN0cmVhbShqb2luKHN0YXRlLCBgJHtjaGlsZHJlbi5sZW5ndGh9LmxvZ2ApLCB7CiAgICAgICAgbW9kZTogMG82MDAsCiAgICAgICAgZmxhZ3M6ICdhJwogICAgICB9KQogICAgICBjb25zdCBjaGlsZCA9IHNwYXduKC4uLihjb25maW5lZCA/IGNvbmZpbmUoZmlsZSwgYXJncykgOiBbZmlsZSwgYXJnc10pLCB7CiAgICAgICAgY3dkLAogICAgICAgIGVudiwKICAgICAgICBzdGRpbzogbmF0aXZlSVBDCiAgICAgICAgICA/IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZScsICdpcGMnXQogICAgICAgICAgOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXQogICAgICB9KQogICAgICBjaGlsZC5zdGRvdXQucGlwZShsb2cpCiAgICAgIGNoaWxkLnN0ZGVyci5waXBlKGxvZykKICAgICAgY2hpbGQub25jZSgnZXJyb3InLCAoKSA9PiB7fSkKICAgICAgY2hpbGRyZW4ucHVzaChjaGlsZCkKICAgICAgbG9naWNhbC5zZXQoY2hpbGQsIGZpbGUpCiAgICAgIGNoaWxkLm9uY2UoJ2V4aXQnLCAoY29kZSwgc2lnbmFsKSA9PiB7CiAgICAgICAgaWYgKCFzdG9wcGluZyAmJiAoIWVwaGVtZXJhbCB8fCBjb2RlICE9PSAwIHx8IHNpZ25hbCkpIHsKICAgICAgICAgIGZhdWx0ID0gbmV3IEVycm9yKCdBIHByb29mLW93bmVkIHNlcnZpY2UgZmFpbGVkJykKICAgICAgICAgIGZhdWx0LmNvbXBvbmVudCA9IFsKICAgICAgICAgICAgJ3Bvc3RncmVzJywKICAgICAgICAgICAgJ2F1dGgnLAogICAgICAgICAgICAncG9zdGdyZXN0JywKICAgICAgICAgICAgJ25vZGUnLAogICAgICAgICAgICAnRWxlY3Ryb24nCiAgICAgICAgICBdLmluY2x1ZGVzKGJhc2VuYW1lKGZpbGUpKQogICAgICAgICAgICA/IGJhc2VuYW1lKGZpbGUpCiAgICAgICAgICAgIDogJ25hdGl2ZS1zZXJ2aWNlJwogICAgICAgICAgZmF1bHQuZXhpdENvZGUgPSBOdW1iZXIuaXNTYWZlSW50ZWdlcihjb2RlKSA/IGNvZGUgOiBudWxsCiAgICAgICAgICBmYXVsdC5zaWduYWwgPSAvXlNJR1tBLVpdKyQvLnRlc3Qoc2lnbmFsID8/ICcnKSA/IHNpZ25hbCA6IG51bGwKICAgICAgICAgIHZvaWQgc3RvcCgpCiAgICAgICAgfQogICAgICB9KQogICAgICByZXR1cm4gY2hpbGQKICAgIH0KICAgIGNvbnN0IHBnRGF0YSA9IGpvaW4oc3RhdGUsICdwZ2RhdGEnKQogICAgbGV0IGZyZXNoID0gZmFsc2UKICAgIHRyeSB7CiAgICAgIGF3YWl0IHN0YXQoam9pbihwZ0RhdGEsICdQR19WRVJTSU9OJykpCiAgICB9IGNhdGNoIChlcnJvcikgewogICAgICBpZiAoZXJyb3IuY29kZSAhPT0gJ0VOT0VOVCcpIHRocm93IGVycm9yCiAgICAgIGNvbnN0IHBhc3MgPSBqb2luKHN0YXRlLCAnb3duZXItcGFzc3dvcmQnKQogICAgICBhd2FpdCB3cml0ZUZpbGUocGFzcywgY3JlZGVudGlhbHMub3duZXIsIHsgbW9kZTogMG82MDAgfSkKICAgICAgYXdhaXQgZXhlYygKICAgICAgICBiaW5hcmllcy5pbml0ZGIsCiAgICAgICAgWwogICAgICAgICAgJy1EJywKICAgICAgICAgIHBnRGF0YSwKICAgICAgICAgICctVScsCiAgICAgICAgICAnZGVza3RvcF9vd25lcicsCiAgICAgICAgICAnLS1wd2ZpbGUnLAogICAgICAgICAgcGFzcywKICAgICAgICAgICctLWF1dGgtbG9jYWw9c2NyYW0tc2hhLTI1NicsCiAgICAgICAgICAnLS1hdXRoLWhvc3Q9c2NyYW0tc2hhLTI1NicsCiAgICAgICAgICAnLS1lbmNvZGluZz1VVEY4JywKICAgICAgICAgICctLWxvY2FsZT1DJwogICAgICAgIF0sCiAgICAgICAgeyBlbnY6IHBnRW52IH0KICAgICAgKQogICAgICBhd2FpdCB1bmxpbmsocGFzcykKICAgICAgZnJlc2ggPSB0cnVlCiAgICB9CiAgICBjb25zdCBwZyA9IGxhdW5jaCgKICAgICAgYmluYXJpZXMucG9zdGdyZXMsCiAgICAgIFsnLUQnLCBwZ0RhdGEsICctaCcsICcxMjcuMC4wLjEnLCAnLXAnLCBTdHJpbmcocG9ydHMuZGIpLCAnLWsnLCAnJ10sCiAgICAgIHBnRW52CiAgICApCiAgICBjb25zdCByZWFkeSA9IGFzeW5jIChwcm9iZSwgY2hpbGQsIGxhYmVsKSA9PiB7CiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTAwOyBpKyspIHsKICAgICAgICBpZiAoY2hpbGQuZXhpdENvZGUgIT09IG51bGwgfHwgY2hpbGQuc2lnbmFsQ29kZSAhPT0gbnVsbCkKICAgICAgICAgIHRocm93IG5ldyBFcnJvcigKICAgICAgICAgICAgYCR7bGFiZWx9IGV4aXRlZCBiZWZvcmUgcmVhZGluZXNzOyBpbnNwZWN0IHByaXZhdGUgc2VydmljZSBsb2dgCiAgICAgICAgICApCiAgICAgICAgdHJ5IHsKICAgICAgICAgIGF3YWl0IHByb2JlKCkKICAgICAgICAgIHJldHVybgogICAgICAgIH0gY2F0Y2ggewogICAgICAgICAgYXdhaXQgZGVsYXkoMTAwKQogICAgICAgIH0KICAgICAgfQogICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IHJlYWRpbmVzcyB0aW1lZCBvdXRgKQogICAgfQogICAgYXdhaXQgcmVhZHkoKCkgPT4gcHNxbCgnU0VMRUNUIDE7JyksIHBnLCAnUG9zdGdyZVNRTCcpCiAgICBjb25zdCB0b2tlbiA9IHsKICAgICAgYW5vbjogc2lnbmVkVG9rZW4oY3JlZGVudGlhbHMuand0LCAnYW5vbicpLAogICAgICBzZXJ2aWNlOiBzaWduZWRUb2tlbihjcmVkZW50aWFscy5qd3QsICdzZXJ2aWNlX3JvbGUnKQogICAgfQogICAgaWYgKAogICAgICAoCiAgICAgICAgYXdhaXQgcHNxbCgKICAgICAgICAgICJTRUxFQ1QgY291bnQoKikgRlJPTSBwZ19yb2xlcyBXSEVSRSByb2xuYW1lPSdzdXBhYmFzZV9hdXRoX2FkbWluJzsiCiAgICAgICAgKQogICAgICApLnRyaW0oKSA9PT0gJzAnCiAgICApCiAgICAgIGF3YWl0IHBzcWwoYAogICAgICBCRUdJTjsKICAgICAgUkVWT0tFIENSRUFURSBPTiBTQ0hFTUEgcHVibGljIEZST00gUFVCTElDOwogICAgICBDUkVBVEUgUk9MRSBhbm9uIE5PTE9HSU4gTk9CWVBBU1NSTFM7CiAgICAgIENSRUFURSBST0xFIGF1dGhlbnRpY2F0ZWQgTk9MT0dJTiBOT0JZUEFTU1JMUzsKICAgICAgQ1JFQVRFIFJPTEUgc2VydmljZV9yb2xlIE5PTE9HSU4gQllQQVNTUkxTOwogICAgICBDUkVBVEUgUk9MRSBkZXNrdG9wX3JwY19yZWFkZXIgTk9MT0dJTiBOT0JZUEFTU1JMUzsKICAgICAgQ1JFQVRFIFJPTEUgYXV0aGVudGljYXRvciBMT0dJTiBOT0lOSEVSSVQgUEFTU1dPUkQgJyR7Y3JlZGVudGlhbHMucmVzdH0nOwogICAgICBHUkFOVCBhbm9uLGF1dGhlbnRpY2F0ZWQsc2VydmljZV9yb2xlIFRPIGF1dGhlbnRpY2F0b3I7CiAgICAgIENSRUFURSBST0xFIHN1cGFiYXNlX2F1dGhfYWRtaW4gTE9HSU4gTk9JTkhFUklUIFBBU1NXT1JEICcke2NyZWRlbnRpYWxzLmF1dGh9JzsKICAgICAgQ1JFQVRFIFNDSEVNQSBhdXRoIEFVVEhPUklaQVRJT04gc3VwYWJhc2VfYXV0aF9hZG1pbjsKICAgICAgR1JBTlQgVVNBR0UgT04gU0NIRU1BIHB1YmxpYyBUTyBzdXBhYmFzZV9hdXRoX2FkbWluOwogICAgICBDT01NSVQ7CiAgICBgKQogICAgYXdhaXQgcHNxbChgRE8gJCQgQkVHSU4gSUYgTk9UIEVYSVNUUyhTRUxFQ1QgMSBGUk9NIHBnX3JvbGVzIFdIRVJFIHJvbG5hbWU9J3Bvc3RncmVzJykgVEhFTiBDUkVBVEUgUk9MRSBwb3N0Z3JlcyBOT0xPR0lOIE5PQllQQVNTUkxTOyBFTkQgSUY7IEVORCAkJDsKICAgICAgQUxURVIgUk9MRSBzdXBhYmFzZV9hdXRoX2FkbWluIFNFVCBzZWFyY2hfcGF0aD1hdXRoOwogICAgICBETyAkJCBCRUdJTiBJRiB0b19yZWdwcm9jZWR1cmUoJ2F1dGgudWlkKCknKSBJUyBOT1QgTlVMTCBUSEVOIEFMVEVSIEZVTkNUSU9OIGF1dGgudWlkKCkgT1dORVIgVE8gc3VwYWJhc2VfYXV0aF9hZG1pbjsgRU5EIElGOyBJRiB0b19yZWdwcm9jZWR1cmUoJ2F1dGguand0KCknKSBJUyBOT1QgTlVMTCBUSEVOIEFMVEVSIEZVTkNUSU9OIGF1dGguand0KCkgT1dORVIgVE8gc3VwYWJhc2VfYXV0aF9hZG1pbjsgRU5EIElGOyBFTkQgJCQ7YCkKICAgIGNvbnN0IGF1dGhFbnYgPSB7CiAgICAgIFBBVEg6IHByb2Nlc3MuZW52LlBBVEgsCiAgICAgIExBTkc6ICdDLlVURi04JywKICAgICAgR09UUlVFX0FQSV9IT1NUOiAnMTI3LjAuMC4xJywKICAgICAgUE9SVDogU3RyaW5nKHBvcnRzLmF1dGgpLAogICAgICBBUElfRVhURVJOQUxfVVJMOiBgaHR0cDovLzEyNy4wLjAuMToke3BvcnRzLmF1dGh9YCwKICAgICAgR09UUlVFX1NJVEVfVVJMOiAnaHR0cDovLzEyNy4wLjAuMScsCiAgICAgIEdPVFJVRV9EQl9EUklWRVI6ICdwb3N0Z3JlcycsCiAgICAgIEdPVFJVRV9EQl9EQVRBQkFTRV9VUkw6IGBwb3N0Z3JlczovL3N1cGFiYXNlX2F1dGhfYWRtaW46JHtjcmVkZW50aWFscy5hdXRofUAxMjcuMC4wLjE6JHtwb3J0cy5kYn0vcG9zdGdyZXNgLAogICAgICBHT1RSVUVfREJfTkFNRVNQQUNFOiAnYXV0aCcsCiAgICAgIERCX05BTUVTUEFDRTogJ2F1dGgnLAogICAgICBHT1RSVUVfSldUX1NFQ1JFVDogY3JlZGVudGlhbHMuand0LAogICAgICBHT1RSVUVfSldUX0FVRDogJ2F1dGhlbnRpY2F0ZWQnLAogICAgICBHT1RSVUVfSldUX0RFRkFVTFRfR1JPVVBfTkFNRTogJ2F1dGhlbnRpY2F0ZWQnLAogICAgICBHT1RSVUVfSldUX0FETUlOX1JPTEVTOiAnc2VydmljZV9yb2xlJywKICAgICAgR09UUlVFX0RJU0FCTEVfU0lHTlVQOiAndHJ1ZScsCiAgICAgIEdPVFJVRV9FWFRFUk5BTF9FTUFJTF9FTkFCTEVEOiAndHJ1ZScsCiAgICAgIEdPVFJVRV9FWFRFUk5BTF9QSE9ORV9FTkFCTEVEOiAnZmFsc2UnLAogICAgICBHT1RSVUVfTUFJTEVSX0FVVE9DT05GSVJNOiAndHJ1ZScsCiAgICAgIEdPVFJVRV9MT0dfTEVWRUw6ICd3YXJuJwogICAgfQogICAgYXdhaXQgZXhlYyhiaW5hcmllcy5hdXRoLCBbJ21pZ3JhdGUnXSwgewogICAgICBlbnY6IGF1dGhFbnYsCiAgICAgIGN3ZDogYmluYXJpZXMuYXV0aEN3ZAogICAgfSkKICAgIGNvbnN0IGF1dGggPSBsYXVuY2goYmluYXJpZXMuYXV0aCwgWydzZXJ2ZSddLCBhdXRoRW52LCBiaW5hcmllcy5hdXRoQ3dkKQogICAgYXdhaXQgcmVhZHkoCiAgICAgIGFzeW5jICgpID0+IHsKICAgICAgICBjb25zdCByID0gYXdhaXQgZmV0Y2goYGh0dHA6Ly8xMjcuMC4wLjE6JHtwb3J0cy5hdXRofS9oZWFsdGhgLCB7CiAgICAgICAgICBzaWduYWw6IEFib3J0U2lnbmFsLnRpbWVvdXQoMjAwMCkKICAgICAgICB9KQogICAgICAgIGlmICghci5vaykgdGhyb3cgRXJyb3IoJ0F1dGggbm90IHJlYWR5JykKICAgICAgfSwKICAgICAgYXV0aCwKICAgICAgJ0F1dGgnCiAgICApCiAgICBpZiAobmVlZHNTY2hlbWEpIHsKICAgICAgLy8gVGhlIG5hdGl2ZSBBdXRoIHJlbGVhc2Ugc3VwcGxpZXMgaXRzIG93biB2ZXJzaW9uZWQgc2NoZW1hIG1pZ3JhdGlvbnMuCiAgICAgIGF3YWl0IHBzcWwoCiAgICAgICAgJ0JFR0lOO1xuJyArCiAgICAgICAgICAoYXdhaXQgcmVhZEZpbGUoCiAgICAgICAgICAgIGpvaW4oc2NoZW1hRGlyZWN0b3J5LCAnY2Fub25pY2FsLW9iamVjdHMuc3FsJyksCiAgICAgICAgICAgICd1dGY4JwogICAgICAgICAgKSkgKwogICAgICAgICAgJ1xuJyArCiAgICAgICAgICAoYXdhaXQgcmVhZEZpbGUoam9pbihzY2hlbWFEaXJlY3RvcnksICdhdXRob3JpdHkuc3FsJyksICd1dGY4JykpICsKICAgICAgICAgICdcbkNPTU1JVDsnCiAgICAgICkKICAgICAgYXdhaXQgd3JpdGVGaWxlKGpvaW4oc3RhdGUsICdzY2hlbWEtdmVyc2lvbicpLCBzY2hlbWFIYXNoLCB7CiAgICAgICAgbW9kZTogMG82MDAsCiAgICAgICAgZmxhZzogJ3d4JwogICAgICB9KQogICAgfQogICAgY29uc3QgcmVzdCA9IGxhdW5jaChiaW5hcmllcy5wb3N0Z3Jlc3QsIFtdLCB7CiAgICAgIFBBVEg6IHByb2Nlc3MuZW52LlBBVEgsCiAgICAgIFBHUlNUX0RCX1VSSTogYHBvc3RncmVzOi8vYXV0aGVudGljYXRvcjoke2NyZWRlbnRpYWxzLnJlc3R9QDEyNy4wLjAuMToke3BvcnRzLmRifS9wb3N0Z3Jlc2AsCiAgICAgIFBHUlNUX0RCX1NDSEVNQVM6ICdwdWJsaWMnLAogICAgICBQR1JTVF9EQl9BTk9OX1JPTEU6ICdhbm9uJywKICAgICAgUEdSU1RfSldUX1NFQ1JFVDogY3JlZGVudGlhbHMuand0LAogICAgICBQR1JTVF9TRVJWRVJfSE9TVDogJzEyNy4wLjAuMScsCiAgICAgIFBHUlNUX1NFUlZFUl9QT1JUOiBTdHJpbmcocG9ydHMucmVzdCksCiAgICAgIFBHUlNUX0xPR19MRVZFTDogJ3dhcm4nCiAgICB9KQogICAgYXdhaXQgcmVhZHkoCiAgICAgIGFzeW5jICgpID0+IHsKICAgICAgICBjb25zdCByID0gYXdhaXQgZmV0Y2goYGh0dHA6Ly8xMjcuMC4wLjE6JHtwb3J0cy5yZXN0fS9gLCB7CiAgICAgICAgICBoZWFkZXJzOiB7IEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHt0b2tlbi5zZXJ2aWNlfWAgfSwKICAgICAgICAgIHNpZ25hbDogQWJvcnRTaWduYWwudGltZW91dCgyMDAwKQogICAgICAgIH0pCiAgICAgICAgaWYgKCFyLm9rKSB0aHJvdyBFcnJvcignUG9zdGdSRVNUIG5vdCByZWFkeScpCiAgICAgIH0sCiAgICAgIHJlc3QsCiAgICAgICdQb3N0Z1JFU1QnCiAgICApCiAgICByZXR1cm4gewogICAgICBzdGF0ZSwKICAgICAgcG9ydHMsCiAgICAgIHRva2VuLAogICAgICBwc3FsLAogICAgICBsYXVuY2gsCiAgICAgIGNoaWxkcmVuLAogICAgICBzdG9wLAogICAgICBmcmVzaCwKICAgICAgZ2V0IGZhdWx0KCkgewogICAgICAgIHJldHVybiBmYXVsdAogICAgICB9CiAgICB9CiAgfSBjYXRjaCAoZXJyb3IpIHsKICAgIGF3YWl0IHN0b3AoKQogICAgdGhyb3cgZXJyb3IKICB9Cn0K'
const defaultComment = 'default administrative connection database'
const cleanEnvironment = () => ({
  PATH: '/usr/bin:/bin',
  LANG: 'C.UTF-8',
  PGPASSFILE: '/dev/null',
  PGSERVICEFILE: '/dev/null',
  PGCONNECT_TIMEOUT: '2'
})
const closings = new WeakMap()
function child(file, args, options = {}) {
  const process_ = spawn(file, args, options)
  closings.set(
    process_,
    new Promise((accept) => {
      process_.once('error', () => {})
      process_.once('close', (code, signal) => accept({ code, signal }))
    })
  )
  return process_
}
async function closedWithin(process_, milliseconds) {
  let timer
  try {
    return await Promise.race([
      closings.get(process_),
      new Promise((accept) => {
        timer = setTimeout(() => accept(null), milliseconds)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
async function stop(process_, signal = 'SIGTERM') {
  if (!process_) return
  if (process_.exitCode === null && process_.signalCode === null)
    process_.kill(signal)
  if (!(await closedWithin(process_, 5000))) {
    process_.kill('SIGKILL')
    requireProof(await closedWithin(process_, 5000))
  }
}
async function capture(
  file,
  args,
  { env = cleanEnvironment(), input, cwd, timeout = 15000 } = {}
) {
  const process_ = child(file, args, {
    env,
    cwd,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const stdout = [],
    stderr = []
  let bytes = 0,
    overflow = false,
    timedOut = false
  for (const [stream, chunks] of [
    [process_.stdout, stdout],
    [process_.stderr, stderr]
  ]) {
    stream.on('data', (part) => {
      bytes += part.length
      if (bytes > 1024 * 1024) {
        overflow = true
        process_.kill('SIGTERM')
      } else chunks.push(part)
    })
  }
  process_.stdin.on('error', () => {})
  process_.stdin.end(input)
  const deadline = setTimeout(() => {
    timedOut = true
    void stop(process_).catch(() => {})
  }, timeout)
  try {
    const result = await closings.get(process_)
    requireProof(result.code === 0 && !result.signal && !overflow && !timedOut)
    return new TextDecoder('utf-8', { fatal: true })
      .decode(Buffer.concat(stdout))
      .trim()
  } catch {
    throw failed()
  } finally {
    clearTimeout(deadline)
  }
}
async function absent(path) {
  try {
    await lstat(path)
    return false
  } catch (error) {
    if (error.code === 'ENOENT') return true
    throw failed()
  }
}
async function privateDirectory(path) {
  const info = await lstat(path)
  requireProof(
    info.isDirectory() &&
      !info.isSymbolicLink() &&
      info.uid === process.getuid() &&
      !(info.mode & 0o077)
  )
}
async function freePort() {
  const server = createServer()
  await new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', accept)
  })
  const port = server.address().port
  await new Promise((accept) => server.close(accept))
  return port
}
async function ready(probe, process_) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    requireProof(process_.exitCode === null && process_.signalCode === null)
    try {
      await probe()
      return
    } catch {}
    await delay(100)
  }
  throw failed()
}
async function credentialsAt(state, create = false) {
  const path = join(state, 'credentials.json')
  if (create)
    await writeFile(
      path,
      JSON.stringify(
        Object.fromEntries(
          ['owner', 'auth', 'rest', 'jwt'].map((key) => [
            key,
            randomBytes(32).toString('hex')
          ])
        )
      ),
      { flag: 'wx', mode: 0o600 }
    )
  const value = JSON.parse(await boundedFile(path, 4096))
  requireProof(
    exactKeys(value, ['owner', 'auth', 'rest', 'jwt']) &&
      Object.values(value).every((item) => hex(item))
  )
  return value
}
async function runActualProof({ admission, output }) {
  let activeGroup = 'admission'
  const startedAt = new Date().toISOString(),
    observations = {}
  let binding
  try {
    const here = dirname(fileURLToPath(import.meta.url)),
      runtime = resolve(here, '../../../..'),
      installed = resolve(runtime, '../../..')
    binding = await verifySchemaProofInstallation({ installed, admission })
    requireProof(
      process.platform === 'darwin' &&
        process.arch === binding.architecture &&
        process.version === 'v22.23.3' &&
        process.getuid() !== 0 &&
        (await realpath(process.execPath)) ===
          (await realpath(join(runtime, 'bin/node')))
    )
    const lock = process.env.TA_MAC_GUARD_LOCK
    requireProof(
      isAbsolute(lock ?? '') &&
        isAbsolute(output) &&
        dirname(output) === dirname(lock) &&
        output === join(dirname(lock), 'schema-bootstrap-proof.json') &&
        (await absent(output))
    )
    const proofRoot = dirname(lock)
    await privateDirectory(proofRoot)
    const lockInfo = await lstat(lock)
    requireProof(
      lockInfo.isFile() &&
        !lockInfo.isSymbolicLink() &&
        lockInfo.uid === process.getuid() &&
        !(lockInfo.mode & 0o077) &&
        lockInfo.nlink === 1
    )
    const binaries = {
      initdb: join(runtime, 'postgres/bin/initdb'),
      postgres: join(runtime, 'postgres/bin/postgres'),
      psql: join(runtime, 'postgres/bin/psql'),
      auth: join(runtime, 'auth/auth'),
      authCwd: join(runtime, 'auth'),
      postgrest: join(runtime, 'postgrest/postgrest')
    }
    for (const name of ['initdb', 'postgres', 'psql'])
      requireProof(
        (await capture(binaries[name], ['--version'])) ===
          name + ' (PostgreSQL) 18.6'
      )
    requireProof(
      /^PostgREST 16\.4(?:\s|$)/u.test(
        await capture(binaries.postgrest, ['--version'])
      )
    )
    const osVersion = await capture('/usr/bin/sw_vers', ['-productVersion'])
    requireProof(/^15(?:\.\d+){0,2}$/u.test(osVersion))
    const { prepareSchemaBootstrap } = await import('./schema-bootstrap.mjs')
    const { nativeServices, signedToken } = await import('./services.mjs')
    const { createPersonalWorkspace } = await import('./workspace.mjs')
    const { syntheticRaidFixture, importSyntheticRaid } =
      await import('../../proof/synthetic-import.mjs')
    const schemaDirectory = join(runtime, 'apps/desktop/local-schema')
    const target = sha(
      Buffer.concat([
        await boundedFile(
          join(schemaDirectory, 'canonical-objects.sql'),
          16 * 1024 * 1024
        ),
        await boundedFile(
          join(schemaDirectory, 'authority.sql'),
          16 * 1024 * 1024
        )
      ])
    )
    const expectedJournal = JSON.stringify({
      format: 'desktop-macos-schema-bootstrap/v1',
      target
    })
    const expectedReceipt = 'desktop-macos-schema:' + target
    const newState = async (name) => {
      const state = join(proofRoot, name)
      await mkdir(state, { mode: 0o700 })
      await privateDirectory(state)
      return state
    }
    const marker = async (state) =>
      (await boundedFile(join(state, 'schema-version'), 64)).toString() ===
      target
    const journal = async (state) =>
      (
        await boundedFile(join(state, 'schema-bootstrap.json'), 256)
      ).toString() === expectedJournal
    const comment = (psql) =>
      psql(
        "SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"
      )
    const withPG = async (state, initialize, action) => {
      const credentials = await credentialsAt(state, initialize),
        port = await freePort()
      const pgEnv = { ...cleanEnvironment(), PGPASSWORD: credentials.owner }
      if (initialize) {
        const password = join(state, 'owner-password')
        await writeFile(password, credentials.owner, {
          flag: 'wx',
          mode: 0o600
        })
        try {
          await capture(
            binaries.initdb,
            [
              '-D',
              join(state, 'pgdata'),
              '-U',
              'desktop_owner',
              '--pwfile',
              password,
              '--auth-local=scram-sha-256',
              '--auth-host=scram-sha-256',
              '--encoding=UTF8',
              '--locale=C'
            ],
            { env: pgEnv }
          )
        } finally {
          await rm(password, { force: true })
        }
      }
      const pg = child(
        binaries.postgres,
        [
          '-D',
          join(state, 'pgdata'),
          '-h',
          '127.0.0.1',
          '-p',
          String(port),
          '-k',
          ''
        ],
        { cwd: state, env: pgEnv, stdio: 'ignore' }
      )
      const psqlArgs = [
        '-X',
        '-w',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        '127.0.0.1',
        '-p',
        String(port),
        '-U',
        'desktop_owner',
        '-d',
        'postgres',
        '-At'
      ]
      const psql = (sql) =>
        capture(binaries.psql, psqlArgs, { input: sql, env: pgEnv })
      try {
        await ready(() => psql('SELECT 1;'), pg)
        return await action({
          state,
          credentials,
          port,
          pgEnv,
          psqlArgs,
          psql
        })
      } finally {
        await stop(pg, 'SIGINT')
        requireProof(await absent(join(state, 'pgdata/postmaster.pid')))
      }
    }
    const withAuth = async (db, action) => {
      const authPort = await freePort(),
        credentials = db.credentials
      // Fixture-only prerequisites mirror nativeServices before application SQL.
      // The Auth schema itself is produced only by the actual bundled migrator.
      await db.psql(
        [
          'BEGIN; REVOKE CREATE ON SCHEMA public FROM PUBLIC;',
          'CREATE ROLE anon NOLOGIN NOBYPASSRLS; CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;',
          'CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE desktop_rpc_reader NOLOGIN NOBYPASSRLS;',
          "CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '" +
            credentials.rest +
            "';",
          'GRANT anon,authenticated,service_role TO authenticator;',
          "CREATE ROLE supabase_auth_admin LOGIN NOINHERIT PASSWORD '" +
            credentials.auth +
            "';",
          'CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;',
          'GRANT USAGE ON SCHEMA public TO supabase_auth_admin; COMMIT;',
          "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres NOLOGIN NOBYPASSRLS; END IF; END $$;",
          'ALTER ROLE supabase_auth_admin SET search_path=auth;'
        ].join('\n')
      )
      const authEnv = {
        PATH: '/usr/bin:/bin',
        LANG: 'C.UTF-8',
        GOTRUE_API_HOST: '127.0.0.1',
        PORT: String(authPort),
        API_EXTERNAL_URL: 'http://127.0.0.1:' + authPort,
        GOTRUE_SITE_URL: 'http://127.0.0.1',
        GOTRUE_DB_DRIVER: 'postgres',
        GOTRUE_DB_DATABASE_URL:
          'postgres://supabase_auth_admin:' +
          credentials.auth +
          '@127.0.0.1:' +
          db.port +
          '/postgres',
        GOTRUE_DB_NAMESPACE: 'auth',
        DB_NAMESPACE: 'auth',
        GOTRUE_JWT_SECRET: credentials.jwt,
        GOTRUE_JWT_AUD: 'authenticated',
        GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
        GOTRUE_JWT_ADMIN_ROLES: 'service_role',
        GOTRUE_DISABLE_SIGNUP: 'true',
        GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
        GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
        GOTRUE_MAILER_AUTOCONFIRM: 'true',
        GOTRUE_LOG_LEVEL: 'warn'
      }
      await capture(binaries.auth, ['migrate'], {
        env: authEnv,
        cwd: binaries.authCwd,
        timeout: 20000
      })
      const auth = child(binaries.auth, ['serve'], {
        env: authEnv,
        cwd: binaries.authCwd,
        stdio: 'ignore'
      })
      try {
        await ready(async () => {
          const response = await fetch(
            'http://127.0.0.1:' + authPort + '/health',
            { signal: AbortSignal.timeout(2000), redirect: 'error' }
          )
          await response.arrayBuffer()
          requireProof(response.ok)
        }, auth)
        return await action({
          ...db,
          ports: { db: db.port, auth: authPort },
          token: { service: signedToken(credentials.jwt, 'service_role') }
        })
      } finally {
        await stop(auth)
      }
    }
    const prepared = async (name, action) => {
      const state = await newState(name),
        preparation = await prepareSchemaBootstrap({ state, schemaDirectory })
      return withPG(state, true, async (db) => {
        requireProof(
          (await comment(db.psql)) === defaultComment && (await journal(state))
        )
        return action({ ...db, preparation })
      })
    }
    const native = async (state, action, factory = nativeServices, calls) => {
      const services = await factory({
        state,
        binaries,
        schemaDirectory,
        confine: (file, args) => {
          if (calls)
            calls.push(
              file === binaries.auth
                ? 'auth'
                : file === binaries.postgrest
                  ? 'rest'
                  : 'database'
            )
          return [file, args]
        }
      })
      try {
        const result = await action(services)
        requireProof(!services.fault)
        return result
      } finally {
        await services.stop()
        requireProof(
          (await absent(join(state, 'running.lock'))) &&
            (await absent(join(state, 'pgdata/postmaster.pid')))
        )
      }
    }
    const seed = async (services) => {
      const subject = await createPersonalWorkspace(services)
      await importSyntheticRaid(services, syntheticRaidFixture(subject))
      const counts = JSON.parse(
        await services.psql(
          'SELECT json_build_object(' +
            "'raids',(SELECT count(*) FROM public.\"EOT_GR_data\"),'players',(SELECT count(*) FROM public.player_mapping)," +
            "'guilds',(SELECT count(*) FROM public.guild_config),'owners',(SELECT count(*) FROM auth.users));"
        )
      )
      requireProof(
        counts.raids === 8 &&
          counts.players === 4 &&
          counts.guilds === 3 &&
          counts.owners === 1
      )
    }
    const snapshot = async (services) => ({
      data: sha(
        await services.psql(
          'SELECT jsonb_build_object(' +
            '\'raids\',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public."EOT_GR_data" t),' +
            "'mapping',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.player_mapping t)," +
            "'guilds',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.guild_config t)," +
            "'attestations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.player_identity_attestations t)," +
            "'setup',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.desktop_preview_setup t)," +
            "'owner',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM auth.users t));"
        )
      ),
      credentials: sha(
        await boundedFile(join(services.state, 'credentials.json'), 4096)
      ),
      database: sha(
        await services.psql(
          'SELECT system_identifier::text FROM pg_control_system();'
        )
      ),
      receipt: sha(await comment(services.psql))
    })
    const sameSnapshot = (first, second) =>
      requireProof(JSON.stringify(first) === JSON.stringify(second))
    const expectSchemaRefusal = async (action) => {
      let refused = false
      try {
        await action()
      } catch (error) {
        refused = error?.code === 'ESCHEMA'
      }
      requireProof(refused)
    }
    activeGroup = 'fresh-default-comment'
    await prepared('fresh-module', async (db) => {
      await db.preparation.inspect(db.psql)
      await withAuth(db, async () => {
        await db.preparation.complete(db.psql)
        requireProof(
          (await comment(db.psql)) === expectedReceipt &&
            (await marker(db.state)) &&
            (await absent(join(db.state, 'schema-bootstrap.json')))
        )
        requireProof(
          (await db.psql(
            "SELECT to_regclass('public.player_mapping') IS NOT NULL;"
          )) === 't'
        )
      })
    })
    const freshNative = await newState('fresh-native')
    await native(freshNative, async (services) => {
      requireProof(
        services.fresh === true &&
          (await marker(freshNative)) &&
          (await comment(services.psql)) === expectedReceipt
      )
    })
    observations[activeGroup] = {
      defaultComment: true,
      nativeStartup: true,
      canonicalReceipt: true,
      marker: true,
      journalRetired: true
    }

    activeGroup = 'committed-marker-loss'
    const committed = await newState('committed'),
      before = await native(committed, async (services) => {
        await seed(services)
        return snapshot(services)
      })
    requireProof(await marker(committed))
    await rm(join(committed, 'schema-version'))
    await native(committed, async (services) => {
      sameSnapshot(before, await snapshot(services))
      requireProof(
        (await marker(committed)) &&
          (await absent(join(committed, 'schema-bootstrap.json')))
      )
    })
    await native(committed, async (services) => {
      sameSnapshot(before, await snapshot(services))
      requireProof(await marker(committed))
    })
    observations[activeGroup] = {
      dataPreserved: true,
      credentialsPreserved: true,
      databasePreserved: true,
      recoveredMarker: true,
      secondOpen: true,
      dataSha256: before.data,
      credentialsSha256: before.credentials,
      databaseSha256: before.database
    }

    activeGroup = 'post-commit-filesystem-denial'
    let deniedState, deniedSnapshot
    await prepared('commit-denied', async (db) => {
      deniedState = db.state
      await db.preparation.inspect(db.psql)
      await withAuth(db, async (services) => {
        let committedSQL = false
        await chmod(db.state, 0o500)
        try {
          await expectSchemaRefusal(() =>
            db.preparation.complete(async (sql) => {
              const result = await db.psql(sql)
              committedSQL = true
              return result
            })
          )
        } finally {
          await chmod(db.state, 0o700)
        }
        requireProof(
          committedSQL &&
            (await comment(db.psql)) === expectedReceipt &&
            (await absent(join(db.state, 'schema-version'))) &&
            (await journal(db.state))
        )
        await seed(services)
        deniedSnapshot = await snapshot(services)
      })
    })
    await native(deniedState, async (services) => {
      sameSnapshot(deniedSnapshot, await snapshot(services))
      requireProof(
        (await marker(deniedState)) &&
          (await absent(join(deniedState, 'schema-bootstrap.json')))
      )
    })
    observations[activeGroup] = {
      commitObserved: true,
      markerWriteRefused: true,
      journalPreserved: true,
      recovered: true,
      conserved: true
    }

    activeGroup = 'actual-bootstrap-rollback'
    let rollbackState,
      latched = false,
      backendTerminated = false,
      nonzeroClientExit = false
    await prepared('actual-rollback', async (db) => {
      rollbackState = db.state
      await db.preparation.inspect(db.psql)
      await withAuth(db, async () => {
        await expectSchemaRefusal(() =>
          db.preparation.complete(async (sql) => {
            const fence = schemaBootstrapRollbackFence(sql)
            const client = child(binaries.psql, db.psqlArgs, {
              env: { ...db.pgEnv, PGAPPNAME: 'desktop-schema-rollback' },
              stdio: ['pipe', 'ignore', 'ignore']
            })
            client.stdin.on('error', () => {})
            try {
              client.stdin.write(fence.input)
              let pid
              const deadline = Date.now() + 10000
              while (Date.now() < deadline) {
                const values = JSON.parse(
                  await db.psql(
                    "SELECT coalesce(json_agg(json_build_object('pid',pid,'application_name',application_name,'usename',usename,'datname',datname,'state',state,'wait_event',wait_event)),'[]'::json) FROM pg_stat_activity WHERE application_name IN ('desktop-schema-rollback','" +
                      fence.readyApplicationName +
                      "') AND usename='desktop_owner' AND datname='postgres';"
                  )
                )
                pid = schemaBootstrapRollbackBackend(values)
                if (pid) break
                requireProof(
                  client.exitCode === null && client.signalCode === null
                )
                await delay(100)
              }
              requireProof(pid)
              latched = true
              requireProof(
                (await db.psql('SELECT pg_terminate_backend(' + pid + ');')) ===
                  't'
              )
              backendTerminated = true
              const result = await closedWithin(client, 5000)
              requireProof(
                result &&
                  Number.isInteger(result.code) &&
                  result.code !== 0 &&
                  !result.signal
              )
              nonzeroClientExit = true
            } finally {
              client.stdin.destroy()
              await stop(client)
            }
            // The real transport failed; this is never a fabricated SQL result.
            throw failed()
          })
        )
        requireProof(latched && backendTerminated && nonzeroClientExit)
        requireProof(
          (await db.psql(
            "SELECT to_regclass('public.player_mapping') IS NULL;"
          )) === 't' &&
            (await comment(db.psql)) === defaultComment &&
            (await journal(db.state)) &&
            (await absent(join(db.state, 'schema-version')))
        )
      })
    })
    await native(rollbackState, async (services) => {
      requireProof(
        (await marker(rollbackState)) &&
          (await comment(services.psql)) === expectedReceipt
      )
    })
    observations[activeGroup] = {
      latched: true,
      backendTerminated: true,
      nonzeroClientExit: true,
      schemaRolledBack: true,
      journalPreserved: true,
      resumed: true
    }

    activeGroup = 'genuine-legacy-workspace'
    const legacyBytes = Buffer.from(legacyServicesBase64, 'base64')
    requireProof(sha(legacyBytes) === legacyServicesSha256)
    const legacyServices = (
      await import('data:text/javascript;base64,' + legacyServicesBase64)
    ).nativeServices
    const legacy = await newState('legacy'),
      legacyBefore = await native(
        legacy,
        async (services) => {
          await seed(services)
          requireProof(
            (await marker(legacy)) &&
              (await comment(services.psql)) === defaultComment &&
              (await absent(join(legacy, 'schema-bootstrap.json')))
          )
          return snapshot(services)
        },
        legacyServices
      )
    await native(legacy, async (services) => {
      sameSnapshot(legacyBefore, await snapshot(services))
      requireProof(
        (await marker(legacy)) &&
          (await comment(services.psql)) === defaultComment &&
          (await absent(join(legacy, 'schema-bootstrap.json')))
      )
    })
    observations[activeGroup] = {
      legacySourceSha256: legacyServicesSha256,
      markerPreserved: true,
      defaultCommentPreserved: true,
      noJournal: true,
      dataPreserved: true,
      credentialsPreserved: true,
      databasePreserved: true
    }

    const clone = async (source, name) => {
      requireProof(
        (await absent(join(source, 'running.lock'))) &&
          (await absent(join(source, 'pgdata/postmaster.pid')))
      )
      const state = await newState(name)
      await cp(source, state, { recursive: true, verbatimSymlinks: true })
      await privateDirectory(state)
      return state
    }
    const authorityDigest = async (state) => {
      const rows = []
      for (const name of ['schema-version', 'schema-bootstrap.json']) {
        const path = join(state, name)
        if (await absent(path)) {
          rows.push({ name, absent: true })
          continue
        }
        const info = await lstat(path)
        const row = {
          name,
          mode: info.mode,
          links: info.nlink,
          size: info.size
        }
        if (info.isSymbolicLink()) row.link = sha(await readlink(path))
        else if (info.isFile()) row.bytes = sha(await boundedFile(path, 256))
        else row.special = true
        rows.push(row)
      }
      return sha(JSON.stringify(rows))
    }
    activeGroup = 'unknown-and-conflicting-authority'
    const negativeKinds = [
      'legacy-unattributed',
      'marker',
      'truncated-journal',
      'unsupported-journal',
      'journal-target',
      'receipt',
      'symlink',
      'hardlink',
      'fifo',
      'public-mode'
    ]
    for (const kind of negativeKinds) {
      const state = await clone(
        kind === 'legacy-unattributed' ? legacy : committed,
        'refusal-' + kind
      )
      if (kind === 'legacy-unattributed')
        await rm(join(state, 'schema-version'))
      if (kind === 'marker')
        await writeFile(join(state, 'schema-version'), 'f'.repeat(64), {
          mode: 0o600
        })
      if (kind === 'truncated-journal')
        await writeFile(join(state, 'schema-bootstrap.json'), '{"format":', {
          mode: 0o600
        })
      if (kind === 'unsupported-journal')
        await writeFile(
          join(state, 'schema-bootstrap.json'),
          JSON.stringify({
            format: 'desktop-macos-schema-bootstrap/v0',
            target
          }),
          { mode: 0o600 }
        )
      if (kind === 'journal-target')
        await writeFile(
          join(state, 'schema-bootstrap.json'),
          JSON.stringify({
            format: 'desktop-macos-schema-bootstrap/v1',
            target: 'f'.repeat(64)
          }),
          { mode: 0o600 }
        )
      if (kind === 'receipt')
        await withPG(state, false, (db) =>
          db.psql(
            "COMMENT ON DATABASE postgres IS 'synthetic-foreign-schema-receipt';"
          )
        )
      if (kind === 'symlink' || kind === 'hardlink') {
        await rename(
          join(state, 'schema-version'),
          join(state, 'retained-marker')
        )
        if (kind === 'symlink')
          await symlink('retained-marker', join(state, 'schema-version'))
        else
          await link(
            join(state, 'retained-marker'),
            join(state, 'schema-version')
          )
      }
      if (kind === 'fifo') {
        await rm(join(state, 'schema-version'))
        await capture('/usr/bin/mkfifo', [
          '-m',
          '600',
          join(state, 'schema-version')
        ])
      }
      if (kind === 'public-mode')
        await chmod(join(state, 'schema-version'), 0o644)
      const savedAuthority = await authorityDigest(state),
        saved = await withPG(state, false, snapshot),
        calls = []
      await expectSchemaRefusal(() =>
        native(
          state,
          async () => {
            throw failed()
          },
          nativeServices,
          calls
        )
      )
      requireProof(
        !calls.includes('auth') &&
          !calls.includes('rest') &&
          (await absent(join(state, 'running.lock'))) &&
          (await authorityDigest(state)) === savedAuthority
      )
      sameSnapshot(saved, await withPG(state, false, snapshot))
    }
    observations[activeGroup] = {
      negativeCases: 10,
      allRefused: true,
      conserved: true
    }

    activeGroup = 'state-directory-identity'
    for (const kind of ['receipt', 'fresh']) {
      let state, preparation, psql, saved
      if (kind === 'receipt') {
        state = await clone(committed, 'identity-receipt')
        await rm(join(state, 'schema-version'))
        preparation = await prepareSchemaBootstrap({ state, schemaDirectory })
        await withPG(state, false, async (db) => {
          await preparation.inspect(db.psql)
          saved = await snapshot(db)
          psql = db.psql
        })
      } else {
        await prepared('identity-fresh', async (db) => {
          state = db.state
          preparation = db.preparation
          psql = db.psql
          await preparation.inspect(psql)
        })
      }
      const original = state + '-retained',
        entries = (await readdir(state)).sort(),
        credentialsDigest = sha(
          await boundedFile(join(state, 'credentials.json'), 4096)
        ),
        savedAuthority = await authorityDigest(state)
      await rename(state, original)
      await mkdir(state, { mode: 0o700 })
      let sqlAttempted = false
      await expectSchemaRefusal(() =>
        preparation.complete((sql) => {
          sqlAttempted = true
          return psql(sql)
        })
      )
      requireProof(
        !sqlAttempted && (await authorityDigest(original)) === savedAuthority
      )
      requireProof(
        (await readdir(state)).length === 0 &&
          JSON.stringify((await readdir(original)).sort()) ===
            JSON.stringify(entries) &&
          sha(await boundedFile(join(original, 'credentials.json'), 4096)) ===
            credentialsDigest &&
          (await absent(join(original, 'schema-version')))
      )
      if (saved) sameSnapshot(saved, await withPG(original, false, snapshot))
    }
    observations[activeGroup] = {
      cases: 2,
      allRefused: true,
      replacementUntouched: true,
      originalPreserved: true
    }

    activeGroup = 'public-catalog-footprint'
    const catalogCases = [
      [
        'collation',
        'CREATE COLLATION public.synthetic_collation FROM pg_catalog."C";',
        "SELECT EXISTS(SELECT 1 FROM pg_collation WHERE collname='synthetic_collation');"
      ],
      [
        'operator',
        'CREATE OPERATOR public.=== (LEFTARG=integer, RIGHTARG=integer, FUNCTION=pg_catalog.int4eq);',
        "SELECT EXISTS(SELECT 1 FROM pg_operator WHERE oprname='===');"
      ],
      [
        'family',
        'CREATE OPERATOR FAMILY public.synthetic_family USING btree;',
        "SELECT EXISTS(SELECT 1 FROM pg_opfamily WHERE opfname='synthetic_family');"
      ],
      [
        'search',
        'CREATE TEXT SEARCH CONFIGURATION public.synthetic_search (COPY=pg_catalog.simple);',
        "SELECT EXISTS(SELECT 1 FROM pg_ts_config WHERE cfgname='synthetic_search');"
      ],
      [
        'defaults',
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC;',
        "SELECT EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace);"
      ]
    ]
    for (const [name, sql, check] of catalogCases) {
      await prepared('catalog-' + name, async (db) => {
        await db.psql(sql)
        await expectSchemaRefusal(() => db.preparation.inspect(db.psql))
        requireProof(
          (await db.psql(check)) === 't' &&
            (await journal(db.state)) &&
            (await absent(join(db.state, 'schema-version')))
        )
      })
    }
    const pgcryptoPresent = !(await absent(
      join(runtime, 'postgres/share/extension/pgcrypto.control')
    ))
    if (pgcryptoPresent) {
      await prepared('catalog-extension', async (db) => {
        await db.psql('CREATE EXTENSION pgcrypto WITH SCHEMA public;')
        await db.preparation.inspect(db.psql)
        await withAuth(db, async () => {
          await db.preparation.complete(db.psql)
          requireProof(await marker(db.state))
        })
      })
    }
    observations[activeGroup] = {
      negativeCases: 5,
      allRefused: true,
      pgcryptoAvailability: pgcryptoPresent ? 'present' : 'absent',
      pgcryptoMembership: pgcryptoPresent ? 'established' : 'not-established'
    }
    const result = schemaBootstrapProofReceipt({
      binding,
      observations,
      runtimes: {
        node: process.versions.node,
        postgres: '18.6',
        auth: '2.197.0',
        postgrest: '16.4'
      },
      startedAt,
      completedAt: new Date().toISOString()
    })
    result.osVersion = osVersion
    result.runtimeVersionAuthority = {
      node: 'actual-process',
      postgres: 'actual-three-binary-version-check',
      auth: 'inventoried-pinned-build-input-and-real-migrator',
      postgrest: 'actual-binary-version-check'
    }
    await writeFile(output, JSON.stringify(result, null, 2), {
      flag: 'wx',
      mode: 0o600
    })
    return result
  } catch {
    if (
      typeof output === 'string' &&
      isAbsolute(output) &&
      output.endsWith('/schema-bootstrap-proof.json') &&
      typeof process.env.TA_MAC_GUARD_LOCK === 'string' &&
      dirname(output) === dirname(process.env.TA_MAC_GUARD_LOCK)
    ) {
      await writeFile(
        output,
        JSON.stringify(
          {
            schemaVersion: 1,
            synthetic: true,
            status: 'failed',
            failedGroup: Object.hasOwn(groups, activeGroup)
              ? activeGroup
              : 'admission',
            completedGroups: Object.keys(observations).filter((name) =>
              Object.hasOwn(groups, name)
            ),
            sourceCommit: binding?.sourceCommit ?? null,
            artifactSha256: binding?.artifactSha256 ?? null,
            startedAt,
            completedAt: new Date().toISOString(),
            actualInstalledMacRecovery: false
          },
          null,
          2
        ),
        { flag: 'wx', mode: 0o600 }
      ).catch(() => {})
    }
    throw failed()
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.umask(0o077)
  try {
    requireProof(process.argv.length === 4)
    const admission = JSON.parse(
      await boundedFile(resolve(process.argv[2]), 16384)
    )
    await runActualProof({ admission, output: resolve(process.argv[3]) })
  } catch {
    process.exitCode = 1
  }
}
