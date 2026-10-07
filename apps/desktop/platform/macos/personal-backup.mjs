import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { projectCachedPlayer } from '../../../../packages/workspace-onboarding/v1.mjs'

export const PERSONAL_EXPORT_VERSION = 'macos-personal-export/v1'
const limit = 4 * 1024 * 1024

function rejectCredentials(value, depth = 0) {
  if (depth > 24) throw new Error('Cached data depth limit')
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    if (
      /^(?:apiKey|api_key|credential|secret|authorization|headers|cookie|sessionToken|vaultReferences|transportKey|password|__proto__|constructor|prototype)$/i.test(
        key
      )
    )
      throw new Error('Credentials cannot enter a cached data import')
    rejectCredentials(nested, depth + 1)
  }
}

export function cachedPersonal(input) {
  rejectCredentials(input)
  if (
    !input ||
    Object.keys(input).sort().join(',') !==
      'freshness,personal,schemaVersion' ||
    input.schemaVersion !== PERSONAL_EXPORT_VERSION
  )
    throw new Error('Unsupported cached data export')
  const timestamp = input.personal?.upstreamUpdatedAt
  if (!Number.isSafeInteger(timestamp) || timestamp % 1000 !== 0)
    throw new Error('Invalid cached data timestamp')
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
    throw new Error('Cached data differs from its Player snapshot')
  return personal
}

// The descriptor rejects links/devices and reads at most limit+1 bytes even if
// the chosen file grows. File paths and contents stay in the native coordinator.
export async function readCachedPersonal({ path, authorize }) {
  authorize()
  if (!isAbsolute(path ?? '')) throw new Error('Choose a cached data file')
  const descriptor = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  const bytes = Buffer.alloc(limit + 1)
  try {
    const info = await descriptor.stat()
    if (!info.isFile() || info.size > limit)
      throw new Error('Unsupported cached data file')
    let size = 0
    while (size < bytes.length) {
      const read = await descriptor.read(bytes, size, bytes.length - size, null)
      if (!read.bytesRead) break
      size += read.bytesRead
    }
    if (size > limit) throw new Error('Cached data size limit')
    const personal = cachedPersonal(
      JSON.parse(bytes.subarray(0, size).toString('utf8'))
    )
    // Unlock may expire while the file is read; no state write can precede this.
    authorize()
    return personal
  } finally {
    bytes.fill(0)
    await descriptor.close()
  }
}

export async function importCachedPersonal({ path, onboarding, authorize }) {
  authorize()
  const original = onboarding.state.read()
  if (original.personal || Object.values(original.vaultReferences ?? {}).length)
    throw new Error('Import requires an empty personal workspace')
  const personal = await readCachedPersonal({ path, authorize })
  authorize()
  return onboarding.migrateHistorical({ personal })
}
