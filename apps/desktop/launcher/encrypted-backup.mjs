import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt
} from 'node:crypto'
import { constants } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  unlink
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { readBounded, withEntry } from '../proof/safe-files.mjs'
import { validateBackup } from '../proof/workspace-transfer.mjs'
import { syncTree } from '../proof/schema-lifecycle.mjs'

const derive = promisify(scrypt)
const magic = Buffer.from('TABKENC1')
const headerBytes = 64
const tagBytes = 16
const blockBytes = 1024 * 1024
const maxInventory = 32 * 1024 * 1024
const maxEntries = 200000
// Stay below GCM's per-message limit, including the encrypted inventory.
const maxData = 32 * 1024 ** 3
const kdf = { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }
const format = 'desktop-encrypted-backup-v1'
const failure = () =>
  new Error('Encrypted backup is invalid or its passphrase is incorrect')

function secret(value) {
  const result =
    typeof value === 'string'
      ? Buffer.from(value, 'utf8')
      : Buffer.isBuffer(value)
        ? Buffer.from(value)
        : null
  if (!result || result.length < 12 || result.length > 1024) {
    result?.fill(0)
    throw new Error('Backup passphrase must contain 12 to 1024 UTF-8 bytes')
  }
  return result
}
function relativePath(path) {
  if (
    typeof path !== 'string' ||
    Buffer.byteLength(path, 'utf8') > 4096 ||
    /[\\\x00-\x1f\x7f]/.test(path)
  )
    throw failure()
  const parts = path.split('/')
  if (parts.length > 64 || parts.some((p) => !p || p === '.' || p === '..'))
    throw failure()
  return parts
}
function directory(info, privateOnly = false) {
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid() ||
    info.mode & (privateOnly ? 0o077 : 0o022)
  )
    throw new Error('An owned directory with safe permissions is required')
}
async function withDirectory(path, action) {
  if (process.platform !== 'linux')
    throw new Error(
      'Encrypted workspace transfers require the supported Linux runtime'
    )
  const parts = resolve(path).split('/').filter(Boolean)
  async function descend(anchor, index) {
    return withEntry(
      index === 0 ? '/' : join(anchor, parts[index - 1]),
      async (file, info, next) => {
        if (!info.isDirectory()) throw failure()
        return index === parts.length
          ? action(file, info, next)
          : descend(next, index + 1)
      }
    )
  }
  return descend('', 0)
}
async function withParent(path, action) {
  const resolved = resolve(path)
  if (basename(resolved) === '/' || basename(resolved) === '.') throw failure()
  return withDirectory(dirname(resolved), (file, info, anchor) =>
    action(file, info, anchor, basename(resolved))
  )
}
async function absent(path) {
  try {
    await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  throw new Error('Backup destination already exists')
}
async function writeAll(file, value) {
  let written = 0
  while (written < value.length) {
    const result = await file.write(
      value,
      written,
      value.length - written,
      null
    )
    if (!result.bytesWritten) throw new Error('Backup write made no progress')
    written += result.bytesWritten
  }
}
async function readExact(file, length, position) {
  const bytes = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const result = await file.read(
      bytes,
      offset,
      length - offset,
      position + offset
    )
    if (!result.bytesRead) throw failure()
    offset += result.bytesRead
  }
  return bytes
}
async function scan(
  anchor,
  entries = [],
  prefix = '',
  budget = { bytes: 0, metadata: 64 }
) {
  for (const name of (await readdir(anchor)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name
    relativePath(path)
    budget.metadata += Buffer.byteLength(path, 'utf8') + 200
    if (budget.metadata > maxInventory)
      throw new Error('Backup inventory exceeds its supported bound')
    if (entries.length >= maxEntries)
      throw new Error('Backup contains too many entries')
    await withEntry(join(anchor, name), async (file, info, next) => {
      if (info.uid !== process.getuid())
        throw new Error('Backup contains foreign-owned data')
      if (info.isDirectory()) {
        entries.push({ kind: 'directory', path })
        await scan(next, entries, path, budget)
      } else {
        if (
          info.nlink !== 1 ||
          !Number.isSafeInteger(info.size) ||
          info.size > maxData
        )
          throw failure()
        budget.bytes += info.size
        if (!Number.isSafeInteger(budget.bytes) || budget.bytes > maxData)
          throw failure()
        const hash = createHash('sha256')
        let bytes = 0
        for await (const block of file.createReadStream({
          autoClose: false,
          highWaterMark: blockBytes
        })) {
          bytes += block.length
          if (bytes > info.size) throw failure()
          hash.update(block)
        }
        if (bytes !== info.size) throw failure()
        entries.push({ kind: 'file', path, bytes, sha256: hash.digest('hex') })
      }
    })
  }
  return entries
}
function parseInventory(bytes, total) {
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw failure()
  }
  if (
    value?.format !== format ||
    Object.keys(value).sort().join(',') !== 'entries,format' ||
    !Array.isArray(value.entries) ||
    value.entries.length > maxEntries
  )
    throw failure()
  const known = new Map()
  let actual = 0
  for (const entry of value.entries) {
    const parts = relativePath(entry.path)
    if (
      known.has(entry.path) ||
      (parts.length > 1 &&
        known.get(parts.slice(0, -1).join('/')) !== 'directory')
    )
      throw failure()
    if (entry.kind === 'directory') {
      if (Object.keys(entry).sort().join(',') !== 'kind,path') throw failure()
    } else if (entry.kind === 'file') {
      if (
        Object.keys(entry).sort().join(',') !== 'bytes,kind,path,sha256' ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)
      )
        throw failure()
      actual += entry.bytes
      if (!Number.isSafeInteger(actual) || actual > maxData) throw failure()
    } else throw failure()
    known.set(entry.path, entry.kind)
  }
  if (actual !== total) throw failure()
  return value.entries
}
function makeHeader(length, total) {
  const header = Buffer.alloc(headerBytes)
  magic.copy(header)
  header.writeUInt32BE(1, 8)
  header.writeUInt32BE(kdf.N, 12)
  header.writeUInt32BE(kdf.r, 16)
  header.writeUInt32BE(kdf.p, 20)
  randomBytes(16).copy(header, 24)
  randomBytes(12).copy(header, 40)
  header.writeUInt32BE(length, 52)
  header.writeBigUInt64BE(BigInt(total), 56)
  return header
}
function parseHeader(header, size) {
  if (
    !header.subarray(0, 8).equals(magic) ||
    header.readUInt32BE(8) !== 1 ||
    header.readUInt32BE(12) !== kdf.N ||
    header.readUInt32BE(16) !== kdf.r ||
    header.readUInt32BE(20) !== kdf.p
  )
    throw failure()
  const length = header.readUInt32BE(52)
  const total = header.readBigUInt64BE(56)
  if (
    !length ||
    length > maxInventory ||
    total > BigInt(maxData) ||
    BigInt(size) !== BigInt(headerBytes + length + tagBytes) + total
  )
    throw failure()
  return { length, total: Number(total) }
}
async function relativeEntry(root, path, action) {
  const parts = relativePath(path)
  async function next(anchor, index) {
    return withEntry(join(anchor, parts[index]), async (file, info, child) => {
      if (index + 1 === parts.length) return action(file, info, child)
      if (!info.isDirectory()) throw failure()
      return next(child, index + 1)
    })
  }
  return next(root, 0)
}

