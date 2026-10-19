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
import { selectWorkspace, selectedWorkspace } from './workspace-selection.mjs'

// Called only after the window, scheduler and native services have stopped.
// The old workspace remains selected until a restored copy has opened safely.
export async function runWorkspaceMaintenance(
  request,
  {
    root,
    state,
    defaultState,
    verify = false,
    progress,
    passphrase = encryptedPassphrase,
    encryptedTransfer = guardedEncryptedTransfer,
    services = nativeServices,
    select = selectWorkspace,
    readSelection = selectedWorkspace
  }
) {
  const { operation } = request
  let secret, closeProgress
  try {
    const directory = resolve(request.directory)
    if (request.encrypted) {
      secret = await passphrase(operation)
      closeProgress = await progress?.(operation)
      if (operation === 'restore') await mkdir(directory, { mode: 0o700 })
      await encryptedTransfer(
        root,
        operation,
        operation === 'backup' ? state : directory,
        operation === 'backup' ? directory : resolve(request.source),
        secret
      )
    } else if (operation === 'backup') {
      closeProgress = await progress?.(operation)
      await guardedTransfer(root, operation, state, directory)
    } else {
      closeProgress = await progress?.(operation)
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
        try {
          await mkdir(defaultState, { recursive: true, mode: 0o700 })
          await select(defaultState, directory)
        } catch {
          // Selection can be visible before a later sync/close reports failure.
          // Readback chooses a known copy; it does not establish durability.
          let selected
          try {
            selected = await readSelection(defaultState)
          } catch {}
          if (selected === state || selected === directory)
            return {
              status: 'selection-warning',
              operation,
              directory,
              state: selected,
              reason:
                selected === directory
                  ? 'selection-restored'
                  : 'selection-current'
            }
          return {
            status: 'selection-uncertain',
            operation,
            directory,
            reason: 'selection-unconfirmed'
          }
        }
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
    // A display failure cannot change a completed transfer or its selection.
    try {
      await closeProgress?.()
    } catch {}
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
    if (outcome.status === 'selection-uncertain') return outcome
    state = outcome.state
  }
}
