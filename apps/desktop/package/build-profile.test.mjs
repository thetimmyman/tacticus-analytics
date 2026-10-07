import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  unlink,
  rm
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  desktopBuildEnvironment,
  desktopBuildRecord,
  verifyDesktopBuild,
  verifyRecordedDesktopBuild,
  requireCleanBuildEnvironment
} from './build-profile.mjs'

test('desktop build uses loopback placeholders and excludes inherited hosted secrets', () => {
  const env = desktopBuildEnvironment({
    PATH: '/synthetic/bin',
    NEXT_PUBLIC_RUNTIME_PROFILE: 'hosted',
    NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.example.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-hosted-key',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    SENTRY_AUTH_TOKEN: 'synthetic-token'
  })
  assert.equal(env.PATH, '/synthetic/bin')
  assert.equal(env.NEXT_PUBLIC_RUNTIME_PROFILE, 'desktop')
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:3000/supabase')
  assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'desktop-public')
  assert.equal(env.STANDALONE_BUILD, 'true')
  assert.equal(env.NEXT_TELEMETRY_DISABLED, '1')
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined)
  assert.equal(env.SENTRY_AUTH_TOKEN, undefined)
})

test('desktop build keeps the Windows process essentials npm.cmd needs', () => {
  const env = desktopBuildEnvironment({
    PATH: 'C:\\synthetic\\bin',
    SystemRoot: 'C:\\Windows',
    ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    APPDATA: 'C:\\synthetic\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\synthetic\\AppData\\Local',
    GITHUB_TOKEN: 'synthetic-token'
  })
  assert.equal(env.SystemRoot, 'C:\\Windows')
  assert.equal(env.ComSpec, 'C:\\Windows\\system32\\cmd.exe')
  assert.equal(env.PATHEXT, '.COM;.EXE;.BAT;.CMD')
  assert.equal(env.LOCALAPPDATA, 'C:\\synthetic\\AppData\\Local')
  assert.equal(env.GITHUB_TOKEN, undefined)
})

test('automatic environment files refuse before build; examples are permitted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-build-profile-'))
  try {
    await writeFile(join(root, '.env.example'), 'SYNTHETIC_PLACEHOLDER=1')
    await requireCleanBuildEnvironment(root)
    for (const name of [
      '.env',
      '.env.local',
      '.env.production',
      '.env.production.local'
    ]) {
      await writeFile(join(root, name), 'SYNTHETIC_PLACEHOLDER=1')
      await assert.rejects(
        requireCleanBuildEnvironment(root),
        /automatic environment files/
      )
      await unlink(join(root, name))
    }
  } finally {
    await rm(root, { recursive: true })
  }
})

test('stage verification rejects hosted, incomplete and replaced builds', () => {
  const required = JSON.stringify({
    config: {
      output: 'standalone',
      experimental: { proxyClientMaxBodySize: 24 * 1024 * 1024 }
    }
  })
  const record = desktopBuildRecord(required, 'synthetic-build')
  verifyDesktopBuild(record, required, 'synthetic-build')
  assert.throws(() => verifyDesktopBuild(null, required, 'synthetic-build'))
  assert.throws(() => verifyDesktopBuild(record, required, 'other-build'))
  assert.throws(() =>
    verifyDesktopBuild(record, required + '\n', 'synthetic-build')
  )
  assert.throws(() =>
    desktopBuildRecord(
      JSON.stringify({ config: { output: 'standalone', experimental: {} } }),
      'synthetic-build'
    )
  )
  assert.throws(() => desktopBuildRecord(required, ''))
})

test('a plain build without a record refuses with the desktop build remedy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-build-record-'))
  const recordPath = join(root, '.next/desktop-build.json')
  const required = JSON.stringify({
    config: {
      output: 'standalone',
      experimental: { proxyClientMaxBodySize: 24 * 1024 * 1024 }
    }
  })
  try {
    await assert.rejects(
      verifyRecordedDesktopBuild(root, recordPath),
      /missing or stale; rebuild with npm run desktop:build/
    )
    await mkdir(join(root, '.next'))
    await writeFile(join(root, '.next/required-server-files.json'), required)
    await writeFile(join(root, '.next/BUILD_ID'), 'synthetic-build')
    await assert.rejects(
      verifyRecordedDesktopBuild(root, recordPath),
      /missing or stale; rebuild with npm run desktop:build/
    )
    await writeFile(
      recordPath,
      JSON.stringify(desktopBuildRecord(required, 'synthetic-build'))
    )
    await verifyRecordedDesktopBuild(root, recordPath)
    await writeFile(join(root, '.next/BUILD_ID'), 'replaced-build')
    await assert.rejects(
      verifyRecordedDesktopBuild(root, recordPath),
      /missing or stale/
    )
  } finally {
    await rm(root, { recursive: true })
  }
})

test('the desktop build script is the entry point that writes the record', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const { scripts } = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8')
  )
  assert.equal(
    scripts['desktop:build'],
    'node apps/desktop/proof/build-application.mjs'
  )
  const builder = await readFile(
    join(root, 'apps/desktop/proof/build-application.mjs'),
    'utf8'
  )
  assert.match(builder, /\.next\/desktop-build\.json/)
})
