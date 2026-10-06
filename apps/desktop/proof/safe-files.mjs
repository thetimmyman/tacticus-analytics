import { open, mkdir, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

// Linux desktop filesystem operations use an opened inode, never a pathname
// checked earlier. Directory descriptors anchor recursive reads and writes.
export async function withEntry(path, action) {
  let file
  try {
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
  } catch (error) {
    if (error.code === 'ELOOP')
      throw Object.assign(new Error('Linked data is unsupported'), {
        code: 'ELINK'
      })
    throw error
  }
  try {
    const metadata = await file.stat()
    if (!metadata.isDirectory() && !metadata.isFile())
      throw new Error('Unsupported filesystem entry')
    return await action(file, metadata, `/proc/self/fd/${file.fd}`)
  } finally {
    await file.close()
  }
}
export async function copyRegularTree(source, destination) {
  return withEntry(source, async (input, metadata, anchor) => {
    if (metadata.isDirectory()) {
      await mkdir(destination, { mode: 0o700 })
      await withEntry(destination, async (directory, info, target) => {
        if (!info.isDirectory())
          throw new Error('Copy destination must be a directory')
        for (const name of (await readdir(anchor)).sort())
          await copyRegularTree(join(anchor, name), join(target, name))
        await directory.sync()
      })
    } else {
      const output = await open(
        destination,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      )
      try {
        const block = Buffer.alloc(1024 * 1024)
        for (;;) {
          const { bytesRead } = await input.read(block, 0, block.length, null)
          if (!bytesRead) break
          let written = 0
          while (written < bytesRead)
            written += (
              await output.write(block, written, bytesRead - written, null)
            ).bytesWritten
        }
        await output.sync()
      } finally {
        await output.close()
      }
    }
  })
}
export async function readBounded(file, limit) {
  const block = Buffer.alloc(Math.min(65536, limit + 1)),
    parts = []
  let total = 0
  for (;;) {
    const { bytesRead } = await file.read(
      block,
      0,
      Math.min(block.length, limit + 1 - total),
      null
    )
    if (!bytesRead) break
    total += bytesRead
    if (total > limit) throw new Error('File exceeds the permitted size')
    parts.push(Buffer.from(block.subarray(0, bytesRead)))
  }
  return Buffer.concat(parts, total)
}
