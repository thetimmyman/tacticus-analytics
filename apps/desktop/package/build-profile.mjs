import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

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
  return {
    format: 'ta-desktop-build-v1',
    profile: 'desktop',
    buildId: buildId.trim(),
    requiredFilesSha256: digest(requiredFiles),
    ...(sourceCommit ? { sourceCommit } : {}),
    ...(packageLockSha256 ? { packageLockSha256 } : {})
  }
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
