import { join } from 'node:path'
import { withEntry, readBounded } from '../proof/safe-files.mjs'
import { writeAtomic } from '../proof/schema-lifecycle.mjs'

export const accessScopes = ['Player', 'Guild', 'Guild Raid']
const uuid = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
const invalid = () =>
  new Error(
    'The saved API access record is unavailable. Existing data was preserved.'
  )
export function scopedConnectionRecord(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !['format', 'installation', 'guildCode', 'roles'].includes(key)
    ) ||
    value.format !== 'ta-scoped-official-access-v1' ||
    !uuid(value.installation) ||
    typeof value.guildCode !== 'string' ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(value.guildCode) ||
    !value.roles ||
    typeof value.roles !== 'object' ||
    Array.isArray(value.roles)
  )
    throw invalid()
  for (const [scope, record] of Object.entries(value.roles)) {
    if (
      !accessScopes.includes(scope) ||
      !record ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      Object.keys(record).some(
        (key) => !['handle', 'verifiedAt', 'expiresAt', 'guildId'].includes(key)
      ) ||
      typeof record.handle !== 'string' ||
      !/^[a-f0-9]{32}$/.test(record.handle) ||
      !Number.isSafeInteger(record.verifiedAt) ||
      record.verifiedAt < 1 ||
      record.verifiedAt > Date.UTC(2100, 0, 1) ||
      (record.expiresAt != null &&
        (!Number.isSafeInteger(record.expiresAt) ||
          record.expiresAt < 1 ||
          record.expiresAt > Date.UTC(2100, 0, 1))) ||
      (scope !== 'Player' && !uuid(record.guildId)) ||
      (record.guildId !== undefined && !uuid(record.guildId))
    )
      throw invalid()
  }
  return structuredClone(value)
}
const owned = (metadata, directory) => {
  if (
    !(directory ? metadata.isDirectory() : metadata.isFile()) ||
    metadata.uid !== process.getuid() ||
    metadata.mode & 0o077
  )
    throw invalid()
}
const filename = 'scoped-official-access.json'
export async function loadScopedConnections(state) {
  try {
    return await withEntry(state, async (_file, metadata, anchor) => {
      owned(metadata, true)
      return withEntry(join(anchor, filename), async (file, info) => {
        owned(info, false)
        return scopedConnectionRecord(
          JSON.parse((await readBounded(file, 8192)).toString('utf8'))
        )
      })
    })
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw invalid()
  }
}
export async function saveScopedConnections(state, value) {
  const record = scopedConnectionRecord(value)
  await loadScopedConnections(state)
  return withEntry(state, async (_file, metadata, anchor) => {
    owned(metadata, true)
    await writeAtomic(join(anchor, filename), JSON.stringify(record))
  })
}
