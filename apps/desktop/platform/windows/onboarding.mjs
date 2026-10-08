import { WorkspaceOnboardingV1 } from '../../../../packages/workspace-onboarding/v1.mjs'
import { nativeCommand } from './native-command.mjs'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export function windowsOnboarding(
  stateRoot,
  command = nativeCommand,
  authorize = () => {}
) {
  const path = join(stateRoot, 'official-onboarding.json')
  const pendingPath = join(stateRoot, 'official-pending.json')
  const atomicWrite = (target, value) => {
    const temporary = `${target}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', flush: true })
    renameSync(temporary, target)
  }
  const pending = () => {
    try {
      const handles = JSON.parse(readFileSync(pendingPath, 'utf8'))
      if (
        !Array.isArray(handles) ||
        handles.length > 64 ||
        handles.some(
          (handle) =>
            typeof handle !== 'string' || !/^[a-f0-9]{32}$/.test(handle)
        )
      )
        throw new Error('Interrupted credential journal unavailable')
      return [...new Set(handles)]
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }
  const guard = new WorkspaceOnboardingV1({
    state: {
      read() {
        authorize()
        try {
          return JSON.parse(readFileSync(path, 'utf8'))
        } catch (error) {
          if (error.code === 'ENOENT') return {}
          throw new Error('Onboarding state unavailable')
        }
      },
      write(value) {
        authorize()
        atomicWrite(path, value)
        // State commits first. Recovery preserves any reference that committed before a crash.
        const committed = new Set(Object.values(value.vaultReferences ?? {}))
        try {
          atomicWrite(
            pendingPath,
            pending().filter((handle) => !committed.has(handle))
          )
        } catch {
          /* Committed state is authoritative; next authenticated recovery can repair the journal. */
        }
      }
    },
    vault: {
      async promptAndStoreOfficialRead() {
        authorize()
        // Journal an opaque target before CredUI/credential creation, so abrupt death cannot hide an unused item.
        const handle = randomUUID().replaceAll('-', '')
        const handles = pending()
        if (handles.length >= 64)
          throw new Error(
            'Recover interrupted official setup before continuing'
          )
        atomicWrite(pendingPath, [...handles, handle])
        const result = await command(['prompt-official', handle])
        authorize()
        if (result.handle !== handle)
          throw new Error('Native credential reference mismatch')
        return handle
      },
      async withOfficialRead(handle, callback) {
        authorize()
        // The callback receives an opaque reference. Only the native process can read the key.
        return callback(handle)
      },
      async remove(handle) {
        authorize()
        if (
          Object.values(guard.state.read().vaultReferences ?? {}).includes(
            handle
          )
        )
          throw new Error(
            'Committed official references require disconnect before removal'
          )
        await command(['remove-official', handle])
        authorize()
        atomicWrite(
          pendingPath,
          pending().filter((item) => item !== handle)
        )
      }
    },
    upstream: {
      get(scope, handle) {
        authorize()
        return command(['read-official', handle, scope])
      }
    }
  })
  guard.recoverPending = async () => {
    authorize()
    const committed = new Set(
      Object.values(guard.state.read().vaultReferences ?? {})
    )
    for (const handle of pending()) {
      authorize()
      if (!committed.has(handle)) await command(['remove-official', handle])
      authorize()
      atomicWrite(
        pendingPath,
        pending().filter((item) => item !== handle)
      )
    }
  }
  return guard
}
