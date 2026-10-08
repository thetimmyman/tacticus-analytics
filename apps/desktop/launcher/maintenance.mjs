import { spawn } from 'node:child_process'
import { readFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { nativeServices } from '../proof/native-services.mjs'
import { bundledServices } from './runtime.mjs'
import { nativeSecretPrompt } from './native-secret.mjs'

export async function encryptedPassphrase(
  operation,
  prompt = nativeSecretPrompt
) {
  let value = Buffer.from(
    await prompt(
      operation === 'backup' ? 'backup-passphrase' : 'restore-passphrase'
    ),
    'utf8'
  )
  try {
    if (value.length < 12 || value.length > 1024)
      throw new Error('Use a backup passphrase of 12 to 1024 bytes.')
    if (operation === 'backup') {
      const confirmation = Buffer.from(
        await prompt('backup-passphrase-confirm'),
        'utf8'
      )
      try {
        if (!value.equals(confirmation))
          throw new Error('Backup passphrases did not match.')
      } finally {
        confirmation.fill(0)
      }
    }
    const result = value
    value = undefined
    return result
  } finally {
    value?.fill(0)
  }
}

export async function guardedEncryptedTransfer(
  root,
  operation,
  state,
  other,
  passphrase
) {
  if (
    !['backup', 'restore'].includes(operation) ||
    !Buffer.isBuffer(passphrase)
  )
    throw new Error('Invalid encrypted workspace operation')
  const child = spawn(
    join(root, 'bin/runtime-guard'),
    [
      '--owner',
      state,
      join(root, 'bin/node'),
      join(root, 'apps/desktop/launcher/encrypted-transfer.mjs'),
      operation,
      state,
      other
    ],
    {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { PATH: join(root, 'bin'), LANG: 'C.UTF-8' }
    }
  )
  let output = ''
  child.stdout.on('data', (bytes) => {
    if (output.length + bytes.length > 65536) {
      child.stdout.destroy()
      child.kill('SIGKILL')
    } else output += bytes
  })
  child.stdin.on('error', () => {})
  const completion = new Promise((accept, reject) => {
    child.once('error', reject)
    child.once('close', accept)
  })
  child.stdin.end(passphrase)
  const code = await completion
  if (code !== 0)
    throw new Error(
      code === 73
        ? 'Workspace is in use. Close it before transferring data.'
        : 'Encrypted workspace transfer failed. Check the passphrase and backup. Existing data was preserved.'
    )
  return JSON.parse(output)
}

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
    child.once('close', accept)
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
