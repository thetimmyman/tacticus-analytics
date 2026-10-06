import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  desktopBuildEnvironment,
  desktopBuildRecord,
  verifyDesktopBuild,
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