// A sibling keeps restore's leased workspace empty until authentication. The
// enclosing application's owned directory anchors all temporary names.
export async function withTransferStaging(state, action) {
  return withParent(state, async (_parent, info, anchor) => {
    directory(info)
    const identity = await withDirectory(
      state,
      async (_state, stateInfo, stateAnchor) => {
        directory(stateInfo, true)
        if (process.env.DESKTOP_KERNEL_LEASE !== '4')
          throw new Error('Workspace lease required')
        await withEntry(
          join(stateAnchor, 'runtime.lease'),
          async (lease, leaseInfo) => {
            const descriptor = await stat('/proc/self/fd/4')
            if (
              !leaseInfo.isFile() ||
              descriptor.dev !== leaseInfo.dev ||
              descriptor.ino !== leaseInfo.ino
            )
              throw new Error('Workspace lease mismatch')
          }
        )
        return createHash('sha256')
          .update(
            JSON.stringify({
              path: resolve(state),
              dev: stateInfo.dev,
              ino: stateInfo.ino
            })
          )
          .digest('hex')
          .slice(0, 24)
      }
    )
    const prefix = `.encrypted-transfer-${identity}-`
    const markerValue = JSON.stringify({
      format: 'desktop-encrypted-transfer-staging-v1',
      state: identity
    })
    // A killed worker can leave plaintext inside its private sibling. Reap
    // only this workspace inode's marked staging while its lease is held.
    for (const name of await readdir(anchor)) {
      if (
        !name.startsWith(prefix) ||
        !/^[a-f0-9-]{36}$/.test(name.slice(prefix.length))
      )
        continue
      const stale = join(anchor, name)
      await withEntry(stale, async (_file, staleInfo, old) => {
        directory(staleInfo, true)
        const names = await readdir(old)
        if (!names.length) return
        await withEntry(
          join(old, 'transfer.json'),
          async (marker, markerInfo) => {
            if (
              !markerInfo.isFile() ||
              (await readBounded(marker, 1024)).toString('utf8') !== markerValue
            )
              throw new Error(
                'Unrecognized encrypted transfer staging was preserved'
              )
          }
        )
      })
      await rm(stale, { recursive: true, force: true })
    }
    const name = `${prefix}${randomUUID()}`
    const path = join(anchor, name)
    await mkdir(path, { mode: 0o700 })
    try {
      return await withEntry(path, async (file, entry, temporary) => {
        directory(entry, true)
        const marker = await open(join(temporary, 'transfer.json'), 'wx', 0o600)
        try {
          await marker.writeFile(markerValue)
          await marker.sync()
        } finally {
          await marker.close()
        }
        await file.sync()
        // Public APIs reopen every ordinary path component with NOFOLLOW.
        // Passing the internal /proc descriptor alias would intentionally
        // violate that public admission check, so use its checked name here.
        return action(join(dirname(resolve(state)), name))
      })
    } finally {
      await rm(path, { recursive: true, force: true })
    }
  })
}

