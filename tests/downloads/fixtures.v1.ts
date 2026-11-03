import { generateKeyPairSync, sign } from 'node:crypto'
import {
  canonicalJson,
  unsignedEnvelope
} from '../../app/lib/downloads/manifest'
import {
  type Platform,
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

export function linuxReleaseDouble(overrides: Partial<Release> = {}): Release {
  return releaseDouble(overrides)
}

export function macosReleaseDouble(overrides: Partial<Release> = {}): Release {
  const minimumOS = 'Synthetic macOS 12'
  return releaseDouble({
    id: 'synthetic-macos-v1',
    platform: 'macos',
    architecture: 'arm64',
    minimumOS,
    artifact: {
      url: `https://github.com/thetimmyman/tacticus-analytics/releases/download/v1.0.0/${artifactSha256}-synthetic.dmg`,
      sha256: artifactSha256,
      size: 1024,
      format: 'dmg',
      signature: { status: 'verified', scheme: 'apple-code-sign', evidenceUrl },
      notarization: { status: 'verified', evidenceUrl },
      provisioning: { status: 'not-required', evidenceUrl: null }
    },
    distribution: { method: 'direct', url: null },
    qualification: {
      evidenceSchema: 'platform-evidence/v1',
      sourceCommit,
      status: 'qualified',
      artifactSha256,
      evidenceUrl,
      testedOS: minimumOS,
      installed: true,
      offline: true,
      restart: true,
      recovery: true,
      uninstall: true
    },
    ...overrides
  })
}

export function windowsReleaseDouble(
  overrides: Partial<Release> = {}
): Release {
  const minimumOS = 'Synthetic Windows 10'
  return releaseDouble({
    id: 'synthetic-windows-v1',
    platform: 'windows',
    architecture: 'x64',
    minimumOS,
    artifact: {
      url: `https://github.com/thetimmyman/tacticus-analytics/releases/download/v1.0.0/${artifactSha256}-synthetic.msix`,
      sha256: artifactSha256,
      size: 1024,
      format: 'msix',
      signature: { status: 'verified', scheme: 'authenticode', evidenceUrl },
      notarization: { status: 'not-required', evidenceUrl: null },
      provisioning: { status: 'not-required', evidenceUrl: null }
    },
    distribution: { method: 'direct', url: null },
    qualification: {
      evidenceSchema: 'platform-evidence/v1',
      sourceCommit,
      status: 'qualified',
      artifactSha256,
      evidenceUrl,
      testedOS: minimumOS,
      installed: true,
      offline: true,
      restart: true,
      recovery: true,
      uninstall: true
    },
    ...overrides
  })
}

export function androidReleaseDouble(
  overrides: Partial<Release> = {}
): Release {
  const minimumOS = 'Synthetic Android 12'
  return releaseDouble({
    id: 'synthetic-android-v1',
    platform: 'android',
    architecture: 'arm64',
    minimumOS,
    artifact: {
      url: `https://github.com/thetimmyman/tacticus-analytics/releases/download/v1.0.0/${artifactSha256}-synthetic.apk`,
      sha256: artifactSha256,
      size: 1024,
      format: 'apk',
      signature: { status: 'verified', scheme: 'android-apk', evidenceUrl },
      notarization: { status: 'not-required', evidenceUrl: null },
      provisioning: { status: 'not-required', evidenceUrl: null }
    },
    distribution: {
      method: 'play-store',
      url: 'https://play.google.com/store/apps/details?id=com.tacticusanalytics.synthetic'
    },
    qualification: {
      evidenceSchema: 'platform-evidence/v1',
      sourceCommit,
      status: 'qualified',
      artifactSha256,
      evidenceUrl,
      testedOS: minimumOS,
      installed: true,
      offline: true,
      restart: true,
      recovery: true,
      uninstall: true
    },
    ...overrides
  })
}

export function iosReleaseDouble(overrides: Partial<Release> = {}): Release {
  const minimumOS = 'Synthetic iOS 16'
  return releaseDouble({
    id: 'synthetic-ios-v1',
    platform: 'ios',
    architecture: 'arm64',
    minimumOS,
    artifact: {
      url: `https://github.com/thetimmyman/tacticus-analytics/releases/download/v1.0.0/${artifactSha256}-synthetic.ipa`,
      sha256: artifactSha256,
      size: 1024,
      format: 'ipa',
      signature: { status: 'verified', scheme: 'apple-code-sign', evidenceUrl },
      notarization: { status: 'not-required', evidenceUrl: null },
      provisioning: { status: 'verified', evidenceUrl }
    },
    distribution: {
      method: 'app-store',
      url: 'https://apps.apple.com/us/app/synthetic-app/id1234567890'
    },
    qualification: {
      evidenceSchema: 'platform-evidence/v1',
      sourceCommit,
      status: 'qualified',
      artifactSha256,
      evidenceUrl,
      testedOS: minimumOS,
      installed: true,
      offline: true,
      restart: true,
      recovery: true,
      uninstall: true
    },
    ...overrides
  })
}

export function representativePlatformReleases(): Release[] {
  return [
    linuxReleaseDouble(),
    macosReleaseDouble(),
    windowsReleaseDouble(),
    androidReleaseDouble(),
    iosReleaseDouble()
  ]
}

export function candidateReleaseDouble(
  platform: Platform,
  overrides: Partial<Release> = {}
): Release {
  const formatMap: Record<Platform, Release['artifact']['format']> = {
    linux: 'appimage',
    macos: 'dmg',
    windows: 'msix',
    android: 'apk',
    ios: 'ipa'
  }
  const schemeMap: Record<
    Platform,
    Release['artifact']['signature']['scheme']
  > = {
    linux: 'ed25519',
    macos: 'apple-code-sign',
    windows: 'authenticode',
    android: 'android-apk',
    ios: 'apple-code-sign'
  }
  const minimumOSMap: Record<Platform, string> = {
    linux: 'Synthetic Linux 1',
    macos: 'Synthetic macOS 12',
    windows: 'Synthetic Windows 10',
    android: 'Synthetic Android 12',
    ios: 'Synthetic iOS 16'
  }
  const distributionMap: Record<Platform, Release['distribution']> = {
    linux: { method: 'direct', url: null },
    macos: { method: 'direct', url: null },
    windows: { method: 'direct', url: null },
    android: {
      method: 'play-store',
      url: 'https://play.google.com/store/apps/details?id=com.tacticusanalytics.synthetic'
    },
    ios: {
      method: 'app-store',
      url: 'https://apps.apple.com/us/app/synthetic-app/id1234567890'
    }
  }

  const format = formatMap[platform]
  const minimumOS = minimumOSMap[platform]

  return {
    id: `synthetic-${platform}-candidate-v1`,
    component: 'core',
    platform,
    architecture:
      platform === 'windows' || platform === 'linux' ? 'x64' : 'arm64',
    minimumOS,
    channel: 'stable',
    version: '1.0.0',
    releasedAt: '2026-01-01T00:00:00Z',
    sourceCommit,
    state: 'candidate',
    artifact: {
      url: `https://github.com/thetimmyman/tacticus-analytics/releases/download/v1.0.0/${artifactSha256}-synthetic.${format}`,
      sha256: artifactSha256,
      size: 1024,
      format,
      signature: {
        status: 'pending',
        scheme: schemeMap[platform],
        evidenceUrl: null
      },
      notarization: {
        status: platform === 'macos' ? 'pending' : 'not-required',
        evidenceUrl: null
      },
      provisioning: {
        status: platform === 'ios' ? 'pending' : 'not-required',
        evidenceUrl: null
      }
    },
    distribution: distributionMap[platform],
    compatibility: {
      coreVersion: '1.0.0',
      workspaceSchema: { minimum: 1, maximum: 1 },
      moduleApi: 1
    },
    qualification: {
      evidenceSchema: 'platform-evidence/v1',
      sourceCommit,
      status: 'pending',
      artifactSha256,
      evidenceUrl: null,
      testedOS: minimumOS,
      installed: false,
      offline: false,
      restart: false,
      recovery: false,
      uninstall: false
    },
    approvals: {
      rights: { status: 'pending', evidenceUrl: null },
      security: { status: 'pending', evidenceUrl: null },
      publication: { status: 'pending', evidenceUrl: null }
    },
    guidance: {
      install: `Synthetic install guidance for ${platform}.`,
      update: `Synthetic update guidance for ${platform}.`,
      uninstall: `Synthetic uninstall guidance for ${platform}; local data retained.`,
      releaseNotes: 'Versioned test double candidate; not a real artifact.',
      knownGaps: ['Qualification is incomplete and unverified.'],
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
