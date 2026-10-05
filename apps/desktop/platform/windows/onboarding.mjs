import { WorkspaceOnboardingV1 } from '../../../../packages/workspace-onboarding/v1.mjs'
import { nativeCommand } from './native-command.mjs'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export function windowsOnboarding(stateRoot, command = nativeCommand) {
  const path = join(stateRoot, 'official-onboarding.json')
  return new WorkspaceOnboardingV1({
    state: {
      read() {
        try {
          return JSON.parse(readFileSync(path, 'utf8'))
        } catch (error) {
          if (error.code === 'ENOENT') return {}
          throw new Error('Onboarding state unavailable')
        }
      },
      write(value) {
        const temporary = `${path}.${randomUUID()}.tmp`
        writeFileSync(temporary, JSON.stringify(value), {
          flag: 'wx',
          flush: true
        })
        renameSync(temporary, path)
      }
    },
    vault: {
      async promptAndStoreOfficialRead() {
        return (await command(['prompt-official'])).handle
      },
      async withOfficialRead(handle, callback) {
        // The callback receives an opaque reference. Only the native process can read the key.
        return callback(handle)
      },
      async remove(handle) {
        await command(['remove-official', handle])
      }
    },
    upstream: {
      get(scope, handle) {
        return command(['read-official', handle, scope])
      }
    }
  })
}
