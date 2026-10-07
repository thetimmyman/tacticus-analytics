import {
  constants,
  openSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync
} from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export function privateState(path) {
  let current = {}
  let handle
  try {
    handle = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = fstatSync(handle)
    if (
      !info.isFile() ||
      info.uid !== process.getuid() ||
      info.mode & 0o077 ||
      info.size > 4 * 1024 * 1024
    )
      throw new Error('Unsafe workspace state')
    current = JSON.parse(readFileSync(handle, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  } finally {
    if (handle !== undefined) closeSync(handle)
  }
  return {
    read: () => structuredClone(current),
    write(value) {
      const bytes = JSON.stringify(value)
      if (Buffer.byteLength(bytes) > 4 * 1024 * 1024)
        throw new Error('Workspace state limit')
      const next = JSON.parse(bytes)
      const temporary = `${path}.${randomUUID()}.new`
      let descriptor
      try {
        descriptor = openSync(
          temporary,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600
        )
        writeFileSync(descriptor, bytes)
        fsyncSync(descriptor)
        closeSync(descriptor)
        descriptor = undefined
        renameSync(temporary, path)
        // Rename is the visibility point. If directory durability later fails,
        // readers must protect references in the replacement rather than treat
        // the old memory snapshot as proof that its new handle is unused.
        current = next
        const directory = openSync(
          dirname(path),
          constants.O_RDONLY | constants.O_DIRECTORY
        )
        try {
          fsyncSync(directory)
        } finally {
          closeSync(directory)
        }
      } finally {
        if (descriptor !== undefined) closeSync(descriptor)
        try {
          unlinkSync(temporary)
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
      }
    }
  }
}
