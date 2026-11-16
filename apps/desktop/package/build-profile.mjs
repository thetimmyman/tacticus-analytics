import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

const digest = (value) => createHash('sha256').update(value).digest('hex')
const HEX_40 = /^[a-f0-9]{40}$/
const HEX_64 = /^[a-f0-9]{64}$/

function optionalHex(value, pattern, label) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !pattern.test(value))
    throw new Error(`Invalid desktop build ${label}`)
  return value
}

export async function requireCleanBuildEnvironment(root) {
  for (const name of [
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local'
  ]) {
    try {
      await stat(join(root, name))
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    throw new Error(
      'Desktop builds require a checkout without automatic environment files'
    )
  }
}

function isolatedGitEnv(env = process.env) {
  const next = { ...env }
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_PREFIX',
    'GIT_CEILING_DIRECTORIES'
  ]) {
    delete next[key]
  }
  return next
}

function isAllowedIgnoredPath(rawEntry, allowBuildOutputs) {
  const entry = rawEntry.replaceAll('\\', '/')
  if (
    entry === 'node_modules' ||
    entry.startsWith('node_modules/') ||
    /^(?:packages|apps)\/[^/]+\/node_modules(?:\/|$)/.test(entry) ||
    entry === '.husky/_' ||
    entry.startsWith('.husky/_/') ||
    entry === '.npm' ||
    entry.startsWith('.npm/')
  )
    return true
  if (!allowBuildOutputs) return false
  return (
    entry === '.next' ||
    entry.startsWith('.next/') ||
    entry === 'next-env.d.ts' ||
    entry === 'tsconfig.tsbuildinfo' ||
    entry === '.swc' ||
    entry.startsWith('.swc/') ||
    entry === '.turbo' ||
    entry.startsWith('.turbo/')
  )
}

export async function captureCleanCheckoutProvenance(root, options = {}) {
  const { allowBuildOutputs = false } = options
  const gitEnv = isolatedGitEnv()
  const canonicalRoot = await realpath(root)
  let topLevel
  try {
    topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: canonicalRoot,
      env: gitEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  } catch {
    throw new Error('Desktop provenance requires a git checkout')
  }
  if ((await realpath(topLevel)) !== canonicalRoot)
    throw new Error('Desktop provenance requires the checkout root directory')
  const statusRaw = execFileSync(
    'git',
    [
      'status',
      '-z',
      '--porcelain=v1',
      '--ignored=matching',
      '--untracked-files=all'
    ],
    {
      cwd: canonicalRoot,
      env: gitEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  const records = statusRaw.split('\0').filter(Boolean)
  if (records.some((record) => !record.startsWith('!! ')))
    throw new Error(
      'Desktop provenance requires a clean git checkout without uncommitted or untracked changes'
    )
  const ignoredEntries = records.map((record) => record.slice(3))
  const disallowedIgnored = ignoredEntries.find(
    (entry) => !isAllowedIgnoredPath(entry, allowBuildOutputs)
  )
  if (disallowedIgnored)
    throw new Error(
      `Desktop provenance refuses gitignored checkout path: ${disallowedIgnored}`
    )
  const sourceCommit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: canonicalRoot,
    env: gitEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
  if (!HEX_40.test(sourceCommit))
    throw new Error('Invalid desktop build sourceCommit')
  const lockBytes = await readFile(join(canonicalRoot, 'package-lock.json'))
  return {
    sourceCommit,
    packageLockSha256: digest(lockBytes),
    lockBytes,
    ignoredEntries
  }
}

export function desktopBuildEnvironment(env) {
  const allowed = [
    'PATH',
    'HOME',
    'LANG',
    'LC_ALL',
    'TMPDIR',
    'TEMP',
    'TMP',
    'CI',
    'npm_config_cache',
    // Windows process essentials for npm.cmd and Node; none carry secrets.
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA'
  ]
  return {
    ...Object.fromEntries(
      allowed.filter((key) => env[key]).map((key) => [key, env[key]])
    ),
    STANDALONE_BUILD: 'true',
    NEXT_PUBLIC_RUNTIME_PROFILE: 'desktop',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3000/supabase',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'desktop-public',
    NEXT_TELEMETRY_DISABLED: '1'
  }
}

export function desktopBuildRecord(requiredFiles, buildId, provenance = {}) {
  const { config } = JSON.parse(requiredFiles)
  if (
    config?.output !== 'standalone' ||
    config.experimental?.proxyClientMaxBodySize !== 24 * 1024 * 1024 ||
    !buildId.trim()
  )
    throw new Error('A completed desktop standalone build is required')
  const sourceCommit = optionalHex(
    provenance.sourceCommit,
    HEX_40,
    'sourceCommit'
  )
  const packageLockSha256 = optionalHex(
    provenance.packageLockSha256,
    HEX_64,
    'packageLockSha256'
  )
  const applicationFiles =
    provenance.applicationFiles === undefined
      ? undefined
      : normalizeApplicationFiles(provenance.applicationFiles)
  return {
    format: 'ta-desktop-build-v1',
    profile: 'desktop',
    buildId: buildId.trim(),
    requiredFilesSha256: digest(requiredFiles),
    ...(sourceCommit ? { sourceCommit } : {}),
    ...(packageLockSha256 ? { packageLockSha256 } : {}),
    ...(applicationFiles
      ? {
          applicationFiles,
          applicationManifestSha256: applicationManifestDigest(applicationFiles)
        }
      : {})
  }
}

// Build outputs copied by stage-standalone.mjs into the packaged application tree.
export const APPLICATION_PAYLOAD_SOURCES = Object.freeze([
  Object.freeze({ from: '.next/standalone', to: '' }),
  Object.freeze({ from: '.next/static', to: '.next/static' }),
  Object.freeze({ from: 'public', to: 'public' })
])

// Files stage-standalone.mjs adds beside the compiled payload; each is verified separately.
const APPLICATION_RECORD_FILES = new Set([
  'desktop-build.json',
  '.next/desktop-build.json',
  'package-lock.json'
])

export const isApplicationNoticeName = (name) =>
  /^(?:LICEN[SC]E|NOTICE|COPYRIGHT|COPYING|AUTHORS)(?:[._-].*)?$/i.test(name) ||
  /\.LEGAL\.txt$/i.test(name)

const comparePaths = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function isSafeRelativePath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    path.split('/').every((part) => part && part !== '.' && part !== '..')
  )
}

