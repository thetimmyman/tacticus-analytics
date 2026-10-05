import { createPublicKey, verify } from 'node:crypto'
import {
  releaseManifestSchema,
  type Release,
  type ReleaseManifest
} from './schema'

export const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_MANIFEST_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function unsignedEnvelope(manifest: ReleaseManifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    purpose: manifest.purpose,
    keyId: manifest.keyId,
    payload: manifest.payload
  }
}

export function validateManifest(
  input: unknown,
  trustedKeys: Record<string, string>,
  now = Date.now()
): ReleaseManifest {
  const manifest = releaseManifestSchema.parse(input)
  if (manifest.purpose !== 'release')
    throw new Error('Fixture manifests cannot publish releases')
  const generated = Date.parse(manifest.payload.generatedAt)
  const expires = Date.parse(manifest.payload.expiresAt)
  if (
    generated > now ||
    expires <= now ||
    expires <= generated ||
    expires - generated > MAX_MANIFEST_AGE_MS
  ) {
    throw new Error('Manifest is stale or outside its validity window')
  }
  if (!Object.hasOwn(trustedKeys, manifest.keyId))
    throw new Error('Untrusted manifest key')
  const trustedKey = trustedKeys[manifest.keyId]
  if (!trustedKey) throw new Error('Untrusted manifest key')
  const key = createPublicKey(trustedKey)
  if (key.asymmetricKeyType !== 'ed25519')
    throw new Error('Unsupported manifest key')
  const signature = Buffer.from(manifest.signature, 'base64')
  if (
    signature.toString('base64') !== manifest.signature ||
    !verify(
      null,
      Buffer.from(canonicalJson(unsignedEnvelope(manifest))),
      key,
      signature
    )
  ) {
    throw new Error('Manifest signature verification failed')
  }
  const ids = manifest.payload.releases.map((release) => release.id)
  if (new Set(ids).size !== ids.length)
    throw new Error('Duplicate release identifier')
  for (const release of manifest.payload.releases) {
    if (Date.parse(release.releasedAt) > generated)
      throw new Error('Release date exceeds manifest date')
  }
  return manifest
}

function safeUrl(value: string, allowQuery = false): URL | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      (!allowQuery && url.search) ||
      /%|\\/.test(value)
    )
      return null
    return url
  } catch {
    return null
  }
}

export function publicEvidenceUrl(value: string | null): boolean {
  if (!value) return false
  const url = safeUrl(value)
  return (
    !!url &&
    ((url.hostname === 'tacticusanalytics.com' &&
      url.pathname.startsWith('/releases/evidence/')) ||
      (url.hostname === 'github.com' &&
        /^\/thetimmyman\/tacticus-analytics\/blob\/[a-f0-9]{40}\/docs\/releases\//.test(
          url.pathname
        )))
  )
}

export function immutableArtifactUrl(release: Release): boolean {
  const url = safeUrl(release.artifact.url)
  if (!url) return false
  const filename = url.pathname.split('/').at(-1) || ''
  if (
    !filename.startsWith(`${release.artifact.sha256}-`) ||
    !filename.endsWith(`.${release.artifact.format}`)
  )
    return false
  return (
    (url.hostname === 'downloads.tacticusanalytics.com' &&
      url.pathname === `/releases/sha256/${filename}`) ||
    (url.hostname === 'github.com' &&
      url.pathname ===
        `/thetimmyman/tacticus-analytics/releases/download/v${release.version}/${filename}`)
  )
}

