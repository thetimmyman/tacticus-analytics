import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  exportWorkspace,
  restoreWorkspace
} from '../proof/workspace-transfer.mjs'
import {
  sealDirectory,
  unsealToDirectory,
  withTransferStaging
} from './encrypted-backup.mjs'

export async function encryptedTransfer(operation, state, file, passphrase) {
  if (!['backup', 'restore'].includes(operation) || !state || !file)
    throw new Error(
      'An encrypted backup or restore operation requires two paths'
    )
  state = resolve(state)
  file = resolve(file)
  return withTransferStaging(state, async (temporary) => {
    const checkpoint = join(temporary, 'checkpoint')
    if (operation === 'backup') {
      await exportWorkspace(state, checkpoint)
      return sealDirectory(checkpoint, file, passphrase)
    }
    await unsealToDirectory(file, checkpoint, passphrase)
    return {
      ...(await restoreWorkspace(state, checkpoint)),
      encrypted: true,
      authenticated: true
    }
  })
}

// The native owner process already obtained consent. Secret bytes arrive on
// the pipe only: never argv, environment, a request file, stdout or stderr.
export async function readPassphrase(input) {
  if (input.isTTY) throw new Error('A private passphrase pipe is required')
  const parts = []
  let total = 0
  const timer = setTimeout(
    () => input.destroy(new Error('Passphrase pipe timed out')),
    15000
  )
  timer.unref()
  try {
    for await (const bytes of input) {
      const block = Buffer.from(bytes)
      parts.push(block)
      total += block.length
      if (total > 1024)
        throw new Error('Passphrase pipe exceeds the supported bound')
    }
    if (total < 12) throw new Error('Passphrase pipe is incomplete')
    return Buffer.concat(parts, total)
  } finally {
    clearTimeout(timer)
    for (const bytes of parts) bytes.fill(0)
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let passphrase
  try {
    if (process.argv.length !== 5)
      throw new Error('Unexpected transfer arguments')
    passphrase = await readPassphrase(process.stdin)
    const result = await encryptedTransfer(
      process.argv[2],
      process.argv[3],
      process.argv[4],
      passphrase
    )
    console.log(JSON.stringify(result))
  } catch {
    console.error(
      'Encrypted workspace transfer failed; existing workspace data was preserved.'
    )
    process.exitCode = 1
  } finally {
    passphrase?.fill(0)
  }
}
