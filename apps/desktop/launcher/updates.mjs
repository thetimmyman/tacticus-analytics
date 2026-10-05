import { createPublicKey, verify, createHash, randomBytes } from 'node:crypto'
import { open, link, unlink, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, basename, isAbsolute, join } from 'node:path'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { Readable } from 'node:stream'
import { withEntry } from '../proof/safe-files.mjs'

// The large package stream uses the native HTTP parser and backpressure.
// No cookies, redirects or renderer session are attached to this transport.
export function nativeUpdateRequest(address, options) {
  return new Promise((resolve, reject) => {
    const url = new URL(address)
    if (!['https:', 'http:'].includes(url.protocol)) return reject(invalid())
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      // The inventoried package feed or signature-verified update URL is intentional configuration, not uploaded file contents.
      // codeql[js/file-access-to-http]
      url,
      {
        method: 'GET',
        headers: options.headers,
        signal: options.signal,
        agent: false
      },
      (response) => {
        const headers = new Headers()
        for (const [name, value] of Object.entries(response.headers)) {
          if (value != null)
            headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        }
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          redirected: false,
          url: address,
          headers,
          body: Readable.toWeb(response)
        })
      }
    )
    request.once('error', reject)
    request.end()
  })
}

const invalid = () =>
  new Error(
    'The update could not be verified. Your installed application and workspace were preserved.'
  )