function approvedDistribution(release: Release): boolean {
  const { method, url: value } = release.distribution
  if (method === 'direct')
    return (
      value === null &&
      release.platform !== 'ios' &&
      release.artifact.format !== 'aab'
    )
  if (!value) return false
  const url = safeUrl(value, method === 'play-store')
  if (!url) return false
  if (method === 'app-store')
    return (
      release.platform === 'ios' &&
      release.channel === 'stable' &&
      url.hostname === 'apps.apple.com' &&
      /^\/[a-z]{2}\/app\/[a-z0-9-]+\/id\d+$/.test(url.pathname)
    )
  if (method === 'testflight')
    return (
      release.platform === 'ios' &&
      release.channel === 'preview' &&
      url.hostname === 'testflight.apple.com' &&
      /^\/join\/[A-Za-z0-9]{8}$/.test(url.pathname)
    )
  if (method === 'play-store') {
    return (
      release.platform === 'android' &&
      url.hostname === 'play.google.com' &&
      url.pathname === '/store/apps/details' &&
      [...url.searchParams].length === 1 &&
      /^[a-z][a-z0-9_.]+$/.test(url.searchParams.get('id') || '')
    )
  }
  return false
}

export function releaseBlockers(release: Release): string[] {
  const blockers: string[] = []
  const { artifact, qualification, compatibility } = release
  if (release.state !== 'published')
    blockers.push('Release has not been published')
  if (!immutableArtifactUrl(release))
    blockers.push('Artifact destination is not approved or digest addressed')
  if (!approvedDistribution(release))
    blockers.push('Distribution channel is not approved for this platform')
  if (release.channel === 'stable' && release.version.includes('-'))
    blockers.push('Stable releases cannot use preview versions')
  if (
    compatibility.workspaceSchema.minimum >
      compatibility.workspaceSchema.maximum ||
    (release.component === 'core' &&
      compatibility.coreVersion !== release.version)
  )
    blockers.push('Release compatibility is invalid')
  const platformFormats = {
    linux: ['appimage', 'deb', 'rpm'],
    macos: ['dmg', 'pkg'],
    windows: ['exe', 'msix'],
    android: ['apk', 'aab'],
    ios: ['ipa']
  }
  if (
    !platformFormats[release.platform].includes(artifact.format) ||
    (release.platform !== 'macos' && release.architecture === 'universal') ||
    (release.platform === 'ios' && release.architecture !== 'arm64')
  )
    blockers.push('Platform, architecture or package format is unsupported')
  const scheme = {
    linux: 'ed25519',
    macos: 'apple-code-sign',
    windows: 'authenticode',
    android: 'android-apk',
    ios: 'apple-code-sign'
  }
  if (
    artifact.signature.status !== 'verified' ||
    artifact.signature.scheme !== scheme[release.platform] ||
    !publicEvidenceUrl(artifact.signature.evidenceUrl)
  )
    blockers.push('Artifact signature has not been verified')
  if (release.platform === 'macos') {
    if (
      artifact.notarization.status !== 'verified' ||
      !publicEvidenceUrl(artifact.notarization.evidenceUrl)
    )
      blockers.push('macOS notarization has not been verified')
  } else if (artifact.notarization.status !== 'not-required')
    blockers.push('Unexpected notarization status')
  if (release.platform === 'ios') {
    if (
      artifact.provisioning.status !== 'verified' ||
      !publicEvidenceUrl(artifact.provisioning.evidenceUrl)
    )
      blockers.push('iOS provisioning has not been verified')
  } else if (artifact.provisioning.status !== 'not-required')
    blockers.push('Unexpected provisioning status')
  if (
    qualification.status !== 'qualified' ||
    qualification.artifactSha256 !== artifact.sha256 ||
    qualification.sourceCommit !== release.sourceCommit ||
    !publicEvidenceUrl(qualification.evidenceUrl) ||
    ![
      qualification.installed,
      qualification.offline,
      qualification.restart,
      qualification.recovery,
      qualification.uninstall
    ].every(Boolean)
  )
    blockers.push('Installed artifact qualification is incomplete')
  if (
    Object.values(release.approvals).some(
      (item) =>
        item.status !== 'approved' || !publicEvidenceUrl(item.evidenceUrl)
    )
  )
    blockers.push('Rights, security or publication approval is incomplete')
  return blockers
}

export function releaseDestination(release: Release): string {
  return release.distribution.url ?? release.artifact.url
}
