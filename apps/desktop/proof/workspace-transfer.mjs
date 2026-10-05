import {
  readFile,
  readdir,
  lstat,
  stat,
  mkdir,
  unlink,
  open
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyRegularTree } from './safe-files.mjs'
import {
  inventory,
  checkpoint,
  syncTree,
  writeAtomic
} from './schema-lifecycle.mjs'

const inputs = ['pgdata', 'credentials.json', 'schema-version']
async function privateDirectory(path) {
  const entry = await lstat(path)
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    entry.mode & 0o077 ||
    entry.uid !== process.getuid()
  )
    throw new Error('A private owned directory is required')
}
async function lease(state) {
  await privateDirectory(state)
  if (process.env.DESKTOP_KERNEL_LEASE !== '4')
    throw new Error('Workspace lease required')
  const [file, descriptor] = await Promise.all([
    stat(join(state, 'runtime.lease')),
    stat('/proc/self/fd/4')
  ])
  if (file.dev !== descriptor.dev || file.ino !== descriptor.ino)
    throw new Error('Workspace lease mismatch')
}
async function absent(path) {
  try {
    await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  throw new Error('Workspace must be stopped and free of pending operations')
}
export async function validateBackup(source) {
  await privateDirectory(source)
  const names = (await readdir(source)).sort()
  if (
    JSON.stringify(names) !==
    JSON.stringify([...inputs, 'checkpoint.json'].sort())
  )
    throw new Error('Backup is incomplete or contains unexpected data')
  const metadata = await lstat(join(source, 'checkpoint.json'))
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > 32 * 1024 * 1024
  )
    throw new Error('Invalid backup manifest')
  const saved = JSON.parse(
    await readFile(join(source, 'checkpoint.json'), 'utf8')
  )
  if (
    saved.format !== 'desktop-stopped-checkpoint-v1' ||
    !/^[a-f0-9]{64}$/.test(saved.source)
  )
    throw new Error('Invalid backup format')
  const actual = (await inventory(source)).filter(
    (file) => file.path !== 'checkpoint.json'
  )
  if (
    JSON.stringify(actual) !== JSON.stringify(saved.files) ||
    (await readFile(join(source, 'schema-version'), 'utf8')).trim() !==
      saved.source
  )
    throw new Error('Backup file integrity check failed')
  await absent(join(source, 'pgdata/postmaster.pid'))
  return saved
}
export async function exportWorkspace(state, destination) {
  state = resolve(state)
  destination = resolve(destination)
  await lease(state)
  for (const name of [
    'running.lock',
    'backup.pending.json',
    'restore.pending.json',
    'pgdata/postmaster.pid'
  ])
    await absent(join(state, name))
  const version = (await readFile(join(state, 'schema-version'), 'utf8')).trim()
  if (!/^[a-f0-9]{64}$/.test(version))
    throw new Error('Workspace schema is not ready')
  const id = await checkpoint(state, version)
  const source = join(state, 'backups', id)
  await validateBackup(source)
  // An existing destination is never overwritten. A partial new destination
  // has no valid manifest and is retained for diagnosis after interruption.
  await mkdir(destination, { mode: 0o700 })
  await writeAtomic(
    join(destination, 'backup.pending.json'),
    JSON.stringify({ format: 'desktop-backup-pending-v1' })
  )
  for (const input of inputs)
    await copyRegularTree(join(source, input), join(destination, input))
  await syncTree(destination)
  await writeAtomic(
    join(destination, 'checkpoint.json'),
    await readFile(join(source, 'checkpoint.json'))
  )
  await unlink(join(destination, 'backup.pending.json'))
  await syncTree(destination)
  await validateBackup(destination)
  return {
    format: 'desktop-stopped-checkpoint-v1',
    files: (await inventory(destination)).length
  }
}
export async function restoreWorkspace(state, source) {
  state = resolve(state)
  source = resolve(source)
  await lease(state)
  if (
    JSON.stringify((await readdir(state)).sort()) !==
    JSON.stringify(['runtime.lease'])
  )
    throw new Error(
      'Restore requires a new workspace; existing data is never replaced'
    )
  const saved = await validateBackup(source)
  await writeAtomic(
    join(state, 'restore.pending.json'),
    JSON.stringify({
      format: 'desktop-restore-pending-v1',
      source: saved.source
    })
  )
  for (const input of inputs)
    await copyRegularTree(join(source, input), join(state, input))
  const files = []
  for (const file of await inventory(state))
    if (file.path !== 'runtime.lease' && file.path !== 'restore.pending.json')
      files.push(file)
  if (JSON.stringify(files) !== JSON.stringify(saved.files))
    throw new Error('Restored file integrity check failed')
  await syncTree(state)
  await unlink(join(state, 'restore.pending.json'))
  const directory = await open(state, 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
  return { format: 'desktop-restored-workspace-v1', files: files.length }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [operation, state, other] = process.argv.slice(2)
  if (!state || !other || !['backup', 'restore'].includes(operation))
    throw new Error('A backup or restore operation requires two paths')
  const result = await (operation === 'backup'
    ? exportWorkspace(state, other)
    : restoreWorkspace(state, other))
  console.log(JSON.stringify(result))
}