const verifiedPackages = new WeakMap()
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)
const base64 = (value) => {
  if (typeof value !== 'string' || value.length > 65536) throw invalid()
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw invalid()
  return bytes
}
const destination = (address, config) => {
  const url = new URL(address)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        config.privateLoopbackPreview === true &&
        url.protocol === 'http:' &&
        url.hostname === '127.0.0.1'
      ))
  )
    throw invalid()
  return url
}
export function updateConfiguration(value) {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          'format',
          'version',
          'sequence',
          'channel',
          'platform',
          'packageName',
          'packageFormat',
          'manifestURL',
          'publicKey',
          'privateLoopbackPreview'
        ].includes(key)
    ) ||
    value.format !== 'ta-update-configuration-v1' ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    typeof value.version !== 'string' ||
    !/^[0-9A-Za-z._-]{1,64}$/.test(value.version) ||
    value.channel !== 'private-preview' ||
    value.platform !== 'linux-x64' ||
    value.packageName !== 'tacticus-analytics-preview' ||
    !['arch', 'deb'].includes(value.packageFormat) ||
    (value.privateLoopbackPreview !== undefined &&
      typeof value.privateLoopbackPreview !== 'boolean')
  )
    throw invalid()
  if (value.manifestURL === null && value.publicKey === null)
    return { ...value }
  if (typeof value.manifestURL !== 'string' || value.manifestURL.length > 2048)
    throw invalid()
  destination(value.manifestURL, value)
  const key = createPublicKey({
    key: base64(value.publicKey),
    format: 'der',
    type: 'spki'
  })
  if (key.asymmetricKeyType !== 'ed25519') throw invalid()
  return { ...value }
}
export function verifiedUpdate(envelope, configuration, clock = Date.now) {
  const config = updateConfiguration(configuration)
  if (
    !config.publicKey ||
    !object(envelope) ||
    Object.keys(envelope).some((key) => !['payload', 'signature'].includes(key))
  )
    throw invalid()
  const payload = base64(envelope.payload),
    signature = base64(envelope.signature)
  if (
    payload.length > 32768 ||
    signature.length !== 64 ||
    !verify(
      null,
      payload,
      { key: base64(config.publicKey), format: 'der', type: 'spki' },
      signature
    )
  )
    throw invalid()
  const value = JSON.parse(payload.toString('utf8'))
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          'format',
          'channel',
          'platform',
          'packageName',
          'packageFormat',
          'sequence',
          'version',
          'url',
          'sha256',
          'bytes',
          'expiresAt',
          'notes'
        ].includes(key)
    ) ||
    value.format !== 'ta-update-v1' ||
    value.channel !== config.channel ||
    value.platform !== config.platform ||
    value.packageName !== config.packageName ||
    value.packageFormat !== config.packageFormat ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    typeof value.version !== 'string' ||
    !/^[0-9A-Za-z._-]{1,64}$/.test(value.version) ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > 1024 * 1024 * 1024 ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= clock() ||
    value.expiresAt > clock() + 7 * 86400000 ||
    typeof value.notes !== 'string' ||
    value.notes.length > 4096 ||
    typeof value.url !== 'string' ||
    value.url.length > 2048
  )
    throw invalid()
  const url = destination(value.url, config),
    feed = destination(config.manifestURL, config)
  if (
    url.origin !== feed.origin ||
    !url.pathname.startsWith('/packages/') ||
    !url.pathname.endsWith(
      config.packageFormat === 'arch' ? '.pkg.tar.zst' : '.deb'
    )
  )
    throw invalid()
  if (value.sequence <= config.sequence) return null
  const result = Object.freeze({ ...value })
  verifiedPackages.set(result, JSON.stringify(config))
  return result
}
async function boundedResponse(response, max) {
  const reader = response.body?.getReader()
  if (!reader) throw invalid()
  let bytes = 0
  const parts = []
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.length
      if (bytes > max) throw invalid()
      parts.push(part.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return Buffer.concat(parts)
}
export async function checkForUpdate(
  configuration,
  { fetch: request = nativeUpdateRequest, signal, clock = Date.now } = {}
) {
  const config = updateConfiguration(configuration)
  if (!config.manifestURL) return { configured: false, update: null }
  let response
  try {
    response = await request(config.manifestURL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000)
    })
    if (
      !response.ok ||
      response.redirected ||
      (response.url && response.url !== config.manifestURL) ||
      response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        .trim()
        .toLowerCase() !== 'application/json'
    )
      throw invalid()
    return {
      configured: true,
      update: verifiedUpdate(
        JSON.parse((await boundedResponse(response, 65536)).toString('utf8')),
        config,
        clock
      )
    }
  } catch {
    throw invalid()
  } finally {
    if (response?.body && !response.body.locked)
      await response.body.cancel().catch(() => {})
  }
}
export async function downloadUpdate(
  configuration,
  update,
  path,
  { fetch: request = nativeUpdateRequest, signal } = {}
) {
  const config = updateConfiguration(configuration)
  if (
    !isAbsolute(path) ||
    basename(path).length > 200 ||
    /[\u0000-\u001f\u007f]/.test(basename(path)) ||
    !basename(path).endsWith(
      config.packageFormat === 'arch' ? '.pkg.tar.zst' : '.deb'
    ) ||
    !update ||
    verifiedPackages.get(update) !== JSON.stringify(config) ||
    update.expiresAt <= Date.now() ||
    destination(update.url, config).origin !==
      destination(config.manifestURL, config).origin ||
    !Number.isSafeInteger(update.bytes) ||
    update.bytes < 1 ||
    update.bytes > 1024 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(update.sha256)
  )
    throw invalid()
  // Only the trusted menu passes a verified manifest result; no renderer API.
  return withEntry(dirname(path), async (directory, metadata, anchor) => {
    if (
      !metadata.isDirectory() ||
      metadata.uid !== process.getuid() ||
      metadata.mode & 0o022
    )
      throw invalid()
    const target = join(anchor, basename(path)),
      partial = join(anchor, '.ta-update-' + randomBytes(16).toString('hex'))
    try {
      await lstat(target)
      throw invalid()
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const file = await open(
      partial,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    )
    let response,
      published = false
    try {
      response = await request(update.url, {
        method: 'GET',
        headers: { accept: 'application/octet-stream' },
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(300000)])
          : AbortSignal.timeout(300000)
      })
      if (
        !response.ok ||
        response.redirected ||
        (response.url && response.url !== update.url)
      )
        throw invalid()
      const length = response.headers.get('content-length')
      if (length != null && Number(length) !== update.bytes) throw invalid()
      const reader = response.body?.getReader()
      if (!reader) throw invalid()
      const hash = createHash('sha256')
      let bytes = 0
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          bytes += part.value.length
          if (bytes > update.bytes) throw invalid()
          hash.update(part.value)
          let offset = 0
          while (offset < part.value.length)
            offset += (
              await file.write(part.value, offset, part.value.length - offset)
            ).bytesWritten
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      if (
        bytes !== update.bytes ||
        hash.digest('hex') !== update.sha256 ||
        update.expiresAt <= Date.now()
      )
        throw invalid()
      signal?.throwIfAborted()
      await file.sync()
      await file.close()
      await link(partial, target)
      published = true
      await unlink(partial)
      await directory.sync()
      return { path, bytes, sha256: update.sha256, version: update.version }
    } catch {
      throw invalid()
    } finally {
      await file.close().catch(() => {})
      if (!published) await unlink(partial).catch(() => {})
      if (response?.body && !response.body.locked)
        await response.body.cancel().catch(() => {})
    }
  })
}
