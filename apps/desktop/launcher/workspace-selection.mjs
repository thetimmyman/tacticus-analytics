import { join, isAbsolute } from 'node:path'
import { writeAtomic } from '../proof/schema-lifecycle.mjs'
import { withEntry, readBounded } from '../proof/safe-files.mjs'

function requireOwnedDirectory(value) {
  if (
    !value.isDirectory() ||
    value.mode & 0o077 ||
    value.uid !== process.getuid()
  )
    throw new Error('Workspace selection requires a private owned directory')
}
async function ownedDirectory(path) {
  return withEntry(path, async (_file, metadata) =>
    requireOwnedDirectory(metadata)
  )
}
export async function selectedWorkspace(defaultState) {
  let value
  try {
    value = await withEntry(
      defaultState,
      async (_directory, metadata, anchor) => {
        requireOwnedDirectory(metadata)
        return withEntry(
          join(anchor, 'active-workspace.json'),
          async (file, info) => {
            if (
              !info.isFile() ||
              info.mode & 0o077 ||
              info.uid !== process.getuid()
            )
              throw new Error('Invalid workspace selection')
            return JSON.parse((await readBounded(file, 8192)).toString('utf8'))
          }
        )
      }
    )
  } catch (error) {
    if (error.code === 'ENOENT') return defaultState
    if (error.code === 'ELINK') throw new Error('Invalid workspace selection')
    throw error
  }
  if (
    !value ||
    value.format !== 'desktop-workspace-selection-v1' ||
    typeof value.state !== 'string' ||
    !isAbsolute(value.state)
  )
    throw new Error('Invalid workspace selection')
  await ownedDirectory(value.state)
  return value.state
}
export async function selectWorkspace(defaultState, state) {
  if (!isAbsolute(state)) throw new Error('Invalid workspace selection')
  await ownedDirectory(state)
  await withEntry(defaultState, async (_directory, metadata, anchor) => {
    requireOwnedDirectory(metadata)
    await writeAtomic(
      join(anchor, 'active-workspace.json'),
      JSON.stringify({ format: 'desktop-workspace-selection-v1', state })
    )
  })
}
