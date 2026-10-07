import { WorkspaceOnboardingV1 } from '../../../../packages/workspace-onboarding/v1.mjs'
import { importCachedPersonal, readCachedPersonal } from './personal-backup.mjs'

const recoveryError = () =>
  Object.assign(
    new Error('Restore retained personal data before reconnecting.'),
    {
      code: 'ERECOVERY'
    }
  )

// The native supervisor supplies a freshly verified owner assertion. Recovery
// never supplies a new Auth owner, renderer credential or live API capability.
export function createPersonalController({
  store,
  vault,
  upstream,
  assertOwner
}) {
  const guardedVault = {
    ...vault,
    async remove(handle) {
      assertOwner()
      const protectedReferences = store.cleanupReferences()
      if (protectedReferences === null || protectedReferences.includes(handle))
        return
      await vault.remove(handle)
    }
  }
  const onboarding = new WorkspaceOnboardingV1({
    vault: guardedVault,
    upstream,
    state: {
      read: store.read,
      write(value) {
        assertOwner()
        store.write(value, assertOwner)
        const protectedReferences = store.cleanupReferences()
        if (protectedReferences === null) return
        // A pending-metadata failure cannot undo a visible personal commit.
        // The next owner-authorized action repairs it before vault cleanup.
        try {
          vault.commit(protectedReferences)
        } catch {}
      }
    }
  })
  const view = () => {
    const recovery = {
      status: store.mode(),
      checkpointAvailable: store.checkpointAvailable(),
      cleanupPaused: store.cleanupReferences() === null
    }
    if (recovery.status === 'recovery-required')
      return {
        version: 1,
        status: 'recovery-required',
        requestedCapabilities: ['Player', 'Guild', 'Guild Raid'],
        capabilities: {},
        personal: null,
        freshness: null,
        cloudContribution: 'separate-consent-required',
        playerIdentity: 'display-name-only',
        limitation:
          'Retained personal data needs recovery. Use the native Workspace menu to restore cached data. Existing data and official access are preserved.',
        recovery
      }
    const projected = onboarding.view()
    if (recovery.cleanupPaused)
      projected.limitation +=
        ' Existing saved credentials are preserved while recovery is unresolved. Disconnect disables live access.'
    return { ...projected, recovery }
  }
  return {
    onboarding,
    view,
    async run({ operation, scope, path }) {
      assertOwner()
      if (operation === 'recover-personal') {
        if (path === '') store.restoreCheckpoint(assertOwner)
        else {
          const personal = await readCachedPersonal({
            path,
            authorize: assertOwner
          })
          store.restorePersonal(personal, assertOwner)
        }
      } else if (store.mode() === 'recovery-required') {
        if (operation !== 'session') throw recoveryError()
        assertOwner()
        return view()
      }
      store.reconcile(assertOwner)
      if (store.mode() === 'recovery-required') {
        if (operation !== 'session') throw recoveryError()
        assertOwner()
        return view()
      }
      if (
        store.mode() === 'commit-uncertain' &&
        !['session', 'recover-personal'].includes(operation)
      )
        throw Object.assign(
          new Error('Reconcile the interrupted personal save.'),
          {
            code: 'ECOMMITUNCERTAIN'
          }
        )
      const protectedReferences = store.cleanupReferences()
      if (protectedReferences !== null) await vault.recover(protectedReferences)
      if (operation === 'disconnect') await onboarding.disconnect(scope)
      else if (operation === 'import')
        await importCachedPersonal({ path, onboarding, authorize: assertOwner })
      else if (operation === 'connect')
        await onboarding.connect({
          requested:
            scope === 'Player' ? ['Player', 'Guild', 'Guild Raid'] : [scope],
          confirmPlayer: vault.confirmPlayer,
          expectedGuildId: store.read().guildId
        })
      else if (!['session', 'recover-personal'].includes(operation))
        throw new Error('Unsupported native personal operation')
      assertOwner()
      return view()
    }
  }
}
