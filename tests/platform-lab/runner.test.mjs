import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  realpath,
  writeFile,
  readFile,
  rm,
  readdir
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateFixture, sha256 } from '../../apps/platform-lab/fixtures.mjs'
import { runPlan } from '../../apps/platform-lab/runner.mjs'
import { runOwnedProcess } from '../../apps/platform-lab/process.mjs'
import { buildOfflineCommand } from '../../apps/platform-lab/linux-installed.mjs'

async function setup() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'synthetic-platform-run-'))
  )
  const artifactPath = join(root, 'synthetic-artifact')
  await writeFile(artifactPath, 'synthetic artifact')
  return {
    root,
    plan: {
      schemaVersion: 'platform-plan/v1',
      evidenceKind: 'harness-self-test',
      build: { sha: 'a'.repeat(40), artifactPath, format: 'synthetic' },
      environment: {
        os: 'linux',
        osVersion: 'synthetic',
        arch: 'x64',
        classification: 'vm',
        runtimeVersions: { node: '22.23.3' },
        installation: 'source'
      },
      labRoot: root,
      fixture: generateFixture(),
      scenarios: ['offline-core', 'uninstall'],
      adapter: null
    }
  }
}
test('no adapter yields explicit artifact-bound blockers for every scenario', async () => {
  const { root, plan } = await setup()
  try {
    const result = await runPlan(plan)
    assert.deepEqual(
      result.records.map((record) => record.outcome.status),
      ['blocked', 'blocked']
    )
    assert.equal(
      result.records[0].build.artifact.sha256,
      sha256('synthetic artifact')
    )
    assert.equal((await readdir(join(result.workspace, 'evidence'))).length, 2)
    plan.build.artifactPath = null
    const absent = await runPlan(plan)
    assert.equal(absent.records[0].build.artifact, null)
    assert.match(absent.records[0].outcome.blockers[0], /artifact/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('real fixture-service orchestration executes explicit synthetic adapter; unsupported stays blocked', async () => {
  const { root, plan } = await setup()
  try {
    const modulePath = join(root, 'synthetic-adapter.mjs')
    await writeFile(
      modulePath,
      `export default {
      schemaVersion:'platform-adapter/v1', supportedScenarios:['offline-core'],
      async run({fixtureOrigin}) {
        const response=await fetch(fixtureOrigin+'/fixture/player');
        if(response.status!==200) throw new Error('fixture response failed');
        return {status:'pass',actual:'Synthetic fixture adapter exercised.',blockers:[],
          assertions:[{id:'fixture-http',status:'pass',expected:'Fixture service responds.',actual:'Observed HTTP 200.'}],
          captures:[{name:'synthetic-observation.txt',mediaType:'text/plain',text:'Observed synthetic fixture HTTP 200.'}]};
      }
    }`
    )
    plan.adapter = { modulePath }
    const result = await runPlan(plan)
    assert.deepEqual(
      result.records.map((record) => record.outcome.status),
      ['pass', 'blocked']
    )
    assert.equal(result.records[0].evidenceKind, 'harness-self-test')
    assert.equal(result.records[0].attachments.length, 1)
    const capture = join(
      result.workspace,
      'captures',
      `${result.records[0].runId}-synthetic-observation.txt`
    )
    assert.equal(
      sha256(await readFile(capture)),
      result.records[0].attachments[0].sha256
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('unsafe capture becomes failure without persisting the returned canary', async () => {
  const { root, plan } = await setup()
  try {
    const modulePath = join(root, 'leaky-synthetic-adapter.mjs')
    await writeFile(
      modulePath,
      `export default {schemaVersion:'platform-adapter/v1',supportedScenarios:['offline-core'],async run({fixture}) {
      return {status:'pass',actual:fixture.canaries[0].value,assertions:[],blockers:[],captures:[]};
    }}`
    )
    plan.adapter = { modulePath }
    const result = await runPlan(plan)
    assert.equal(result.records[0].outcome.status, 'fail')
    assert.equal((await readdir(join(result.workspace, 'captures'))).length, 0)
    assert.equal(
      JSON.stringify(result.records).includes(plan.fixture.canaries[0].value),
      false
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('malformed plans cannot execute adapters or mutate a workspace', async () => {
  const { root, plan } = await setup()
  try {
    await assert.rejects(
      runPlan({ ...plan, build: { ...plan.build, sha: 'invalid' } })
    )
    await assert.rejects(runPlan({ ...plan, scenarios: ['invented-scenario'] }))
    await assert.rejects(runPlan({ ...plan, extra: true }))
    assert.deepEqual(await readdir(root), ['synthetic-artifact'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('owned child output and elapsed time are bounded', async () => {
  const normal = await runOwnedProcess(process.execPath, [
    '-e',
    'process.stdout.write("synthetic")'
  ])
  assert.equal(normal.code, 0)
  assert.equal(normal.output, 'synthetic')
  const timed = await runOwnedProcess(
    process.execPath,
    ['-e', 'setTimeout(()=>{},10000)'],
    { timeoutMs: 100 }
  )
  assert.equal(timed.timedOut, true)
  const output = await runOwnedProcess(
    process.execPath,
    ['-e', 'process.stdout.write("x".repeat(10000))'],
    { maxBytes: 100 }
  )
  assert.equal(output.exceeded, true)
  assert.ok(output.output.length <= 100)
})
test('Linux namespace command quotes paths and preserves non-root application identity', () => {
  const args = buildOfflineCommand({
    runtimeRoot: "/synthetic/runtime'with-space",
    state: '/synthetic/state',
    verify: '/synthetic/verify',
    uid: 1000,
    gid: 1000
  })
  assert.equal(args[0], '-rn')
  assert.match(args[4], /--map-user=1000/)
  assert.match(args[4], /networkInterfaces/)
  assert.throws(() =>
    buildOfflineCommand({
      runtimeRoot: '/synthetic',
      state: '/synthetic/state',
      verify: '/synthetic/verify',
      uid: 0,
      gid: 0
    })
  )
})
