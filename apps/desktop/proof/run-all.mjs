import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

/**
 * Entry point for `npm run desktop:proof`. Runs gates (a) and (d)'s
 * self-test for real (no native binaries needed); runs (b)/(c) only when
 * DESKTOP_PROOF_CONFIG points at a real config.json, else reports skipped
 * with the reason rather than fabricating a pass.
 */

const results = []

function run(label, file, args) {
  const result = spawnSync('node', [file, ...args], {
    stdio: 'inherit',
    cwd: new URL('../../..', import.meta.url).pathname
  })
  results.push({ gate: label, exitCode: result.status })
  return result.status === 0
}

console.log(
  '\n== Gate (a): loopback gateway origin/auth/bind-loopback proof =='
)
run('a-loopback-gateway', '--test', [
  'apps/desktop/proof/loopback-gateway.test.mjs',
  'apps/desktop/proof/service-client.test.mjs',
  'apps/desktop/proof/schema-lifecycle.test.mjs',
  'apps/desktop/proof/safe-files.test.mjs',
  'apps/desktop/proof/workspace-selection.test.mjs',
  'apps/desktop/proof/job-scheduler.test.mjs',
  'apps/desktop/proof/credential-vault.test.mjs',
  'apps/desktop/proof/launcher-options.test.mjs'
])

console.log(
  '\n== Gate (d): component-manifest generator/verifier self-test ==\n(logic proof only; see below for the real-binary verification path)'
)
run('d-component-manifest-selftest', '--test', [
  'apps/desktop/package/component-manifest.test.mjs',
  'apps/desktop/package/application-notices.test.mjs',
  'apps/desktop/package/runtime-guard.test.mjs'
])

console.log(
  '\n== Gate (b): offline-journey unshare argv self-test ==\n(command-shape logic proof only; see below for the real-binary offline journey)'
)
run('b-offline-journey-selftest', '--test', [
  'apps/desktop/proof/offline-journey.test.mjs'
])

const configPath = process.env.DESKTOP_PROOF_CONFIG
if (!configPath) {
  console.log(
    '\n== Gate (b) offline journey and Gate (c) checkpoint/recovery: SKIPPED ==\n' +
      'DESKTOP_PROOF_CONFIG is not set to an absolute config.json path (see\n' +
      'apps/desktop/proof-readme.md). These require real, downloaded\n' +
      'PostgreSQL/Supabase Auth/PostgREST binaries and a staged standalone\n' +
      'Next.js build, which are not present in this environment.'
  )
  results.push({ gate: 'b-offline-journey', exitCode: 'skipped' })
  results.push({ gate: 'c-checkpoint-recovery', exitCode: 'skipped' })
} else {
  const nativeConfig = JSON.parse(await readFile(configPath, 'utf8'))
  console.log('\n== Gate (b): offline /player-performance journey ==')
  run('b-offline-journey', 'apps/desktop/proof/offline-journey.mjs', [
    configPath
  ])
  console.log('\n== Gate (c): checkpoint / restart recovery ==')
  run('c-checkpoint-recovery', 'apps/desktop/proof/checkpoint-journey.mjs', [
    configPath
  ])
  console.log('\n== Gate (c): setup interruption / resume recovery ==')
  run('c-setup-recovery', 'apps/desktop/proof/setup-recovery.mjs', [configPath])
  console.log('\n== Gate (c): native workspace password recovery ==')
  run('c-password-recovery', 'apps/desktop/proof/recovery-journey.mjs', [
    configPath
  ])
  console.log('\n== Gate (c): verified stopped-workspace export / restore ==')
  run('c-workspace-transfer', 'apps/desktop/proof/transfer-journey.mjs', [
    configPath
  ])
  console.log('\n== Runtime token expiry and active-session shutdown ==')
  run('c-lifecycle', 'apps/desktop/proof/lifecycle-journey.mjs', [configPath])
  console.log('\n== Forced coordinator death / native restart ==')
  run('c-hard-kill', 'apps/desktop/proof/hard-kill-journey.mjs', [configPath])
  if (nativeConfig.runtimeGuard) {
    console.log('\n== Forced supervisor death / kernel lease recovery ==')
    run('c-owner-death', 'apps/desktop/proof/owner-death-journey.mjs', [
      configPath
    ])
  } else {
    console.log('Kernel lease recovery SKIPPED: runtimeGuard is not supplied')
    results.push({ gate: 'c-owner-death', exitCode: 'skipped' })
  }
  console.log('\n== Optional worker failure / critical dependency shutdown ==')
  run('c-optional-worker', 'apps/desktop/proof/optional-worker-journey.mjs', [
    configPath
  ])
  if (nativeConfig.application?.node && nativeConfig.application?.directory) {
    console.log('\n== Compiled local snapshot job / crash claim recovery ==')
    run('c-local-jobs', 'apps/desktop/proof/jobs-journey.mjs', [configPath])
  } else {
    console.log(
      'Local job recovery SKIPPED: compiled application is not supplied'
    )
    results.push({ gate: 'c-local-jobs', exitCode: 'skipped' })
  }
  console.log('\n== Native schema migration interruption / receipt recovery ==')
  run(
    'c-schema-interruption',
    'apps/desktop/proof/schema-interruption-journey.mjs',
    [configPath]
  )
  console.log('\n== Native user-session expiry / restart renewal ==')
  run('c-session-renewal', 'apps/desktop/proof/session-journey.mjs', [
    configPath
  ])
}

console.log('\n== Summary ==')
console.log(JSON.stringify(results, null, 2))
if (results.some((r) => typeof r.exitCode === 'number' && r.exitCode !== 0))
  process.exitCode = 1
