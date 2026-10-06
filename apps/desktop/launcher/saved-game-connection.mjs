import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { withEntry, readBounded } from '../proof/safe-files.mjs'
import { writeAtomic } from '../proof/schema-lifecycle.mjs'

const invalid = () => new Error('The saved game connection is unavailable.')
const keys = new Set([
  'installation',
  'guildCode',
  'guildId',
  'expiresAt',
  'handle'
])
export function savedConnectionRecord(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.has(key)) ||
    typeof value.installation !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.installation) ||
    typeof value.guildCode !== 'string' ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(value.guildCode) ||
    typeof value.guildId !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.guildId) ||
    typeof value.handle !== 'string' ||
    !/^[a-f0-9]{32}$/.test(value.handle) ||
    (value.expiresAt !== undefined &&
      (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0))
  )
    throw invalid()
  return { ...value }
}
const filename = 'official-raid-connection.json'
const format = 'ta-official-raid-connection-v1'
function owned(metadata, directory) {
  if (
    (directory ? !metadata.isDirectory() : !metadata.isFile()) ||
    metadata.uid !== process.getuid() ||
    metadata.mode & 0o077
  )
    throw invalid()
}
async function read(anchor) {
  return withEntry(join(anchor, filename), async (file, metadata) => {
    owned(metadata, false)
    const value = JSON.parse((await readBounded(file, 8192)).toString('utf8'))
    if (
      !value ||
      value.format !== format ||
      Object.keys(value).some((key) => !['format', 'record'].includes(key))
    )
      throw invalid()
    return savedConnectionRecord(value.record)
  })
}
// Main-process persistence only. No credential is stored in this file, and the
// stopped-workspace backup allowlist never includes it or its OS-vault record.
// Callers obtain specific consent before loading the record or decrypting a key.
export async function loadGameConnection(state) {
  try {
    return await withEntry(state, async (_directory, metadata, anchor) => {
      owned(metadata, true)
      return read(anchor)
    })
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw invalid()
  }
}
export async function saveGameConnection(state, value) {
  const record = savedConnectionRecord(value)
  return withEntry(state, async (_directory, metadata, anchor) => {
    owned(metadata, true)
    try {
      await read(anchor)
    } catch (error) {
      if (error.code !== 'ENOENT') throw invalid()
    }
    await writeAtomic(
      join(anchor, filename),
      JSON.stringify({ format, record })
    )
  })
}
export async function forgetGameConnection(state) {
  return withEntry(state, async (directory, metadata, anchor) => {
    owned(metadata, true)
    try {
      await read(anchor)
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw invalid()
    }
    await unlink(join(anchor, filename))
    await directory.sync()
  })
}