/** Stream a validated stopped checkpoint to a new encrypted file. Never overwrite. */
export async function sealDirectory(source, destination, passphrase) {
  const password = secret(passphrase)
  let key
  try {
    return await withDirectory(source, async (_source, info, anchor) => {
      directory(info, true)
      const entries = await scan(anchor)
      await validateBackup(`${anchor}/.`)
      const total = entries.reduce((sum, e) => sum + (e.bytes || 0), 0)
      if (!Number.isSafeInteger(total) || total > maxData) throw failure()
      const manifest = Buffer.from(JSON.stringify({ format, entries }))
      if (manifest.length > maxInventory) throw failure()
      const header = makeHeader(manifest.length, total)
      key = await derive(password, header.subarray(24, 40), 32, kdf)
      const cipher = createCipheriv(
        'aes-256-gcm',
        key,
        header.subarray(40, 52),
        { authTagLength: tagBytes }
      )
      cipher.setAAD(header)
      return withParent(
        destination,
        async (parent, parentInfo, outputAnchor, name) => {
          directory(parentInfo)
          const target = join(outputAnchor, name)
          await absent(target)
          const temporary = join(
            outputAnchor,
            `.${name}.${randomUUID()}.pending`
          )
          let output,
            published = false
          try {
            output = await open(
              temporary,
              constants.O_WRONLY |
                constants.O_CREAT |
                constants.O_EXCL |
                constants.O_NOFOLLOW,
              0o600
            )
            await writeAll(output, header)
            await writeAll(output, cipher.update(manifest))
            for (const entry of entries) {
              if (entry.kind !== 'file') continue
              await relativeEntry(
                anchor,
                entry.path,
                async (input, fileInfo) => {
                  if (
                    !fileInfo.isFile() ||
                    fileInfo.nlink !== 1 ||
                    fileInfo.size !== entry.bytes
                  )
                    throw failure()
                  const hash = createHash('sha256')
                  let bytes = 0
                  for await (const block of input.createReadStream({
                    autoClose: false,
                    highWaterMark: blockBytes
                  })) {
                    bytes += block.length
                    if (bytes > entry.bytes) throw failure()
                    hash.update(block)
                    await writeAll(output, cipher.update(block))
                  }
                  if (
                    bytes !== entry.bytes ||
                    hash.digest('hex') !== entry.sha256
                  )
                    throw failure()
                }
              )
            }
            await writeAll(output, cipher.final())
            await writeAll(output, cipher.getAuthTag())
            await output.sync()
            await output.close()
            output = null
            // link fails atomically if any destination, including a symlink,
            // appeared since admission. The temporary file is on the same FS.
            await link(temporary, target)
            published = true
            await unlink(temporary)
            await parent.sync()
            return {
              format,
              encrypted: true,
              files: entries.filter((e) => e.kind === 'file').length,
              bytes: total
            }
          } finally {
            await output?.close()
            if (!published) await unlink(temporary).catch(() => {})
          }
        }
      )
    })
  } finally {
    password.fill(0)
    key?.fill(0)
  }
}

