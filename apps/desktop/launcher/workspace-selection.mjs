import { readFile, lstat } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { writeAtomic } from '../proof/schema-lifecycle.mjs'

async function ownedDirectory(path) {
  const value = await lstat(path)
  if (
    !value.isDirectory() ||
    value.isSymbolicLink() ||
    value.mode & 0o077 ||
    value.uid !== process.getuid()
  )
    throw new Error('Workspace selection requires a private owned directory')
}
export async function selectedWorkspace(defaultState) {
  const path = join(defaultState, 'active-workspace.json')
  let metadata
  try {
    metadata = await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT') return defaultState
    throw error
  }
  await ownedDirectory(defaultState)
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.mode & 0o077 ||
    metadata.uid !== process.getuid() ||
    metadata.size > 8192
  )
    throw new Error('Invalid workspace selection')
  const value = JSON.parse(await readFile(path, 'utf8'))
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
  await ownedDirectory(defaultState)
  await ownedDirectory(state)
  await writeAtomic(
    join(defaultState, 'active-workspace.json'),
    JSON.stringify({ format: 'desktop-workspace-selection-v1', state })
  )
}
