import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  encryptedPassphrase,
  guardedEncryptedTransfer,
  guardedTransfer,
  maintenanceCLI
} from './maintenance.mjs'
import { nativeServices } from '../proof/native-services.mjs'
import { bundledServices } from './runtime.mjs'
import { selectWorkspace } from './workspace-selection.mjs'

// Called only after the window, scheduler and native services have stopped.
// The old workspace remains selected until a restored copy has opened safely.
export async function runWorkspaceMaintenance(
  request,
  {
    root,
    state,
    defaultState,
    verify = false,
    passphrase = encryptedPassphrase,
    encryptedTransfer = guardedEncryptedTransfer,
    services = nativeServices
  }
) {
  const { operation } = request
  let secret
  try {
    const directory = resolve(request.directory)
    if (request.encrypted) {
      secret = await passphrase(operation)
      if (operation === 'restore') await mkdir(directory, { mode: 0o700 })
      await encryptedTransfer(
        root,
        operation,
        operation === 'backup' ? state : directory,
        operation === 'backup' ? directory : resolve(request.source),
        secret
      )
    } else if (operation === 'backup') {
      await guardedTransfer(root, operation, state, directory)
    } else {
      await maintenanceCLI(root, directory, [
        '--state',
        directory,
        '--restore',
        request.source
      ])
    }
    if (operation === 'restore') {
      let restored
      try {
        restored = await services(bundledServices(root, directory))
      } finally {
        await restored?.stop()
      }
      if (!verify) {
        await mkdir(defaultState, { recursive: true, mode: 0o700 })
        await selectWorkspace(defaultState, directory)
      }
    }
    return {
      status: 'passed',
      operation,
      directory,
      state: operation === 'restore' ? directory : state
    }
  } catch (error) {
    if (error?.code === 'ECANCEL')
      return { status: 'cancelled', operation, state }
    const reason =
      new Map([
        ['EPASSPHRASELENGTH', 'passphrase-length'],
        ['EPASSPHRASEMISMATCH', 'passphrase-mismatch'],
        ['ENATIVEDIALOG', 'dialog-unavailable']
      ]).get(error?.code) ?? 'transfer'
    return { status: 'failed', operation, state, reason }
  } finally {
    secret?.fill(0)
  }
}

export async function workspaceSessions(
  state,
  { open, maintain, notify, verify = false }
) {
  for (;;) {
    const request = await open(state)
    if (!request) return
    const outcome = await maintain(request, state)
    if (verify) {
      if (outcome.status !== 'passed')
        throw new Error('Workspace maintenance verification failed')
      return outcome
    }
    if (outcome.status !== 'cancelled') await notify(outcome)
    state = outcome.state
  }
}