function normalizeApplicationFiles(files) {
  if (!Array.isArray(files) || files.length === 0)
    throw new Error('Invalid desktop build applicationFiles')
  const normalized = files.map((file) => {
    if (
      !file ||
      typeof file !== 'object' ||
      Object.keys(file).sort().join(',') !== 'bytes,path,sha256' ||
      !isSafeRelativePath(file.path) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      typeof file.sha256 !== 'string' ||
      !HEX_64.test(file.sha256)
    )
      throw new Error('Invalid desktop build applicationFiles')
    return { path: file.path, bytes: file.bytes, sha256: file.sha256 }
  })
  for (let i = 1; i < normalized.length; i += 1)
    if (comparePaths(normalized[i - 1].path, normalized[i].path) >= 0)
      throw new Error('Invalid desktop build applicationFiles order')
  return normalized
}

export function applicationManifestDigest(files) {
  return digest(JSON.stringify(normalizeApplicationFiles(files)))
}

// Hash the payload as stage-standalone.mjs copies it (cp dereference: true follows links).
export async function captureApplicationPayload(root) {
  const files = new Map()
  async function walk(directory, prefix) {
    const entries = await readdir(directory)
    for (const name of entries) {
      const absolute = join(directory, name)
      const rel = prefix ? `${prefix}/${name}` : name
      const info = await stat(absolute)
      if (info.isDirectory()) await walk(absolute, rel)
      else if (info.isFile()) {
        const bytes = await readFile(absolute)
        const entry = { path: rel, bytes: bytes.length, sha256: digest(bytes) }
        const existing = files.get(rel)
        if (existing && existing.sha256 !== entry.sha256)
          throw new Error(
            `Conflicting desktop application payload path: ${rel}`
          )
        files.set(rel, entry)
      } else
        throw new Error(`Unsupported desktop application payload entry: ${rel}`)
    }
  }
  for (const { from, to } of APPLICATION_PAYLOAD_SOURCES)
    await walk(join(root, from), to)
  return [...files.values()].sort((a, b) => comparePaths(a.path, b.path))
}

