import { readFile, rm, writeFile, unlink } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  captureApplicationPayload,
  captureCleanCheckoutProvenance,
  desktopBuildEnvironment,
  desktopBuildRecord,
  requireCleanBuildEnvironment
} from '../package/build-profile.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const recordPath = join(root, '.next/desktop-build.json')
await unlink(recordPath).catch((error) => {
  if (error.code !== 'ENOENT') throw error
})
await requireCleanBuildEnvironment(root)
const preClean = await captureCleanCheckoutProvenance(root, {
  allowBuildOutputs: true
})
for (const buildOutput of [
  '.next',
  'next-env.d.ts',
  'tsconfig.tsbuildinfo',
  '.swc',
  '.turbo'
]) {
  if (
    preClean.ignoredEntries.some((entry) => {
      const normalized = entry.replaceAll('\\', '/')
      return (
        normalized === buildOutput || normalized.startsWith(`${buildOutput}/`)
      )
    })
  ) {
    await rm(join(root, buildOutput), { recursive: true, force: true })
  }
}
const beforeBuild = await captureCleanCheckoutProvenance(root, {
  allowBuildOutputs: false
})
const result = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'build'],
  {
    cwd: root,
    shell: process.platform === 'win32',
    env: desktopBuildEnvironment(process.env),
    stdio: 'inherit'
  }
)
if (result.error || result.status !== 0)
  throw new Error('Desktop application build failed')
await requireCleanBuildEnvironment(root)
const afterBuild = await captureCleanCheckoutProvenance(root, {
  allowBuildOutputs: true
})
if (
  afterBuild.sourceCommit !== beforeBuild.sourceCommit ||
  afterBuild.packageLockSha256 !== beforeBuild.packageLockSha256
)
  throw new Error('Desktop checkout provenance changed during build')
// Bind every file stage-standalone.mjs will package, not only the build metadata.
const applicationFiles = await captureApplicationPayload(root)
const record = desktopBuildRecord(
  await readFile(join(root, '.next/required-server-files.json'), 'utf8'),
  await readFile(join(root, '.next/BUILD_ID'), 'utf8'),
  {
    sourceCommit: beforeBuild.sourceCommit,
    packageLockSha256: beforeBuild.packageLockSha256,
    applicationFiles
  }
)
await writeFile(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 })
console.log('Desktop standalone build recorded')
