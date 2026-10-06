import { generateKeyPairSync, sign } from 'node:crypto'
import {
  canonicalJson,
  unsignedEnvelope
} from '../../app/lib/downloads/manifest'
import {
  type Release,
  type ReleaseManifest
} from '../../app/lib/downloads/schema'

// Runtime-generated test keys and invented metadata prove consumer behavior only.
export const testNow = Date.parse('2026-01-01T12:00:00Z')
const sourceCommit = 'a'.repeat(40)
const artifactSha256 = 'b'.repeat(64)
const evidenceUrl = `https://github.com/thetimmyman/tacticus-analytics/blob/${sourceCommit}/docs/releases/synthetic-evidence.json`

export function releaseDouble(overrides: Partial<Release> = {}): Release {
  return {
    id: 'synthetic-linux-v1',
    component: 'core',
    platform: 'linux',
    architecture: 'x64',
    minimumOS: 'Synthetic Linux 1',
    channel: 'stable',
    version: '1.0.0',
    releasedAt: '2026-01-01T00:00:00Z',
    sourceCommit,
    state: 'published',
    artifact: {
      url: `https://github.com/thetimmyman/tacticus-analytics/releases/download/v1.0.0/${artifactSha256}-synthetic.appimage`,
      sha256: artifactSha256,
      size: 1024,
      format: 'appimage',
      signature: { status: 'verified', scheme: 'ed25519', evidenceUrl },
      notarization: { status: 'not-required', evidenceUrl: null },
      provisioning: { status: 'not-required', evidenceUrl: null }
    },
    distribution: { method: 'direct', url: null },
    compatibility: {
      coreVersion: '1.0.0',
      workspaceSchema: { minimum: 1, maximum: 1 },
      moduleApi: 1
    },
    qualification: {
      evidenceSchema: 'platform-evidence/v1',
      sourceCommit,
      status: 'qualified',
      artifactSha256,
      evidenceUrl,
      testedOS: 'Synthetic Linux 1',
      installed: true,
      offline: true,
      restart: true,
      recovery: true,
      uninstall: true
    },
    approvals: {
      rights: { status: 'approved', evidenceUrl },
      security: { status: 'approved', evidenceUrl },
      publication: { status: 'approved', evidenceUrl }
    },
    guidance: {
      install: 'Synthetic install guidance.',
      update: 'Synthetic update guidance.',
      uninstall: 'Synthetic uninstall guidance; local data retained.',
      releaseNotes: 'Versioned test double; not a real artifact.',
      knownGaps: ['Synthetic qualification is not installed proof.'],
      localClientSupport: 'Synthetic local discovery unavailable.'
    },
    ...overrides
  }
}

export function signedDouble(
  releases = [releaseDouble()],
  mutate?: (manifest: ReleaseManifest) => void
) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    purpose: 'release',
    keyId: 'runtime-test-double-v1',
    payload: {
      generatedAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-01-02T00:00:00Z',
      releases
    },
    signature: ''
  }
  mutate?.(manifest)
  manifest.signature = sign(
    null,
    Buffer.from(canonicalJson(unsignedEnvelope(manifest))),
    privateKey
  ).toString('base64')
  return {
    manifest,
    keys: {
      [manifest.keyId]: publicKey
        .export({ format: 'pem', type: 'spki' })
        .toString()
    }
  }
}
