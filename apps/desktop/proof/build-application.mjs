import { readFile, writeFile, unlink } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  desktopBuildEnvironment,
  desktopBuildRecord,
  requireCleanBuildEnvironment
} from '../package/build-profile.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
await requireCleanBuildEnvironment(root)
const recordPath = join(root, '.next/desktop-build.json')
await unlink(recordPath).catch((error) => {
  if (error.code !== 'ENOENT') throw error
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
if (result.status !== 0) throw new Error('Desktop application build failed')
const record = desktopBuildRecord(
  await readFile(join(root, '.next/required-server-files.json'), 'utf8'),
  await readFile(join(root, '.next/BUILD_ID'), 'utf8')
)
await writeFile(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 })
console.log('Desktop standalone build recorded')
