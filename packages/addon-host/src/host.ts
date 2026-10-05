import { createHash, randomBytes, verify, type KeyObject } from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  addonId,
  canonicalJson,
  LIMITS,
  signedManifestSchema,
  type AddonId,
  type AddonManifest,
  type Platform
} from './contract'
import { normalizedImport, parseOfflineImport } from './offline'

const descriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    addonId,
    format: z.enum(['ta-war-summary-v1', 'ta-replay-timeline-v1'])
  })
  .strict()
const bundleSchema = z
  .object({
    envelope: signedManifestSchema,
    files: z
      .array(
        z
          .object({
            path: z.string().max(128),
            base64: z
              .string()
              .max(Math.ceil(LIMITS.fileBytes / 3) * 4)
              .regex(/^[A-Za-z0-9+/]*={0,2}$/)
          })
          .strict()
      )
      .min(1)
      .max(LIMITS.files)
  })
  .strict()
const moduleSchema = z
  .object({
    active: z.string().regex(/^[a-f0-9]{64}$/),
    previous: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    enabled: z.boolean(),
    approvedCapabilities: z.array(z.string()).max(4)
  })
  .strict()
const registrySchema = z
  .object({
    schemaVersion: z.literal(1),
    modules: z
      .object({
        'guild-war': moduleSchema.optional(),
        replays: moduleSchema.optional()
      })
      .strict(),
    data: z.record(
      z.string().regex(/^(guild-war|replays)-[a-f0-9]{64}$/),
      z.string().max(2_097_152)
    )
  })
  .strict()
type Registry = z.infer<typeof registrySchema>
const bindingSchema = z
  .object({
    accountHandle: z.string().regex(/^[a-z0-9-]{1,64}$/),
    guildHandle: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/)
      .nullable()
  })
  .strict()
type Binding = z.infer<typeof bindingSchema>

