import { spawnSync } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const output = process.argv[2]
if (process.platform !== 'linux' || !isAbsolute(output || ''))
  throw new Error(
    'Build on the target Linux toolchain and supply an absolute output path'
  )
const result = spawnSync(
  'cc',
  [
    '-O2',
    '-Wall',
    '-Wextra',
    '-Werror',
    fileURLToPath(new URL('./runtime-guard.c', import.meta.url)),
    '-o',
    output
  ],
  { stdio: 'inherit' }
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)
