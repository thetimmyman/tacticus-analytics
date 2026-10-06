import { spawn } from 'node:child_process'
import { readFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { nativeServices } from '../proof/native-services.mjs'
import { bundledServices } from './runtime.mjs'

export async function guardedTransfer(root, operation, state, other) {
  const child = spawn(
    join(root, 'bin/runtime-guard'),
    [
      '--owner',
      state,
      join(root, 'bin/node'),
      join(root, 'apps/desktop/proof/workspace-transfer.mjs'),
      operation,
      state,
      other
    ],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { PATH: join(root, 'bin'), LANG: 'C.UTF-8' }
    }
  )
  let output = ''
  child.stdout.on('data', (bytes) => {
    output += bytes
  })
  const code = await new Promise((accept, reject) => {
    child.once('error', reject)
    child.once('exit', accept)
  })
  if (code !== 0)
    throw new Error(
      code === 73
        ? 'Workspace is in use. Close it before transferring data.'
        : 'Workspace transfer failed. Existing data was preserved; any partial destination was retained.'
    )
  return JSON.parse(output)
}
export async function maintenanceCLI(root, state, args) {
  const backup = args.includes('--backup'),
    restore = args.includes('--restore')
  if (backup === restore || args.includes('--verify'))
    throw new Error('Choose one backup or restore operation')
  const operation = backup ? 'backup' : 'restore'
  const other = args[args.indexOf(`--${operation}`) + 1]
  if (!other || other.startsWith('--'))
    throw new Error('A backup directory path is required')
  if (restore) {
    if (!args.includes('--state'))
      throw new Error('Restore requires an explicit new --state directory')
    await mkdir(state, { mode: 0o700 })
  } else {
    // Backup never creates a fresh database in place of a missing workspace.
    await readFile(join(state, 'pgdata/PG_VERSION'))
    let services
    try {
      services = await nativeServices(bundledServices(root, state))
    } finally {
      await services?.stop()
    }
  }
  return guardedTransfer(root, operation, state, resolve(other))
}
