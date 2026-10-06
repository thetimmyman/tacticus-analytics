import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createWorkspace,
  checkWorkspace,
  withWorkspaceLock
} from './workspace.mjs'
import {
  validateFixture,
  validateEvidence,
  portableName,
  scenarios
} from './contracts/validate.mjs'
import { assertNoCanaries, fixtureServer, sha256 } from './fixtures.mjs'

export const expectedResults = Object.freeze({
  'clean-install':
    'Ordinary installation and launch require no developer runtime.',
  onboarding:
    'Player validation enables personal content; optional scopes unlock only covered features.',
  'offline-core':
    'Installed application reads, writes and calculates with external networking blocked.',
  'restart-persistence':
    'Previously saved synthetic data and calculations survive an ordinary restart.',
  'token-expiry':
    'Expired access shows a recoverable holding state while local data remains readable.',
  'shutdown-recovery':
    'Abrupt process termination preserves documented local data guarantees.',
  'backup-restore':
    'Stopped-state backup restores documented local data without credentials.',
  'bad-update':
    'Tampered or incompatible updates are rejected without damaging existing data.',
  'opt-in-egress':
    'Only separately consented scopes leave the device; canaries never reach forbidden egress.',
  'suspend-resume':
    'Platform lifecycle suspension and resume preserve local state and respect background limits.',
  'disk-pressure':
    'Bounded storage exhaustion yields recoverable errors without silent data loss.',
  'upgrade-rollback':
    'Interrupted upgrades recover and supported rollback preserves documented data guarantees.',
  uninstall:
    'Ordinary removal stops owned services and follows the documented data retention policy.'
})
export async function fileDigest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
function validatePlan(plan) {
  const fields = [
    'schemaVersion',
    'evidenceKind',
    'build',
    'environment',
    'labRoot',
    'fixture',
    'scenarios',
    'adapter'
  ]
  if (
    !plan ||
    Object.keys(plan).some((key) => !fields.includes(key)) ||
    fields.some((key) => !Object.hasOwn(plan, key)) ||
    plan.schemaVersion !== 'platform-plan/v1' ||
    !Array.isArray(plan.scenarios) ||
    !plan.scenarios.length ||
    plan.scenarios.length > scenarios.length ||
    new Set(plan.scenarios).size !== plan.scenarios.length ||
    plan.scenarios.some((id) => !scenarios.includes(id))
  )
    throw new Error('Invalid private lab plan')
  validateFixture(plan.fixture)
  if (
    !plan.build ||
    Object.keys(plan.build).some(
      (key) => !['sha', 'artifactPath', 'format'].includes(key)
    )
  )
    throw new Error('Invalid artifact configuration')
  if (
    !isAbsolute(plan.labRoot) ||
    (plan.build.artifactPath !== null && !isAbsolute(plan.build.artifactPath))
  )
    throw new Error('Private lab and artifact paths must be absolute')
  if (
    plan.adapter !== null &&
    (!plan.adapter ||
      typeof plan.adapter.modulePath !== 'string' ||
      Object.keys(plan.adapter).some(
        (key) => !['modulePath', 'options'].includes(key)
      ))
  )
    throw new Error('Invalid adapter configuration')
  if (plan.adapter && !isAbsolute(plan.adapter.modulePath))
    throw new Error('Adapter path must be absolute')
  validateEvidence({
    schemaVersion: 'platform-evidence/v1',
    evidenceKind: plan.evidenceKind,
    runId: 'plan-validation',
    build: {
      sha: plan.build.sha,
      artifact: plan.build.artifactPath
        ? { sha256: '0'.repeat(64), format: plan.build.format }
        : null
    },
    environment: plan.environment,
    fixture: { id: plan.fixture.fixtureId, sha256: '0'.repeat(64) },
    scenario: {
      id: plan.scenarios[0],
      expected: 'Private plan contract check.'
    },
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:00.000Z',
    outcome: {
      status: 'blocked',
      actual: 'Private plan validation only.',
      blockers: ['Execution has not started.']
    },
    assertions: [],
    attachments: []
  })
  return plan
}
export async function runPlan(input) {
  const plan = validatePlan(input)
  const artifact = plan.build.artifactPath
    ? {
        sha256: await fileDigest(plan.build.artifactPath),
        format: plan.build.format
      }
    : null
  const workspace = await createWorkspace(plan.labRoot)
  const fixtureText = JSON.stringify(plan.fixture, null, 2) + '\n'
  await writeFile(join(workspace, 'fixtures', 'fixture.json'), fixtureText, {
    mode: 0o600
  })
  let adapter = null
  if (plan.adapter) {
    const adapterModule = await import(
      pathToFileURL(plan.adapter.modulePath).href
    )
    adapter = adapterModule.createAdapter
      ? await adapterModule.createAdapter(plan.adapter.options ?? {})
      : adapterModule.default
    if (
      adapter?.schemaVersion !== 'platform-adapter/v1' ||
      typeof adapter.run !== 'function' ||
      !Array.isArray(adapter.supportedScenarios) ||
      adapter.supportedScenarios.some((id) => !scenarios.includes(id))
    )
      throw new Error('Adapter does not implement platform-adapter/v1')
  }
  const evidenceDirectory = join(workspace, 'evidence')
  await mkdir(evidenceDirectory, { mode: 0o700 })
  const records = []
  await withWorkspaceLock(workspace, async () => {
    let service
    try {
      if (plan.fixture.network.mode === 'fixture')
        service = await fixtureServer(plan.fixture)
      for (const scenario of plan.scenarios) {
        const startedAt = new Date().toISOString()
        let result = {
          status: 'blocked',
          actual: 'No installed-product adapter executed this scenario.',
          blockers: [
            !artifact
              ? 'Packaged artifact unavailable.'
              : 'Platform adapter does not implement this scenario.'
          ],
          assertions: [],
          captures: []
        }
        if (adapter?.supportedScenarios.includes(scenario) && artifact) {
          try {
            result = await adapter.run({
              scenario,
              fixture: structuredClone(plan.fixture),
              workspace,
              artifactPath: plan.build.artifactPath,
              fixtureOrigin: service?.origin ?? null
            })
            await checkWorkspace(workspace)
            assertNoCanaries(result, plan.fixture.canaries)
          } catch {
            result = {
              status: 'fail',
              actual:
                'Adapter execution or capture safety check failed; inspect private execution diagnostics.',
              blockers: [],
              assertions: [
                {
                  id: 'adapter-safety',
                  status: 'fail',
                  expected:
                    'A bounded safe execution returns observed assertions.',
                  actual: 'Execution or capture validation failed.'
                }
              ],
              captures: []
            }
          }
        }
        const runId = `run-${randomUUID()}`
        const record = {
          schemaVersion: 'platform-evidence/v1',
          evidenceKind: plan.evidenceKind,
          runId,
          build: { sha: plan.build.sha, artifact },
          environment: plan.environment,
          fixture: { id: plan.fixture.fixtureId, sha256: sha256(fixtureText) },
          scenario: { id: scenario, expected: expectedResults[scenario] },
          startedAt,
          completedAt: new Date().toISOString(),
          outcome: {
            status: result.status,
            actual: result.actual,
            blockers: result.blockers
          },
          assertions: result.assertions,
          attachments: []
        }
        validateEvidence(record)
        assertNoCanaries(record, plan.fixture.canaries)
        const captures = result.captures ?? []
        if (!Array.isArray(captures) || captures.length > 20)
          throw new Error('Invalid adapter captures')
        const captureNames = new Set()
        for (const capture of captures) {
          portableName(capture.name)
          if (
            typeof capture.text !== 'string' ||
            capture.text.length > 1024 * 1024 ||
            captureNames.has(capture.name)
          )
            throw new Error('Invalid or duplicate capture')
          captureNames.add(capture.name)
          assertNoCanaries(capture, plan.fixture.canaries)
          const name = `${runId}-${capture.name}`
          // Captures remain private even after synthetic-canary scanning.
          await writeFile(join(workspace, 'captures', name), capture.text, {
            mode: 0o600,
            flag: 'wx'
          })
          record.attachments.push({
            name: capture.name,
            sha256: sha256(capture.text),
            mediaType: capture.mediaType,
            redacted: true
          })
        }
        validateEvidence(record)
        await writeFile(
          join(evidenceDirectory, `${runId}.json`),
          JSON.stringify(record, null, 2) + '\n',
          { mode: 0o600, flag: 'wx' }
        )
        records.push(record)
      }
    } finally {
      await service?.stop()
    }
  })
  return { workspace, records }
}
export async function readPlan(path) {
  const text = await readFile(path, 'utf8')
  if (text.length > 1024 * 1024) throw new Error('Plan exceeds size limit')
  return validatePlan(JSON.parse(text))
}
