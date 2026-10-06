import { generateKeyPairSync, sign } from 'node:crypto'
import {
  canonicalJson,
  type AddonId,
  type AddonManifest
} from '../../packages/addon-host/src/contract'
import {
  sha256,
  type HostPolicy,
  type PackageBundle
} from '../../packages/addon-host/src/host'

// Ephemeral test keys never leave a test process and are not release signing identities.
export function fixturePolicy(overrides: Partial<HostPolicy> = {}): {
  policy: HostPolicy
  bundle: (
    addon: AddonId,
    version?: string,
    changes?: Partial<AddonManifest>
  ) => PackageBundle
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const review = sha256('synthetic-reviewed-source'),
    rights = sha256('synthetic-approved-rights')
  return {
    policy: {
      coreVersion: '1.0.0',
      platform: 'linux',
      architecture: 'x64',
      trustedKeys: new Map([['synthetic-test-key', publicKey]]),
      revokedKeyIds: new Set(),
      approvedReviews: new Set([review]),
      approvedRightsReceipts: new Set([rights]),
      ...overrides
    },
    bundle(addon, version = '1.0.0', changes = {}) {
      const descriptor = Buffer.from(
        canonicalJson({
          schemaVersion: 1,
          addonId: addon,
          format:
            addon === 'guild-war'
              ? 'ta-war-summary-v1'
              : 'ta-replay-timeline-v1'
        })
      )
      const notice = Buffer.from(
        'Synthetic package for tests. No game assets or captured data.'
      )
      const files = [
        { path: 'module.json', base64: descriptor.toString('base64') },
        { path: 'notice.txt', base64: notice.toString('base64') }
      ]
      const manifest: AddonManifest = {
        schemaVersion: 1,
        addonId: addon,
        version,
        publisher: 'tacticus-analytics',
        runtime: 'builtin-vetted-v1',
        source: {
          repository: 'https://github.com/thetimmyman/tacticus-analytics',
          commit: 'a'.repeat(40),
          reviewSha256: review,
          rightsReceiptSha256: rights
        },
        compatibility: {
          hostApiVersion: 1,
          coreMinVersion: '1.0.0',
          coreMaxVersion: '2.0.0',
          platforms: ['linux', 'macos', 'windows', 'android', 'ios'],
          architectures: ['x64', 'arm64'],
          dataSchemaVersion: 1
        },
        capabilities: ['offline.import', 'offline.read'],
        files: [
          {
            path: 'module.json',
            sha256: sha256(descriptor),
            bytes: descriptor.byteLength,
            kind: 'data'
          },
          {
            path: 'notice.txt',
            sha256: sha256(notice),
            bytes: notice.byteLength,
            kind: 'notice'
          }
        ],
        dependencies: [],
        ...changes
      }
      return {
        envelope: {
          manifest,
          signature: {
            algorithm: 'ed25519',
            keyId: 'synthetic-test-key',
            value: sign(
              null,
              Buffer.from(canonicalJson(manifest)),
              privateKey
            ).toString('base64')
          }
        },
        files
      }
    }
  }
}

export const war = {
  schemaVersion: 1,
  format: 'ta-war-summary-v1',
  season: 1,
  battles: [
    {
      battle: 1,
      attackerSlot: 1,
      zone: 1,
      points: 250,
      outcome: 'victory',
      occurredAt: 100
    },
    {
      battle: 2,
      attackerSlot: 2,
      zone: 1,
      points: 20,
      outcome: 'defeat',
      occurredAt: 120
    }
  ]
}
export const replay = {
  schemaVersion: 1,
  format: 'ta-replay-timeline-v1',
  durationMs: 1000,
  events: [
    { type: 'spawn', at: 0, entity: 1, side: 'allies', x: 1, y: 1, hp: 100 },
    { type: 'move', at: 250, entity: 1, x: 2, y: 2 },
    { type: 'damage', at: 500, entity: 1, amount: 30 },
    { type: 'remove', at: 750, entity: 1 }
  ]
}
