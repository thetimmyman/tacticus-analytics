import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import {
  readFile,
  readdir,
  lstat,
  mkdir,
  rmdir,
  writeFile
} from 'node:fs/promises'
import { join } from 'node:path'
import { release } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './services.mjs'
import { nativeCommand } from './native-command.mjs'
import {
  nodeLaunchDiagnostic,
  nativeServicesProbeDiagnostic,
  launchCoordinatorDiagnostic
} from './launch-diagnostic.mjs'

const refused = () =>
  Object.assign(new Error('Installed Windows schema recovery proof refused'), {
    code: 'ESCHEMAPROOF'
  })
const requireProof = (value) => {
  if (!value) throw refused()
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const defaultComment = 'default administrative connection database'
const schemaRefusal = {
  code: 'ESCHEMA',
  message: 'Local schema state is incompatible; activation refused'
}

export function windowsSchemaProofScalar(value) {
  requireProof(typeof value === 'string' && value.length <= 65536)
  const result = value.endsWith('\r\n')
    ? value.slice(0, -2)
    : value.endsWith('\n')
      ? value.slice(0, -1)
      : value
  requireProof(!/[\r\n]/.test(result))
  return result
}

export function windowsSchemaRollbackFence(sql, nonce) {
  const delimiter = '\nDO $receipt$ BEGIN EXECUTE format('
  requireProof(
    typeof sql === 'string' &&
      sql.length <= 33 * 1024 * 1024 &&
      sql.startsWith('BEGIN;') &&
      sql.endsWith('COMMIT;') &&
      sql.indexOf(delimiter) > 0 &&
      sql.indexOf(delimiter) === sql.lastIndexOf(delimiter) &&
      typeof nonce === 'string' &&
      /^[a-f0-9]{16}$/.test(nonce)
  )
  const initialName = 'desktop-bootstrap-' + nonce
  const readyName = initialName + '-ready'
  return {
    initialName,
    readyName,
    input:
      sql.slice(0, sql.indexOf(delimiter)) +
      `\nSET LOCAL application_name='${readyName}';\n`
  }
}

export function windowsSchemaRollbackBackend(rows, fence) {
  requireProof(
    Array.isArray(rows) &&
      rows.length <= 1 &&
      fence &&
      typeof fence.readyName === 'string' &&
      /^desktop-bootstrap-[a-f0-9]{16}-ready$/.test(fence.readyName) &&
      fence.initialName === fence.readyName.slice(0, -6)
  )
  if (!rows.length) return undefined
  const row = rows[0]
  requireProof(
    row &&
      Object.keys(row).sort().join(',') ===
        'application_name,datname,pid,state,usename,wait_event' &&
      Number.isSafeInteger(row.pid) &&
      row.pid > 1 &&
      row.pid <= 2147483647 &&
      ['application_name', 'datname', 'usename', 'state', 'wait_event'].every(
        (key) =>
          row[key] === null ||
          (typeof row[key] === 'string' && row[key].length <= 128)
      )
  )
  return row.application_name === fence.readyName &&
    row.datname === 'postgres' &&
    row.usename === 'desktop_owner' &&
    row.state === 'idle in transaction' &&
    row.wait_event === 'ClientRead'
    ? row.pid
    : undefined
}

export async function windowsSchemaRollbackClientFailure(client, closed) {
  // EOF alone can let psql exit successfully without observing its dead backend.
  client.stdin.end('SELECT 1;\n')
  let timer
  try {
    const result = await Promise.race([
      closed,
      new Promise((accept) => {
        timer = setTimeout(() => accept(null), 5000)
      })
    ])
    requireProof(
      result &&
        Number.isInteger(result.code) &&
        result.code !== 0 &&
        result.signal === null
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function windowsSchemaMarkerBlocker(state) {
  const path = join(state, 'schema-version')
  await mkdir(path) // Exclusive creation: never adopt a preexisting obstruction.
  const identity = await lstat(path, { bigint: true })
  requireProof(
    identity.isDirectory() && !identity.isSymbolicLink() && identity.ino !== 0n
  )
  return async () => {
    const current = await lstat(path, { bigint: true })
    requireProof(
      current.isDirectory() &&
        !current.isSymbolicLink() &&
        current.dev === identity.dev &&
        current.ino === identity.ino &&
        (await readdir(path)).length === 0
    )
    await rmdir(path)
  }
}

const absent = async (path) => {
  try {
    await lstat(path)
    return false
  } catch (error) {
    if (error.code !== 'ENOENT') throw refused()
    return true
  }
}
const scalar = async (psql, sql) => windowsSchemaProofScalar(await psql(sql))
const comment = (psql) =>
  scalar(
    psql,
    "SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"
  )
async function credentialsHash(state) {
  const material = await nativeCommand(['service-material', state])
  requireProof(
    material &&
      Object.keys(material).sort().join(',') === 'auth,jwt,owner,rest' &&
      ['owner', 'auth', 'rest', 'jwt'].every(
        (key) =>
          typeof material[key] === 'string' &&
          /^[a-f0-9]{64}$/.test(material[key])
      )
  )
  return sha(
    JSON.stringify(['owner', 'auth', 'rest', 'jwt'].map((key) => material[key]))
  )
}
async function seed(psql) {
  await psql(`INSERT INTO public."EOT_GR_data" (id,"Guild","Season","userId","damageDealt","encounterId")
VALUES (991701,'SYNBOOT','101','synthetic-bootstrap-player',123,1);`)
}
async function dataHash(psql) {
  const value = await scalar(
    psql,
    'SELECT json_agg(to_jsonb(d) ORDER BY id) FROM public."EOT_GR_data" d;'
  )
  requireProof(value.length <= 65536)
  const rows = JSON.parse(value)
  requireProof(
    Array.isArray(rows) &&
      rows.length === 1 &&
      rows[0].id === 991701 &&
      rows[0].userId === 'synthetic-bootstrap-player' &&
      rows[0].damageDealt === 123
  )
  return sha(value)
}

// Invoked only by the existing native run-candidate owner in a fresh protected
// workspace. Native ownership, token reduction, Job Object and bundle admission
// are unchanged. This function does not qualify an unmanaged Node invocation.
export async function windowsSchemaRecoveryProof(
  config,
  { scenario, evidence, root }
) {
  requireProof(
    process.platform === 'win32' &&
      process.arch === 'x64' &&
      process.version === 'v22.23.2' &&
      ['interrupted-bootstrap', 'committed-marker-refusal'].includes(
        scenario
      ) &&
      typeof evidence === 'string' &&
      typeof root === 'string'
  )
  let stage = 'admission',
    services,
    retiredBlocker,
    admission
  let failedSubstep = 'not-applicable',
    primaryFailed = false
  const observations = {}
  try {
    requireProof(
      (await absent(evidence)) &&
        (await absent(evidence + '.failure.json')) &&
        (await readdir(config.state)).every((name) => name === 'ownership.lock')
    )
    const manifestBytes = await readFile(join(root, 'bundle-manifest.json'))
    requireProof(manifestBytes.length <= 4 * 1024 * 1024)
    const manifest = JSON.parse(manifestBytes)
    requireProof(
      manifest.schemaVersion === 1 &&
        manifest.platform === 'win-x64' &&
        /^[a-f0-9]{40}$/.test(manifest.sourceSha)
    )
    const canonical = await readFile(
      join(config.schemaDirectory, 'canonical-objects.sql')
    )
    const authority = await readFile(
      join(config.schemaDirectory, 'authority.sql')
    )
    requireProof(
      canonical.length > 0 &&
        canonical.length <= 16 * 1024 * 1024 &&
        authority.length > 0 &&
        authority.length <= 16 * 1024 * 1024
    )
    const target = sha(Buffer.concat([canonical, authority]))
    const expectedReceipt = 'desktop-schema:' + target
    admission = {
      sourceSha: manifest.sourceSha,
      manifestSha256: sha(manifestBytes),
      schemaTarget: target
    }
    const expectedJournal = JSON.stringify({
      format: 'desktop-windows-schema-bootstrap/v1',
      target
    })
    const journal = async () =>
      (await readFile(join(config.state, 'schema-bootstrap.json'), 'utf8')) ===
      expectedJournal
    let credentialBefore, dataBefore
    stage = 'fault-window'
    await assert.rejects(
      nativeServices(config, {
        completeSchema: async ({ preparation, psql, openClient }) => {
          credentialBefore = await credentialsHash(config.state)
          requireProof(await journal())
          if (scenario === 'interrupted-bootstrap') {
            await preparation.complete(async (sql) => {
              const fence = windowsSchemaRollbackFence(
                sql,
                randomBytes(8).toString('hex')
              )
              const { client, closed } = openClient(fence.initialName)
              try {
                client.stdin.write(fence.input)
                let pid
                const deadline = performance.now() + 10000
                while (performance.now() < deadline) {
                  const raw = await scalar(
                    psql,
                    "SELECT coalesce(json_agg(json_build_object('pid',pid,'application_name',application_name,'usename',usename,'datname',datname,'state',state,'wait_event',wait_event)),'[]'::json) FROM pg_stat_activity WHERE application_name IN ('" +
                      fence.initialName +
                      "','" +
                      fence.readyName +
                      "') AND usename='desktop_owner' AND datname='postgres';"
                  )
                  requireProof(raw.length <= 4096)
                  const values = JSON.parse(raw)
                  pid = windowsSchemaRollbackBackend(values, fence)
                  if (pid) break
                  requireProof(
                    client.exitCode === null && client.signalCode === null
                  )
                  await delay(100)
                }
                requireProof(pid)
                observations.actualPostPrefixLatch = true
                requireProof(
                  (await scalar(
                    psql,
                    'SELECT pg_terminate_backend(' + pid + ');'
                  )) === 't'
                )
                observations.backendTerminated = true
                await windowsSchemaRollbackClientFailure(client, closed)
                observations.nonzeroClientCloseWithoutSignal = true
              } finally {
                client.stdin.destroy()
              }
              requireProof(
                (await scalar(
                  psql,
                  "SELECT to_regclass('public.player_mapping') IS NULL;"
                )) === 't' &&
                  (await comment(psql)) === defaultComment &&
                  (await journal()) &&
                  (await absent(join(config.state, 'schema-version')))
              )
              observations.actualTransactionRolledBack = true
              throw refused() // The actual failed transport never returns fake SQL success.
            })
          } else {
            await preparation.complete(async (sql) => {
              const result = await psql(sql)
              requireProof((await comment(psql)) === expectedReceipt)
              observations.actualCommittedReceipt = true
              retiredBlocker = await windowsSchemaMarkerBlocker(config.state)
              await seed(psql)
              dataBefore = await dataHash(psql)
              return result
            })
          }
        }
      }),
      schemaRefusal
    )
    requireProof(await journal())
    if (scenario === 'interrupted-bootstrap') {
      requireProof(
        observations.actualTransactionRolledBack &&
          (await absent(join(config.state, 'schema-version')))
      )
    } else {
      requireProof(observations.actualCommittedReceipt && retiredBlocker)
      await retiredBlocker()
      observations.actualMarkerPublicationRefused = true
    }
    stage = 'same-workspace-recovery'
    failedSubstep = 'recovery-native-startup'
    let recoveryBootstrapCalls = 0
    services = await nativeServices(config, {
      completeSchema: ({ preparation, psql }) =>
        preparation.complete(async (sql) => {
          recoveryBootstrapCalls++
          return psql(sql)
        })
    })
    failedSubstep = 'recovery-bootstrap-count'
    requireProof(
      recoveryBootstrapCalls === (scenario === 'interrupted-bootstrap' ? 1 : 0)
    )
    // These are the same ordered, short-circuit conservation checks. Fixed
    // failure labels distinguish their boundary without exporting values.
    failedSubstep = 'recovery-receipt'
    requireProof((await comment(services.psql)) === expectedReceipt)
    failedSubstep = 'recovery-marker'
    requireProof(
      (await readFile(join(config.state, 'schema-version'), 'utf8')) === target
    )
    failedSubstep = 'recovery-journal'
    requireProof(await absent(join(config.state, 'schema-bootstrap.json')))
    failedSubstep = 'recovery-credentials'
    requireProof((await credentialsHash(config.state)) === credentialBefore)
    failedSubstep = 'recovery-postgres-version'
    const postgresVersion = await scalar(services.psql, 'SHOW server_version;')
    requireProof(postgresVersion === '18.6')
    if (scenario === 'interrupted-bootstrap') {
      failedSubstep = 'recovery-seed'
      await seed(services.psql)
      failedSubstep = 'recovery-seed-data'
      dataBefore = await dataHash(services.psql)
    }
    failedSubstep = 'recovery-data-conservation'
    requireProof((await dataHash(services.psql)) === dataBefore)
    failedSubstep = 'recovery-stack-stop'
    await services.stop()
    failedSubstep = 'not-applicable'
    stage = 'second-open-conservation'
    failedSubstep = 'second-open-native-startup'
    let secondOpenBootstrapCalls = 0
    services = await nativeServices(config, {
      completeSchema: ({ preparation, psql }) =>
        preparation.complete(async (sql) => {
          secondOpenBootstrapCalls++
          return psql(sql)
        })
    })
    // Preserve the original short-circuit order and exact predicates. These
    // fixed labels expose only the failing boundary, never compared values.
    failedSubstep = 'second-open-bootstrap-count'
    requireProof(secondOpenBootstrapCalls === 0)
    failedSubstep = 'second-open-data-conservation'
    requireProof((await dataHash(services.psql)) === dataBefore)
    failedSubstep = 'second-open-credentials'
    requireProof((await credentialsHash(config.state)) === credentialBefore)
    failedSubstep = 'second-open-receipt'
    requireProof((await comment(services.psql)) === expectedReceipt)
    failedSubstep = 'second-open-stack-stop'
    await services.stop()
    failedSubstep = 'not-applicable'
    stage = 'receipt'
    await writeFile(
      evidence,
      JSON.stringify(
        {
          schemaVersion: 1,
          platform: 'win-x64',
          native: true,
          synthetic: true,
          completed: true,
          sourceSha: manifest.sourceSha,
          manifestSha256: sha(manifestBytes),
          schemaTarget: target,
          scenario,
          observations,
          recoveryBootstrapCalls,
          secondOpenBootstrapCalls,
          dataSHA256: dataBefore,
          credentialsSHA256: credentialBefore,
          runtime: {
            node: process.version,
            postgres: postgresVersion,
            architecture: process.arch,
            os: release()
          },
          standardConsumerUser: false,
          wholeProcessOfflineQualified: false,
          featureParityClaim: false
        },
        null,
        2
      ),
      { flag: 'wx', mode: 0o600 }
    )
  } catch (error) {
    primaryFailed = true
    await writeFile(
      evidence + '.failure.json',
      JSON.stringify({
        schemaVersion: 1,
        platform: 'win-x64',
        synthetic: true,
        completed: false,
        scenario,
        stage,
        failedSubstep,
        ...(failedSubstep === 'recovery-native-startup'
          ? { startupDiagnostic: nodeLaunchDiagnostic(error) }
          : failedSubstep === 'second-open-native-startup'
            ? {
                startupDiagnostic: launchCoordinatorDiagnostic(
                  error,
                  'services-start'
                )
              }
            : {}),
        ...(stage === 'second-open-conservation'
          ? { failureDiagnostic: nativeServicesProbeDiagnostic(error) }
          : {}),
        ...admission
      }),
      { flag: 'wx', mode: 0o600 }
    ).catch(() => {})
    throw refused()
  } finally {
    try {
      await services?.stop()
    } catch (error) {
      // Cleanup still runs; it cannot replace an already recorded refusal.
      if (!primaryFailed) throw error
    }
  }
}