/** Authenticate in private staging; only then create a new validated checkpoint. */
export async function unsealToDirectory(source, destination, passphrase) {
  const password = secret(passphrase)
  let key
  try {
    return await withParent(source, (_parent, _info, inputAnchor, inputName) =>
      withEntry(join(inputAnchor, inputName), async (input, info) => {
        if (
          !info.isFile() ||
          !Number.isSafeInteger(info.size) ||
          info.size < headerBytes + tagBytes
        )
          throw failure()
        const header = await readExact(input, headerBytes, 0)
        const { length, total } = parseHeader(header, info.size)
        key = await derive(password, header.subarray(24, 40), 32, kdf)
        const decipher = createDecipheriv(
          'aes-256-gcm',
          key,
          header.subarray(40, 52),
          { authTagLength: tagBytes }
        )
        decipher.setAAD(header)
        decipher.setAuthTag(
          await readExact(input, tagBytes, info.size - tagBytes)
        )
        return withParent(
          destination,
          async (parent, parentInfo, anchor, name) => {
            directory(parentInfo, true)
            const target = join(anchor, name)
            await absent(target)
            const temporary = join(anchor, `.encrypted-restore-${randomUUID()}`)
            await mkdir(temporary, { mode: 0o700 })
            let created = false
            try {
              return await withEntry(
                temporary,
                async (staging, _stagingInfo, stage) => {
                  const entries = parseInventory(
                    decipher.update(
                      await readExact(input, length, headerBytes)
                    ),
                    total
                  )
                  let position = headerBytes + length
                  for (const entry of entries) {
                    const path = join(stage, ...relativePath(entry.path))
                    if (entry.kind === 'directory') {
                      await mkdir(path, { mode: 0o700 })
                      continue
                    }
                    const file = await open(
                      path,
                      constants.O_WRONLY |
                        constants.O_CREAT |
                        constants.O_EXCL |
                        constants.O_NOFOLLOW,
                      0o600
                    )
                    try {
                      const hash = createHash('sha256')
                      let remaining = entry.bytes
                      while (remaining) {
                        const amount = Math.min(blockBytes, remaining)
                        const block = decipher.update(
                          await readExact(input, amount, position)
                        )
                        position += amount
                        remaining -= amount
                        hash.update(block)
                        await writeAll(file, block)
                      }
                      if (hash.digest('hex') !== entry.sha256) throw failure()
                      await file.sync()
                    } finally {
                      await file.close()
                    }
                  }
                  try {
                    if (decipher.final().length) throw failure()
                  } catch {
                    throw failure()
                  }
                  const saved = await validateBackup(`${stage}/.`)
                  await syncTree(`${stage}/.`)
                  await staging.sync()
                  // Exclusive directory creation prevents replacing even an empty
                  // existing destination. A pending marker gates partial publication.
                  await mkdir(target, { mode: 0o700 })
                  created = true
                  await withEntry(
                    target,
                    async (output, _outputInfo, final) => {
                      const marker = join(final, 'encrypted-restore.pending')
                      const pending = await open(marker, 'wx', 0o600)
                      await pending.close()
                      for (const child of (await readdir(stage)).sort()) {
                        if (child === 'checkpoint.json') continue
                        await rename(join(stage, child), join(final, child))
                      }
                      await rename(
                        join(stage, 'checkpoint.json'),
                        join(final, 'checkpoint.json')
                      )
                      await output.sync()
                      await unlink(marker)
                      await output.sync()
                      await validateBackup(`${final}/.`)
                    }
                  )
                  await parent.sync()
                  return {
                    format,
                    authenticated: true,
                    files: entries.filter((e) => e.kind === 'file').length,
                    source: saved.source
                  }
                }
              )
            } catch (error) {
              if (created)
                await rm(target, { recursive: true, force: true }).catch(
                  () => {}
                )
              throw error
            } finally {
              await rm(temporary, { recursive: true, force: true })
            }
          }
        )
      })
    )
  } finally {
    password.fill(0)
    key?.fill(0)
  }
}
