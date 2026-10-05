import { z } from 'zod'

export const RELEASE_MANIFEST_VERSION = 1 as const
export const platforms = [
  'linux',
  'macos',
  'windows',
  'android',
  'ios'
] as const
export const channels = ['stable', 'preview'] as const
export const architectures = ['x64', 'arm64', 'universal'] as const

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/)
const evidence = z.string().url().nullable()
const verification = z.strictObject({
  status: z.enum(['verified', 'pending', 'failed', 'revoked', 'not-required']),
  evidenceUrl: evidence
})
const approval = z.strictObject({
  status: z.enum(['approved', 'pending', 'rejected']),
  evidenceUrl: evidence
})

export const releaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/),
  component: z.enum(['core', 'guild-war', 'replays']),
  platform: z.enum(platforms),
  architecture: z.enum(architectures),
  minimumOS: z.string().min(1).max(160),
  channel: z.enum(channels),
  version,
  releasedAt: z.iso.datetime(),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  state: z.enum(['candidate', 'published', 'revoked']),
  artifact: z.strictObject({
    url: z.string().url(),
    sha256: digest,
    size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    format: z.enum([
      'appimage',
      'deb',
      'rpm',
      'dmg',
      'pkg',
      'exe',
      'msix',
      'apk',
      'aab',
      'ipa'
    ]),
    signature: verification.extend({
      scheme: z.enum([
        'ed25519',
        'authenticode',
        'apple-code-sign',
        'android-apk'
      ])
    }),
    notarization: verification,
    provisioning: verification
  }),
  distribution: z.strictObject({
    method: z.enum(['direct', 'app-store', 'testflight', 'play-store']),
    url: z.string().url().nullable()
  }),
  compatibility: z.strictObject({
    coreVersion: version,
    workspaceSchema: z.strictObject({
      minimum: z.number().int().nonnegative(),
      maximum: z.number().int().nonnegative()
    }),
    moduleApi: z.number().int().positive()
  }),
  qualification: z.strictObject({
    status: z.enum(['qualified', 'pending', 'failed']),
    artifactSha256: digest,
    evidenceUrl: evidence,
    testedOS: z.string().min(1).max(160),
    installed: z.boolean(),
    offline: z.boolean(),
    restart: z.boolean(),
    recovery: z.boolean(),
    uninstall: z.boolean()
  }),
  approvals: z.strictObject({
    rights: approval,
    security: approval,
    publication: approval
  }),
  guidance: z.strictObject({
    install: z.string().min(1).max(4000),
    update: z.string().min(1).max(4000),
    uninstall: z.string().min(1).max(4000),
    releaseNotes: z.string().min(1).max(8000),
    knownGaps: z.array(z.string().min(1).max(1000)).max(40),
    localClientSupport: z.string().min(1).max(2000)
  })
})

export const releasePayloadSchema = z.strictObject({
  generatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  releases: z.array(releaseSchema).max(200)
})

export const releaseManifestSchema = z.strictObject({
  schemaVersion: z.literal(RELEASE_MANIFEST_VERSION),
  purpose: z.enum(['release', 'fixture']),
  keyId: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/),
  payload: releasePayloadSchema,
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/)
})

export type Release = z.infer<typeof releaseSchema>
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>
export type Platform = (typeof platforms)[number]
export type Channel = (typeof channels)[number]
