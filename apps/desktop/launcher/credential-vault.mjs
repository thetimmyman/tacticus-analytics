import { randomBytes } from 'node:crypto'
import { mkdir, open, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { withEntry, readBounded } from '../proof/safe-files.mjs'

const secureBackends = new Set([
  'gnome_libsecret',
  'kwallet',
  'kwallet5',
  'kwallet6'
])
const unavailable = () =>
  Object.assign(
    new Error(
      'Secure credential storage is unavailable or permission was withdrawn.'
    ),
    { code: 'EVAULT' }
  )
const validHandle = (value) =>
  typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)

// Trusted Electron-main primitive. It is never registered as a renderer IPC or
// backend endpoint. A game broker must supply explicit, account-scoped consent
// and fixed operations; this primitive does not discover clients or make calls.
export class CredentialVault {
  #storage
  #directory
  #consent
  #platform
  constructor({
    safeStorage,
    directory,
    consent = () => false,
    platform = process.platform
  }) {
    this.#storage = safeStorage
    this.#directory = directory
    this.#consent = consent
    this.#platform = platform
  }
  #authorized() {
    if (this.#consent() !== true) throw unavailable()
  }
  #ready() {
    this.#authorized()
    // The current filesystem implementation is verified on Linux only. Other
    // platforms need their own tested storage adapter, not an inferred promise.
    if (
      this.#platform !== 'linux' ||
      !this.#storage.isEncryptionAvailable() ||
      !secureBackends.has(this.#storage.getSelectedStorageBackend())
    )
      throw unavailable()
  }
  ensureReady() {
    try {
      this.#ready()
    } catch {
      throw unavailable()
    }
  }
  async #folder(create, action) {
    if (create) await mkdir(this.#directory, { recursive: true, mode: 0o700 })
    return withEntry(this.#directory, async (directory, metadata, anchor) => {
      if (
        !metadata.isDirectory() ||
        metadata.uid !== process.getuid() ||
        metadata.mode & 0o077
      )
        throw unavailable()
      return action(directory, anchor)
    })
  }
  async save(secret) {
    try {
      this.#ready()
      if (
        typeof secret !== 'string' ||
        !secret.length ||
        Buffer.byteLength(secret) > 16384
      )
        throw unavailable()
      const encrypted = this.#storage.encryptString(secret)
      if (
        !Buffer.isBuffer(encrypted) ||
        !encrypted.length ||
        encrypted.includes(Buffer.from(secret))
      )
        throw unavailable()
      this.#authorized()
      const handle = randomBytes(16).toString('hex')
      await this.#folder(true, async (_directory, anchor) => {
        this.#authorized()
        const path = join(anchor, `${handle}.secret`)
        const file = await open(
          path,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600
        )
        try {
          await file.writeFile(encrypted)
          await file.sync()
          this.#authorized()
          await _directory.sync()
          this.#authorized()
        } catch (error) {
          await unlink(path)
          await _directory.sync()
          throw error
        } finally {
          await file.close()
        }
      })
      return handle
    } catch {
      throw unavailable()
    }
  }
  async withCredential(handle, operation) {
    try {
      this.#ready()
      if (!validHandle(handle) || typeof operation !== 'function')
        throw unavailable()
      const encrypted = await this.#folder(false, async (_directory, anchor) =>
        withEntry(join(anchor, `${handle}.secret`), async (file, metadata) => {
          if (
            !metadata.isFile() ||
            metadata.uid !== process.getuid() ||
            metadata.mode & 0o077
          )
            throw unavailable()
          return readBounded(file, 65536)
        })
      )
      this.#authorized()
      const secret = this.#storage.decryptString(encrypted)
      if (
        typeof secret !== 'string' ||
        !secret.length ||
        Buffer.byteLength(secret) > 16384
      )
        throw unavailable()
      this.#authorized()
      const result = await operation(secret)
      this.#authorized()
      // Even an accidental echo from a trusted operation must not return the
      // root value through this primitive. Broker result schemas remain required.
      if (JSON.stringify(result)?.includes(secret)) throw unavailable()
      return result
    } catch {
      throw unavailable()
    }
  }
  async forget(handle) {
    if (!validHandle(handle)) throw unavailable()
    try {
      await this.#folder(false, async (directory, anchor) => {
        await unlink(join(anchor, `${handle}.secret`))
        await directory.sync()
      })
    } catch (error) {
      if (error.code !== 'ENOENT') throw unavailable()
    }
  }
}
