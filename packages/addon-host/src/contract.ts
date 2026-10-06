import { z } from 'zod'

export const CONTRACT_VERSION = 1 as const
export const LIMITS = Object.freeze({
  files: 64,
  fileBytes: 4_194_304,
  packageBytes: 8_388_608,
  resultBytes: 262_144
})
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const version = z
  .string()
  .max(32)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
const token = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
export const addonId = z.enum(['guild-war', 'replays'])
export const platform = z.enum(['linux', 'macos', 'windows', 'android', 'ios'])
export const capability = z.enum([
  'offline.import',
  'offline.read',
  'broker.guild-war.read',
  'broker.replay.capture'
])
export const operation = z.enum(['guild-war.snapshot', 'replay.capture'])
export const packagePath = z
  .string()
  .max(128)
  .regex(/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.(?:json|txt)$/)

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_VERSION),
    addonId,
    version,
    publisher: z.literal('tacticus-analytics'),
    runtime: z.literal('builtin-vetted-v1'),
    source: z
      .object({
        repository: z.literal(
          'https://github.com/thetimmyman/tacticus-analytics'
        ),
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        reviewSha256: digest,
        rightsReceiptSha256: digest
      })
      .strict(),
    compatibility: z
      .object({
        hostApiVersion: z.literal(1),
        coreMinVersion: version,
        coreMaxVersion: version,
        platforms: z.array(platform).min(1).max(5),
        architectures: z
          .array(z.enum(['x64', 'arm64']))
          .min(1)
          .max(2),
        dataSchemaVersion: z.literal(1)
      })
      .strict(),
    capabilities: z.array(capability).min(1).max(4),
    files: z
      .array(
        z
          .object({
            path: packagePath,
            sha256: digest,
            bytes: z.number().int().min(0).max(LIMITS.fileBytes),
            kind: z.enum(['data', 'notice'])
          })
          .strict()
      )
      .min(1)
      .max(LIMITS.files),
    dependencies: z
      .array(z.object({ addonId, version, packageSha256: digest }).strict())
      .max(1)
  })
  .strict()
  .superRefine((manifest, context) => {
    for (const [name, values] of [
      ['files', manifest.files.map((file) => file.path)],
      ['platforms', manifest.compatibility.platforms],
      ['architectures', manifest.compatibility.architectures],
      ['capabilities', manifest.capabilities]
    ] as const) {
      if (new Set(values).size !== values.length)
        context.addIssue({ code: 'custom', message: `Duplicate ${name}` })
    }
    if (
      manifest.files.reduce((total, file) => total + file.bytes, 0) >
      LIMITS.packageBytes
    )
      context.addIssue({
        code: 'custom',
        message: 'Package exceeds size limit'
      })
    const allowedBroker =
      manifest.addonId === 'guild-war'
        ? 'broker.guild-war.read'
        : 'broker.replay.capture'
    if (
      manifest.capabilities.some(
        (value) => value.startsWith('broker.') && value !== allowedBroker
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Capability belongs to another addon'
      })
    if (
      manifest.dependencies.some(
        (dependency) => dependency.addonId === manifest.addonId
      )
    )
      context.addIssue({ code: 'custom', message: 'Self dependency' })
  })

export const signedManifestSchema = z
  .object({
    manifest: manifestSchema,
    signature: z
      .object({
        algorithm: z.literal('ed25519'),
        keyId: token,
        value: z.string().regex(/^[A-Za-z0-9+/]{86}==$/)
      })
      .strict()
  })
  .strict()

// The trusted host supplies account/guild bindings; addon input cannot select them.
export const brokerRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    addonId,
    sessionHandle: token,
    leaseHandle: token,
    operation,
    requestId: token
  })
  .strict()
  .superRefine((request, context) => {
    if (
      (request.addonId === 'guild-war') !==
      (request.operation === 'guild-war.snapshot')
    )
      context.addIssue({
        code: 'custom',
        message: 'Operation belongs to another addon'
      })
  })

export const brokerUnavailableSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal('unavailable'),
    reason: z.enum([
      'protocol-unapproved',
      'permission-refused',
      'vault-locked',
      'vault-unavailable',
      'binding-changed',
      'revoked',
      'expired',
      'addon-disabled',
      'cancelled'
    ]),
    alternative: z.enum([
      'import-war-json',
      'import-replay-json',
      'unlock-vault',
      'reconnect-account'
    ])
  })
  .strict()

export type AddonManifest = z.infer<typeof manifestSchema>
export type SignedManifest = z.infer<typeof signedManifestSchema>
export type BrokerRequest = z.infer<typeof brokerRequestSchema>
export type AddonId = z.infer<typeof addonId>
export type Platform = z.infer<typeof platform>

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
      )
      .join(',')}}`
  }
  throw new Error('Unsupported canonical value')
}