import { AddonError } from './errors'
export { AddonError } from './errors'
export type HostPolicy = {
  coreVersion: string
  platform: Platform
  architecture: 'x64' | 'arm64'
  trustedKeys: ReadonlyMap<string, KeyObject>
  revokedKeyIds: ReadonlySet<string>
  approvedReviews: ReadonlySet<string>
  approvedRightsReceipts: ReadonlySet<string>
  // Trusted integration test/health adapter. Never originates in an addon package.
  beforeCommit?: (operation: string) => void
}
export type PackageBundle = z.infer<typeof bundleSchema>
export type AddonSummary = {
  addonId: AddonId
  version: string
  enabled: boolean
  digest: string
  hasPrevious: boolean
  capabilities: AddonManifest['capabilities']
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
function compareVersion(a: string, b: string): number {
  function parts(value: string) {
    const split = value.split('.'),
      [major, minor, patch] = split
    if (split.length !== 3 || !major || !minor || !patch)
      throw new AddonError('incompatible-package')
    return { major: BigInt(major), minor: BigInt(minor), patch: BigInt(patch) }
  }
  const first = parts(a),
    second = parts(b)
  for (const part of ['major', 'minor', 'patch'] as const)
    if (first[part] !== second[part]) return first[part] < second[part] ? -1 : 1
  return 0
}
function directory(path: string) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new AddonError('recoverable-storage')
}
function readBounded(path: string, maxBytes: number): Buffer {
  // Open with symlink refusal, then inspect/read only this descriptor. Nonblocking
  // open also prevents an unexpected FIFO from hanging before the file-type check.
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > maxBytes)
      throw new AddonError('recoverable-storage')
    const bytes = Buffer.alloc(stat.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset)
      if (count === 0) break
      offset += count
    }
    if (offset !== stat.size || offset > maxBytes)
      throw new AddonError('recoverable-storage')
    return bytes.subarray(0, offset)
  } finally {
    closeSync(fd)
  }
}
function syncDirectory(path: string) {
  if (process.platform === 'win32') return
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** First-party data-only host. Native application owns this private directory. */
export class AddonHost {
  private binding: Binding | null = null
  private sessions = new Map<
    string,
    { addonId: AddonId; digest: string; binding: string }
  >()
  private cancellation = new Map<string, Set<AbortController>>()
  constructor(
    private readonly root: string,
    private readonly policy: HostPolicy
  ) {
    if (!/^\d+\.\d+\.\d+$/.test(policy.coreVersion))
      throw new AddonError('incompatible-package')
    directory(root)
    directory(join(root, 'packages'))
  }
  private load(): Registry {
    try {
      const file = join(this.root, 'registry.json')
      return existsSync(file)
        ? registrySchema.parse(
            JSON.parse(readBounded(file, 8_388_608).toString('utf8'))
          )
        : { schemaVersion: 1, modules: {}, data: {} }
    } catch {
      throw new AddonError('recoverable-storage')
    }
  }
  private save(registry: Registry, operation: string) {
    const target = join(this.root, 'registry.json')
    if (existsSync(target) && lstatSync(target).isSymbolicLink())
      throw new AddonError('recoverable-storage')
    const temporary = join(
      this.root,
      `registry-${randomBytes(16).toString('hex')}.tmp`
    )
    const bytes = canonicalJson(registrySchema.parse(registry))
    if (Buffer.byteLength(bytes) > 8_388_608)
      throw new AddonError('recoverable-storage')
    let committed = false
    try {
      const fd = openSync(temporary, 'wx', 0o600)
      try {
        writeFileSync(fd, bytes)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      this.policy.beforeCommit?.(operation)
      renameSync(temporary, target)
      committed = true
      // Directory fsync is supported on Linux/macOS; Windows adapters qualify durability separately.
      syncDirectory(this.root)
    } catch (error) {
      if (committed) throw new AddonError('recoverable-storage')
      throw error
    } finally {
      rmSync(temporary, { force: true })
    }
  }
  private transaction<T>(work: () => T): T {
    const lock = join(this.root, 'transaction.lock')
    let fd: number
    try {
      fd = openSync(lock, 'wx', 0o600)
    } catch {
      throw new AddonError('transaction-busy')
    }
    try {
      return work()
    } finally {
      closeSync(fd)
      rmSync(lock, { force: true })
    }
  }
  private validateBundle(input: unknown) {
    try {
      const bundle = bundleSchema.parse(input)
      const { manifest, signature } = bundle.envelope
      const key = this.policy.trustedKeys.get(signature.keyId)
      const signatureBytes = Buffer.from(signature.value, 'base64')
      if (
        !key ||
        signatureBytes.toString('base64') !== signature.value ||
        key.asymmetricKeyType !== 'ed25519' ||
        this.policy.revokedKeyIds.has(signature.keyId) ||
        !this.policy.approvedReviews.has(manifest.source.reviewSha256) ||
        !this.policy.approvedRightsReceipts.has(
          manifest.source.rightsReceiptSha256
        ) ||
        !verify(null, Buffer.from(canonicalJson(manifest)), key, signatureBytes)
      )
        throw new AddonError('untrusted-package')
      const compat = manifest.compatibility
      if (
        !compat.platforms.includes(this.policy.platform) ||
        !compat.architectures.includes(this.policy.architecture) ||
        compareVersion(this.policy.coreVersion, compat.coreMinVersion) < 0 ||
        compareVersion(this.policy.coreVersion, compat.coreMaxVersion) > 0 ||
        compareVersion(compat.coreMinVersion, compat.coreMaxVersion) > 0
      )
        throw new AddonError('incompatible-package')
      if (
        bundle.files.length !== manifest.files.length ||
        new Set(bundle.files.map((file) => file.path)).size !==
          bundle.files.length
      )
        throw new AddonError('invalid-package')
      for (const entry of manifest.files) {
        const file = bundle.files.find((item) => item.path === entry.path)
        if (!file || !['module.json', 'notice.txt'].includes(file.path))
          throw new AddonError('invalid-package')
        const bytes = Buffer.from(file.base64, 'base64')
        if (
          bytes.toString('base64') !== file.base64 ||
          bytes.byteLength !== entry.bytes ||
          sha256(bytes) !== entry.sha256
        )
          throw new AddonError('invalid-package')
        if (file.path === 'module.json') {
          if (entry.kind !== 'data') throw new AddonError('invalid-package')
          const descriptor = descriptorSchema.parse(
            JSON.parse(bytes.toString('utf8'))
          )
          const format =
            manifest.addonId === 'guild-war'
              ? 'ta-war-summary-v1'
              : 'ta-replay-timeline-v1'
          if (
            descriptor.addonId !== manifest.addonId ||
            descriptor.format !== format
          )
            throw new AddonError('invalid-package')
        } else if (entry.kind !== 'notice')
          throw new AddonError('invalid-package')
      }
      if (!bundle.files.some((file) => file.path === 'module.json'))
        throw new AddonError('invalid-package')
      return bundle
    } catch (error) {
      if (error instanceof AddonError) throw error
      throw new AddonError('invalid-package')
    }
  }
  /** Stage contains no executable content. A digest identifies the exact signed envelope and files. */
  stage(input: unknown): { digest: string; manifest: AddonManifest } {
    const bundle = this.validateBundle(input),
      serialized = canonicalJson(bundle),
      digest = sha256(serialized)
    return this.transaction(() => {
      const target = join(this.root, 'packages', `${digest}.json`)
      if (existsSync(target)) {
        if (readBounded(target, 12_582_912).toString('utf8') !== serialized)
          throw new AddonError('invalid-package')
      } else {
        const temporary = join(
          this.root,
          'packages',
          `${digest}-${randomBytes(8).toString('hex')}.tmp`
        )
        try {
          const fd = openSync(temporary, 'wx', 0o600)
          try {
            writeFileSync(fd, serialized)
            fsyncSync(fd)
          } finally {
            closeSync(fd)
          }
          // Read back and reverify before any activation pointer can reference the package.
          this.validateBundle(
            JSON.parse(readBounded(temporary, 12_582_912).toString('utf8'))
          )
          renameSync(temporary, target)
          syncDirectory(join(this.root, 'packages'))
        } finally {
          rmSync(temporary, { force: true })
        }
      }
      return { digest, manifest: bundle.envelope.manifest }
    })
  }
  private package(digest: string): PackageBundle {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new AddonError('invalid-package')
    try {
      const content = readBounded(
        join(this.root, 'packages', `${digest}.json`),
        12_582_912
      ).toString('utf8')
      const parsed = this.validateBundle(JSON.parse(content))
      if (sha256(canonicalJson(parsed)) !== digest)
        throw new AddonError('invalid-package')
      return parsed
    } catch (error) {
      if (error instanceof AddonError) throw error
      throw new AddonError('invalid-package')
    }
  }
  private dependencies(registry: Registry, manifest: AddonManifest) {
    for (const dependency of manifest.dependencies) {
      const installed = registry.modules[dependency.addonId]
      if (
        !installed?.enabled ||
        installed.active !== dependency.packageSha256 ||
        this.package(installed.active).envelope.manifest.version !==
          dependency.version
      )
        throw new AddonError('dependency-unavailable')
    }
  }
  activate(
    digest: string,
    approvedCapabilities: AddonManifest['capabilities']
  ): AddonSummary {
    return this.transaction(() => {
      const registry = this.load(),
        manifest = this.package(digest).envelope.manifest,
        previous = registry.modules[manifest.addonId]
      if (
        previous &&
        compareVersion(
          manifest.version,
          this.package(previous.active).envelope.manifest.version
        ) <= 0 &&
        previous.active !== digest
      )
        throw new AddonError('incompatible-package')
      if (
        canonicalJson([...approvedCapabilities].sort()) !==
        canonicalJson([...manifest.capabilities].sort())
      )
        throw new AddonError('approval-required')
      this.dependencies(registry, manifest)
      registry.modules[manifest.addonId] = {
        active: digest,
        previous:
          previous?.active === digest
            ? previous.previous
            : (previous?.active ?? null),
        enabled: true,
        approvedCapabilities: [...approvedCapabilities]
      }
      try {
        this.save(registry, 'activate')
      } catch (error) {
        if (error instanceof AddonError && error.code === 'recoverable-storage')
          throw error
        throw new AddonError('update-failed')
      }
      this.invalidate(manifest.addonId)
      return this.summary(manifest.addonId, registry)
    })
  }
  rollback(id: AddonId): AddonSummary {
    addonId.parse(id)
    return this.transaction(() => {
      const registry = this.load(),
        current = registry.modules[id]
      if (!current?.previous) throw new AddonError('not-installed')
      const manifest = this.package(current.previous).envelope.manifest
      if (
        manifest.capabilities.some(
          (permission) => !current.approvedCapabilities.includes(permission)
        )
      )
        throw new AddonError('approval-required')
      this.dependencies(registry, manifest)
      registry.modules[id] = {
        active: current.previous,
        previous: current.active,
        enabled: current.enabled,
        approvedCapabilities: [...manifest.capabilities]
      }
      this.save(registry, 'rollback')
      this.invalidate(id)
      return this.summary(id, registry)
    })
  }
  setEnabled(id: AddonId, enabled: boolean) {
    addonId.parse(id)
    if (typeof enabled !== 'boolean') throw new AddonError('invalid-package')
    return this.transaction(() => {
      const registry = this.load(),
        current = registry.modules[id]
      if (!current) throw new AddonError('not-installed')
      if (enabled)
        this.dependencies(
          registry,
          this.package(current.active).envelope.manifest
        )
      current.enabled = enabled
      this.save(registry, enabled ? 'enable' : 'disable')
      this.invalidate(id)
    })
  }
  uninstall(id: AddonId, dataChoice: 'retain' | 'delete') {
    addonId.parse(id)
    if (dataChoice !== 'retain' && dataChoice !== 'delete')
      throw new AddonError('approval-required')
    return this.transaction(() => {
      const registry = this.load()
      delete registry.modules[id]
      if (dataChoice === 'delete')
        for (const key of Object.keys(registry.data))
          if (key.startsWith(`${id}-`)) delete registry.data[key]
      this.save(registry, 'uninstall')
      this.invalidate(id)
    })
  }
  private summary(id: AddonId, registry: Registry): AddonSummary {
    addonId.parse(id)
    const current = registry.modules[id]
    if (!current) throw new AddonError('not-installed')
    const manifest = this.package(current.active).envelope.manifest
    return {
      addonId: id,
      version: manifest.version,
      enabled: current.enabled,
      digest: current.active,
      hasPrevious: current.previous !== null,
      capabilities: manifest.capabilities
    }
  }
  list(): AddonSummary[] {
    const registry = this.load()
    return (['guild-war', 'replays'] as const)
      .filter((id) => registry.modules[id])
      .map((id) => this.summary(id, registry))
  }
  setBinding(input: Binding | null) {
    const binding = input === null ? null : bindingSchema.parse(input)
    if (canonicalJson(binding) !== canonicalJson(this.binding)) {
      this.invalidate()
      this.binding = binding
    }
  }
  private bindingDigest() {
    if (!this.binding) throw new AddonError('invalid-session')
    return sha256(canonicalJson(this.binding))
  }
  openSession(id: AddonId): string {
    const summary = this.summary(id, this.load())
    if (!summary.enabled) throw new AddonError('addon-disabled')
    if (id === 'guild-war' && this.binding?.guildHandle === null)
      throw new AddonError('invalid-session')
    if (this.sessions.size >= 128) this.invalidate()
    const handle = randomBytes(24).toString('hex')
    this.sessions.set(handle, {
      addonId: id,
      digest: summary.digest,
      binding: this.bindingDigest()
    })
    return handle
  }
  private session(
    handle: string,
    required: AddonManifest['capabilities'][number]
  ) {
    const session = this.sessions.get(handle)
    if (!session || session.binding !== this.bindingDigest())
      throw new AddonError('invalid-session')
    const current = this.summary(session.addonId, this.load())
    if (
      !current.enabled ||
      current.digest !== session.digest ||
      !current.capabilities.includes(required)
    )
      throw new AddonError('invalid-session')
    this.dependencies(
      this.load(),
      this.package(current.digest).envelope.manifest
    )
    return session
  }
  isBrokerSessionCurrent(handle: string, id: AddonId): boolean {
    try {
      return (
        this.session(
          handle,
          id === 'guild-war' ? 'broker.guild-war.read' : 'broker.replay.capture'
        ).addonId === id
      )
    } catch {
      return false
    }
  }
  importData(handle: string, input: string) {
    const session = this.session(handle, 'offline.import'),
      normalized = normalizedImport(session.addonId, input)
    return this.transaction(() => {
      this.session(handle, 'offline.import')
      const registry = this.load()
      registry.data[`${session.addonId}-${session.binding}`] = normalized
      this.save(registry, 'import')
    })
  }
  readData(handle: string) {
    const session = this.session(handle, 'offline.read'),
      value = this.load().data[`${session.addonId}-${session.binding}`]
    if (!value) throw new AddonError('no-local-data')
    return parseOfflineImport(session.addonId, value)
  }
  jobSignal(handle: string): AbortSignal {
    this.session(handle, 'offline.read')
    const controller = new AbortController(),
      jobs = this.cancellation.get(handle) ?? new Set()
    jobs.add(controller)
    this.cancellation.set(handle, jobs)
    return controller.signal
  }
  closeSession(handle: string) {
    for (const controller of this.cancellation.get(handle) ?? [])
      controller.abort()
    this.cancellation.delete(handle)
    this.sessions.delete(handle)
  }
  invalidate(id?: AddonId) {
    for (const [handle, session] of this.sessions)
      if (!id || session.addonId === id) {
        for (const controller of this.cancellation.get(handle) ?? [])
          controller.abort()
        this.cancellation.delete(handle)
        this.sessions.delete(handle)
      }
  }
  exportModuleData(handle: string): string {
    return canonicalJson(this.readData(handle))
  }
  diagnostics(): { schemaVersion: 1; installed: number; enabled: number } {
    const modules = Object.values(this.load().modules)
    return {
      schemaVersion: 1,
      installed: modules.length,
      enabled: modules.filter((module) => module.enabled).length
    }
  }
}
