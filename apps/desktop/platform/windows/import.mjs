import { isDeepStrictEqual } from 'node:util'
import { projectCachedPlayer } from '../../../../packages/workspace-onboarding/v1.mjs'

export function cachedPersonal(input) {
  const timestamp = input?.personal?.upstreamUpdatedAt
  if (!Number.isSafeInteger(timestamp) || timestamp % 1000 !== 0)
    throw new Error('Unsupported historical Player projection')
  const personal = projectCachedPlayer({
    player: input.personal.apiData,
    updatedOn: timestamp / 1000
  })
  if (
    !isDeepStrictEqual(personal, input.personal) ||
    !isDeepStrictEqual(input.freshness, {
      syncedAt: timestamp,
      offlineReadable: true
    })
  )
    throw new Error('Historical projection differs from its Player snapshot')
  return personal
}

// Only the supervisor retains the native file choice across one unlock.
export function personalImport({ native, gate, onboarding }) {
  let source
  return async () => {
    gate.assertCurrent()
    const original = onboarding.state.read()
    if (
      original.personal ||
      Object.values(original.vaultReferences ?? {}).length
    )
      throw new Error('Import requires an empty personal workspace')
    try {
      if (!source) {
        const selected = await native(['choose-import'])
        if (typeof selected?.source !== 'string')
          throw new Error('Native import source unavailable')
        source = selected.source
      }
      gate.assertCurrent()
      const imported = await native([
        'read-import',
        source,
        String(gate.expiresAt())
      ])
      gate.assertCurrent()
      const result = onboarding.migrateHistorical({
        personal: cachedPersonal(imported)
      })
      source = undefined
      return result
    } catch (error) {
      if (error.code !== 'ESESSION') source = undefined
      throw error
    }
  }
}