/**
 * Re-hash every file in a staged application tree against the build record.
 * Refuses symlinks, special files, missing, modified and unexpected files.
 * Returns a digest for every file so callers can cross-check later copies.
 */
export async function verifyApplicationPayload(applicationDirectory, record) {
  if (
    !record ||
    record.applicationFiles === undefined ||
    typeof record.applicationManifestSha256 !== 'string'
  )
    throw new Error(
      'Desktop build record does not bind the application payload; rebuild with npm run desktop:build'
    )
  const expected = normalizeApplicationFiles(record.applicationFiles)
  if (applicationManifestDigest(expected) !== record.applicationManifestSha256)
    throw new Error('Desktop build application manifest digest mismatch')
  const manifest = new Map(expected.map((file) => [file.path, file]))
  const digests = new Map()
  async function walk(directory, prefix) {
    const entries = await readdir(directory)
    for (const name of entries) {
      const absolute = join(directory, name)
      const rel = prefix ? `${prefix}/${name}` : name
      const info = await lstat(absolute)
      if (info.isSymbolicLink())
        throw new Error(`Symlink in staged application refused: ${rel}`)
      if (info.isDirectory()) await walk(absolute, rel)
      else if (info.isFile()) {
        const bytes = await readFile(absolute)
        digests.set(rel, { bytes: bytes.length, sha256: digest(bytes) })
      } else throw new Error(`Unsupported staged application entry: ${rel}`)
    }
  }
  const root = await lstat(applicationDirectory)
  if (root.isSymbolicLink() || !root.isDirectory())
    throw new Error('Staged application must be a real directory')
  await walk(applicationDirectory, '')
  for (const [rel, actual] of digests) {
    const bound = manifest.get(rel)
    if (bound) {
      if (bound.sha256 !== actual.sha256 || bound.bytes !== actual.bytes)
        throw new Error(
          `Staged application file does not match build record: ${rel}`
        )
    } else if (
      !APPLICATION_RECORD_FILES.has(rel) &&
      !(
        rel.startsWith('third-party-notices/') &&
        isApplicationNoticeName(basename(rel))
      )
    )
      throw new Error(`Unexpected file in staged application: ${rel}`)
  }
  for (const rel of manifest.keys())
    if (!digests.has(rel))
      throw new Error(`Staged application file is missing: ${rel}`)
  return new Map([...digests].map(([rel, value]) => [rel, value.sha256]))
}

export function verifyDesktopBuild(
  record,
  requiredFiles,
  buildId,
  expectedProvenance = {}
) {
  const expected = desktopBuildRecord(
    requiredFiles,
    buildId,
    expectedProvenance
  )
  if (!record) throw new Error(staleBuildMessage)
  optionalHex(record.sourceCommit, HEX_40, 'sourceCommit')
  optionalHex(record.packageLockSha256, HEX_64, 'packageLockSha256')
  if (Object.entries(expected).some(([key, value]) => record[key] !== value))
    throw new Error(staleBuildMessage)
}

const staleBuildMessage =
  'Desktop build record is missing or stale; rebuild with npm run desktop:build'

const readOptional = (path) =>
  readFile(path, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })

// A plain `next build` leaves no record; refuse it with the remedy, not ENOENT.
export async function verifyRecordedDesktopBuild(
  directory,
  recordPath,
  expectedProvenance = {}
) {
  const [record, requiredFiles, buildId] = await Promise.all([
    readOptional(recordPath),
    readOptional(join(directory, '.next/required-server-files.json')),
    readOptional(join(directory, '.next/BUILD_ID'))
  ])
  if (record === null || requiredFiles === null || buildId === null)
    throw new Error(staleBuildMessage)
  const parsed = JSON.parse(record)
  verifyDesktopBuild(parsed, requiredFiles, buildId, expectedProvenance)
  return parsed
}

export async function verifyApplicationLockfile(
  applicationDirectory,
  expectedPackageLockSha256
) {
  const expected = optionalHex(
    expectedPackageLockSha256,
    HEX_64,
    'packageLockSha256'
  )
  if (!expected) throw new Error('Expected packageLockSha256 is required')
  const lockBytes = await readFile(
    join(applicationDirectory, 'package-lock.json')
  ).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (lockBytes !== null && digest(lockBytes) !== expected)
    throw new Error(
      'Staged application package-lock.json does not match source'
    )
}
