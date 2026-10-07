import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const digest = (value) => createHash('sha256').update(value).digest('hex')

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

export function desktopBuildRecord(requiredFiles, buildId) {
  const { config } = JSON.parse(requiredFiles)
  if (
    config?.output !== 'standalone' ||
    config.experimental?.proxyClientMaxBodySize !== 24 * 1024 * 1024 ||
    !buildId.trim()
  )
    throw new Error('A completed desktop standalone build is required')
  return {
    format: 'ta-desktop-build-v1',
    profile: 'desktop',
    buildId: buildId.trim(),
    requiredFilesSha256: digest(requiredFiles)
  }
}

export function verifyDesktopBuild(record, requiredFiles, buildId) {
  const expected = desktopBuildRecord(requiredFiles, buildId)
  if (
    !record ||
    Object.entries(expected).some(([key, value]) => record[key] !== value)
  )
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
export async function verifyRecordedDesktopBuild(directory, recordPath) {
  const [record, requiredFiles, buildId] = await Promise.all([
    readOptional(recordPath),
    readOptional(join(directory, '.next/required-server-files.json')),
    readOptional(join(directory, '.next/BUILD_ID'))
  ])
  if (record === null || requiredFiles === null || buildId === null)
    throw new Error(staleBuildMessage)
  verifyDesktopBuild(JSON.parse(record), requiredFiles, buildId)
}
