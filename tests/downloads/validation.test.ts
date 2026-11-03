import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  releaseBlockers,
  validateManifest
} from '../../app/lib/downloads/manifest'
import { downloadsPolicy } from '../../app/lib/downloads/policy'
import { releaseSchema } from '../../app/lib/downloads/schema'
import { resolveDownloads } from '../../app/lib/downloads/state'
import {
  androidReleaseDouble,
  candidateReleaseDouble,
  iosReleaseDouble,
  linuxReleaseDouble,
  macosReleaseDouble,
  releaseDouble,
  representativePlatformReleases,
  signedDouble,
  testNow,
  windowsReleaseDouble
} from './fixtures.v1'

const enabled = downloadsPolicy({
  DOWNLOADS_ENABLED: 'true',
  DOWNLOADS_READY_PLATFORMS: 'linux:stable'
})

describe('signed release manifest and promotion gates', () => {
  it('canonicalizes nested object keys without sorting arrays', () => {
    expect(canonicalJson({ z: [2, 1], a: { c: 2, b: 1 } })).toBe(
      '{"a":{"b":1,"c":2},"z":[2,1]}'
    )
  })

  it('accepts trusted signed versioned test doubles without proving a real release', () => {
    const { manifest, keys } = signedDouble()
    expect(validateManifest(manifest, keys, testNow)).toEqual(manifest)
    expect(
      resolveDownloads(manifest, enabled, keys, testNow).releases
    ).toHaveLength(1)
  })

  it('rejects untrusted, tampered, unknown-field and visibly fixture envelopes', () => {
    const { manifest, keys } = signedDouble()
    expect(() => validateManifest(manifest, {}, testNow)).toThrow('Untrusted')
    expect(() =>
      validateManifest({ ...manifest, keyId: 'constructor' }, keys, testNow)
    ).toThrow('Untrusted')
    expect(() =>
      validateManifest(
        { ...manifest, signature: 'A'.repeat(86) + '==' },
        keys,
        testNow
      )
    ).toThrow('signature')
    manifest.payload.releases[0].artifact.size++
    expect(() => validateManifest(manifest, keys, testNow)).toThrow('signature')
    expect(() =>
      validateManifest({ ...manifest, bypass: true }, keys, testNow)
    ).toThrow()
    const fixture = signedDouble([], (item) => {
      item.purpose = 'fixture'
    })
    expect(() =>
      validateManifest(fixture.manifest, fixture.keys, testNow)
    ).toThrow('Fixture')
  })

  it('rejects stale and future envelopes, duplicate identities and future releases', () => {
    const { manifest, keys } = signedDouble()
    expect(() =>
      validateManifest(manifest, keys, Date.parse('2026-01-02T00:00:00Z'))
    ).toThrow('stale')
    expect(() =>
      validateManifest(manifest, keys, Date.parse('2025-12-31T00:00:00Z'))
    ).toThrow('stale')
    const duplicates = signedDouble([releaseDouble(), releaseDouble()])
    expect(() =>
      validateManifest(duplicates.manifest, duplicates.keys, testNow)
    ).toThrow('Duplicate')
    const future = signedDouble([
      releaseDouble({ releasedAt: '2026-01-01T01:00:00Z' })
    ])
    expect(() =>
      validateManifest(future.manifest, future.keys, testNow)
    ).toThrow('Release date')
  })

  it.each([
    'http://github.com/thetimmyman/tacticus-analytics/releases/download/v1.0.0/file.appimage',
    'https://github.com.evil.invalid/thetimmyman/tacticus-analytics/releases/download/v1.0.0/file.appimage',
    'https://user:password@github.com/thetimmyman/tacticus-analytics/releases/download/v1.0.0/file.appimage',
    'javascript:alert(1)',
    'https://downloads.tacticusanalytics.com/releases/sha256/file.appimage',
    'https://github.com/thetimmyman/tacticus-analytics/releases/download/latest/file.appimage'
  ])('never offers malicious or mutable artifact URL %s', (url) => {
    const release = releaseDouble()
    release.artifact.url = url
    const { manifest, keys } = signedDouble([release])
    expect(resolveDownloads(manifest, enabled, keys, testNow).releases).toEqual(
      []
    )
  })

  it.each(['signature', 'notarization', 'provisioning'] as const)(
    'rejects failed %s metadata',
    (field) => {
      const release = releaseDouble()
      release.artifact[field].status = 'failed'
      expect(releaseBlockers(release).length).toBeGreaterThan(0)
    }
  )

  it('rejects revoked, wrong platform, digest mismatch and incomplete qualification', () => {
    for (const edit of [
      (release: ReturnType<typeof releaseDouble>) => {
        release.state = 'revoked'
      },
      (release: ReturnType<typeof releaseDouble>) => {
        release.platform = 'windows'
      },
      (release: ReturnType<typeof releaseDouble>) => {
        release.qualification.artifactSha256 = 'c'.repeat(64)
      },
      (release: ReturnType<typeof releaseDouble>) => {
        release.qualification.sourceCommit = 'c'.repeat(40)
      },
      (release: ReturnType<typeof releaseDouble>) => {
        release.qualification.testedOS = 'Synthetic Linux 0'
      },
      (release: ReturnType<typeof releaseDouble>) => {
        release.qualification.offline = false
      },
      (release: ReturnType<typeof releaseDouble>) => {
        release.approvals.rights.status = 'pending'
      },
      (release: ReturnType<typeof releaseDouble>) => {
        release.approvals.security.evidenceUrl =
          'https://private.invalid/evidence'
      },
      (release: ReturnType<typeof releaseDouble>) => {
        release.compatibility.coreVersion = '2.0.0'
      }
    ]) {
      const release = releaseDouble()
      edit(release)
      expect(releaseBlockers(release).length).toBeGreaterThan(0)
    }
  })

  it('requires iOS provisioning and approved store distribution and prevents direct IPA offers', () => {
    const ios = releaseDouble({ platform: 'ios', architecture: 'arm64' })
    ios.artifact.format = 'ipa'
    ios.artifact.url = ios.artifact.url.replace('.appimage', '.ipa')
    ios.artifact.signature.scheme = 'apple-code-sign'
    ios.artifact.provisioning = {
      status: 'verified',
      evidenceUrl: ios.qualification.evidenceUrl
    }
    expect(releaseBlockers(ios)).toContain(
      'Distribution channel is not approved for this platform'
    )
    ios.distribution = {
      method: 'app-store',
      url: 'https://apps.apple.com/us/app/synthetic-app/id1234567890'
    }
    expect(releaseBlockers(ios)).toEqual([])
    ios.distribution = {
      method: 'testflight',
      url: 'https://testflight.apple.com/join/AbCd1234'
    }
    expect(releaseBlockers(ios).length).toBeGreaterThan(0)
    ios.channel = 'preview'
    expect(releaseBlockers(ios)).toEqual([])
  })

  it('fails closed for flag off/missing manifest/readiness and applies immediate revocation/freshness floors', () => {
    const { manifest, keys } = signedDouble()
    expect(
      resolveDownloads(manifest, downloadsPolicy({}), keys, testNow).status
    ).toBe('disabled')
    expect(resolveDownloads(null, enabled, keys, testNow).status).toBe(
      'unavailable'
    )
    expect(
      resolveDownloads(
        manifest,
        downloadsPolicy({ DOWNLOADS_ENABLED: 'true' }),
        keys,
        testNow
      ).releases
    ).toEqual([])
    expect(
      resolveDownloads(
        manifest,
        { ...enabled, revoked: ['synthetic-linux-v1'] },
        keys,
        testNow
      ).releases
    ).toEqual([])
    expect(
      resolveDownloads(
        manifest,
        { ...enabled, minimumGeneratedAt: testNow },
        keys,
        testNow
      ).status
    ).toBe('unavailable')
  })

  it('keeps reviewer preview access separate from public stable flags and rejects malformed policy', () => {
    const token = 'synthetic-review-token'.repeat(3)
    const previewEnv = {
      DOWNLOADS_PREVIEW_ENABLED: 'true',
      DOWNLOADS_PREVIEW_TOKEN: token,
      DOWNLOADS_READY_PLATFORMS: 'linux:preview'
    }
    expect(downloadsPolicy(previewEnv).enabled).toBe(false)
    expect(downloadsPolicy(previewEnv, token).channels).toEqual(['preview'])
    expect(downloadsPolicy(previewEnv, 'wrong').enabled).toBe(false)
    expect(downloadsPolicy({ DOWNLOADS_ENABLED: '1' }).enabled).toBe(false)
    expect(
      downloadsPolicy({
        DOWNLOADS_ENABLED: 'true',
        DOWNLOADS_READY_PLATFORMS: 'linux:stable,unknown:stable'
      }).enabled
    ).toBe(false)
    expect(
      downloadsPolicy({
        DOWNLOADS_ENABLED: 'true',
        DOWNLOADS_MIN_GENERATED_AT: 'invalid'
      }).enabled
    ).toBe(false)
    expect(
      downloadsPolicy({
        DOWNLOADS_ENABLED: 'true',
        DOWNLOADS_REVOKED_RELEASE_IDS: '*'
      }).enabled
    ).toBe(false)
  })

  describe('representative platform release fixtures and constraints', () => {
    it('qualifies each representative platform test double', () => {
      const platforms = representativePlatformReleases()
      expect(platforms).toHaveLength(5)
      for (const release of platforms) {
        expect(releaseSchema.parse(release)).toEqual(release)
        expect(releaseBlockers(release)).toEqual([])
      }
    })

    it('rejects candidate releases with honest incomplete qualification and pending approvals', () => {
      for (const platform of [
        'linux',
        'macos',
        'windows',
        'android',
        'ios'
      ] as const) {
        const candidate = candidateReleaseDouble(platform)
        expect(releaseSchema.parse(candidate)).toEqual(candidate)
        const blockers = releaseBlockers(candidate)
        expect(blockers).toContain('Release has not been published')
        expect(blockers).toContain('Artifact signature has not been verified')
        expect(blockers).toContain(
          'Installed artifact qualification is incomplete'
        )
        expect(blockers).toContain(
          'Rights, security or publication approval is incomplete'
        )
      }
    })

    it('enforces platform-specific signing, notarization, and distribution constraints across all platforms', () => {
      // macOS requires notarization verified
      const macos = macosReleaseDouble()
      macos.artifact.notarization.status = 'pending'
      expect(releaseBlockers(macos)).toContain(
        'macOS notarization has not been verified'
      )

      // macOS requires apple-code-sign
      const macosBadSig = macosReleaseDouble()
      macosBadSig.artifact.signature.scheme = 'authenticode'
      expect(releaseBlockers(macosBadSig)).toContain(
        'Artifact signature has not been verified'
      )

      // Windows requires authenticode and exe/msix
      const winBadScheme = windowsReleaseDouble()
      winBadScheme.artifact.signature.scheme = 'ed25519'
      expect(releaseBlockers(winBadScheme)).toContain(
        'Artifact signature has not been verified'
      )

      const winBadFormat = windowsReleaseDouble()
      winBadFormat.artifact.format = 'dmg'
      expect(releaseBlockers(winBadFormat)).toContain(
        'Platform, architecture or package format is unsupported'
      )

      // Android requires android-apk and disallows direct distribution for AAB
      const androidBadScheme = androidReleaseDouble()
      androidBadScheme.artifact.signature.scheme = 'ed25519'
      expect(releaseBlockers(androidBadScheme)).toContain(
        'Artifact signature has not been verified'
      )

      const androidAabDirect = androidReleaseDouble()
      androidAabDirect.artifact.format = 'aab'
      androidAabDirect.distribution = { method: 'direct', url: null }
      expect(releaseBlockers(androidAabDirect)).toContain(
        'Distribution channel is not approved for this platform'
      )

      // Universal architecture is prohibited outside macOS
      const linuxUniversal = linuxReleaseDouble({ architecture: 'universal' })
      expect(releaseBlockers(linuxUniversal)).toContain(
        'Platform, architecture or package format is unsupported'
      )

      // Non-arm64 architecture is prohibited on iOS
      const iosX64 = iosReleaseDouble({ architecture: 'x64' })
      expect(releaseBlockers(iosX64)).toContain(
        'Platform, architecture or package format is unsupported'
      )
    })

    it('validates a signed manifest containing all 5 qualified platform releases', () => {
      const allPlatforms = representativePlatformReleases()
      const { manifest, keys } = signedDouble(allPlatforms)
      const validated = validateManifest(manifest, keys, testNow)
      expect(validated.payload.releases).toHaveLength(5)

      const resolved = resolveDownloads(
        manifest,
        downloadsPolicy({
          DOWNLOADS_ENABLED: 'true',
          DOWNLOADS_READY_PLATFORMS:
            'linux:stable,macos:stable,windows:stable,android:stable,ios:stable'
        }),
        keys,
        testNow
      )
      expect(resolved.releases).toHaveLength(5)
    })
  })
})
