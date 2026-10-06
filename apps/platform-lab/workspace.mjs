import {
  mkdtemp,
  mkdir,
  writeFile,
  lstat,
  readdir,
  realpath,
  rm,
  cp,
  open
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'

const markerName = '.platform-lab-disposable.json'
const ownedDirectories = ['state', 'fixtures', 'captures', 'snapshots']
const resetDirectories = ['state', 'fixtures', 'snapshots']
async function noLinks(path) {
  const info = await lstat(path)
  if (info.isSymbolicLink())
    throw new Error('Symlink in disposable workspace refused')
  if (info.isDirectory())
    for (const entry of await readdir(path)) await noLinks(join(path, entry))
}
export async function createWorkspace(base) {
  base = resolve(base)
  if (base === '/' || base === homedir())
    throw new Error('A dedicated private lab directory is required')
  await mkdir(base, { recursive: true, mode: 0o700 })
  const baseInfo = await lstat(base)
  if (
    baseInfo.isSymbolicLink() ||
    (await realpath(base)) !== base ||
    (process.platform !== 'win32' &&
      (baseInfo.mode & 0o077 || baseInfo.uid !== process.getuid()))
  )
    throw new Error('Lab directory must not traverse symlinks')
  const path = await mkdtemp(join(base, 'platform-lab-'))
  await writeFile(
    join(path, markerName),
    JSON.stringify({
      schemaVersion: 1,
      id: randomUUID(),
      path,
      uid: process.getuid?.() ?? null
    }),
    { mode: 0o600, flag: 'wx' }
  )
  for (const directory of ownedDirectories)
    await mkdir(join(path, directory), { mode: 0o700 })
  return path
}
export async function checkWorkspace(path) {
  path = resolve(path)
  if ((await lstat(path)).isSymbolicLink() || (await realpath(path)) !== path)
    throw new Error('Workspace path must not traverse symlinks')
  const markerPath = join(path, markerName)
  // Windows has no O_NOFOLLOW; verify the directory entry and opened identity.
  const entry = process.platform === 'win32' ? await lstat(markerPath) : null
  if (entry?.isSymbolicLink()) throw new Error('Private owned marker required')
  const handle = await open(
    markerPath,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0)
  )
  let marker
  try {
    if (entry) {
      const opened = await handle.stat()
      const current = await lstat(markerPath)
      if (
        current.isSymbolicLink() ||
        current.ino !== opened.ino ||
        current.dev !== opened.dev
      )
        throw new Error('Private owned marker required')
    }
    marker = await readPrivateMarker(handle)
  } finally {
    await handle.close()
  }
  if (
    marker.schemaVersion !== 1 ||
    marker.path !== path ||
    marker.uid !== (process.getuid?.() ?? null) ||
    !/^[a-f0-9-]{36}$/.test(marker.id)
  )
    throw new Error('Disposable marker mismatch')
  await noLinks(path)
  return path
}
// Reads only the opened descriptor, including when its directory entry is replaced.
export async function readPrivateMarker(handle) {
  const info = await handle.stat()
  if (
    !info.isFile() ||
    info.size < 1 ||
    info.size > 4096 ||
    (process.platform !== 'win32' && info.mode & 0o077) ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error('Private owned marker required')
  const buffer = Buffer.alloc(4097)
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
  const after = await handle.stat()
  if (
    bytesRead !== info.size ||
    after.size !== info.size ||
    after.mtimeMs !== info.mtimeMs
  )
    throw new Error('Disposable marker changed while reading')
  return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
}
export async function withWorkspaceLock(path, action) {
  path = await checkWorkspace(path)
  const lock = join(path, '.running')
  const handle = await open(lock, 'wx', 0o600)
  try {
    await handle.writeFile(String(process.pid))
    return await action()
  } finally {
    await handle.close()
    await rm(lock)
  }
}
export async function resetWorkspace(path) {
  path = await checkWorkspace(path)
  return withWorkspaceLock(path, async () => {
    for (const directory of resetDirectories)
      await noLinks(join(path, directory))
    for (const directory of resetDirectories) {
      await rm(join(path, directory), { recursive: true })
      await mkdir(join(path, directory), { mode: 0o700 })
    }
  })
}
export async function snapshotState(path, name) {
  path = await checkWorkspace(path)
  if (!/^[a-z0-9-]{1,40}$/.test(name)) throw new Error('Invalid snapshot name')
  return withWorkspaceLock(path, async () => {
    await noLinks(join(path, 'state'))
    const destination = join(path, 'snapshots', name)
    await mkdir(destination, { mode: 0o700 })
    await cp(join(path, 'state'), join(destination, 'state'), {
      recursive: true,
      errorOnExist: true,
      force: false
    })
  })
}
export async function restoreState(path, name) {
  path = await checkWorkspace(path)
  if (!/^[a-z0-9-]{1,40}$/.test(name)) throw new Error('Invalid snapshot name')
  return withWorkspaceLock(path, async () => {
    const source = join(path, 'snapshots', name, 'state')
    await noLinks(source)
    await noLinks(join(path, 'state'))
    await rm(join(path, 'state'), { recursive: true })
    await cp(source, join(path, 'state'), {
      recursive: true,
      errorOnExist: true,
      force: false
    })
  })
}
export async function boundedDiskPressure(path, bytes, action) {
  path = await checkWorkspace(path)
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 64 * 1024 * 1024)
    throw new Error(
      'Disk pressure must be bounded to 64 MiB of disposable data'
    )
  const file = join(path, 'state', 'disk-pressure.bin')
  const handle = await open(file, 'wx', 0o600)
  try {
    const chunk = Buffer.alloc(Math.min(bytes, 1024 * 1024), 1)
    for (let written = 0; written < bytes;) {
      const result = await handle.write(
        chunk,
        0,
        Math.min(chunk.length, bytes - written)
      )
      written += result.bytesWritten
    }
    return await action()
  } finally {
    await handle.close()
    await rm(file)
  }
}
