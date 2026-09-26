import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { verifyAppIdentity } from './verify-app-identity.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ta-app-identity-'))
  mkdirSync(join(root, 'app/(public)/explore'), { recursive: true })
  writeFileSync(join(root, 'app/(public)/explore/page.tsx'), '')
  writeFileSync(
    join(root, '.app-identity.json'),
    JSON.stringify({
      appId: 'tacticus-analytics',
      displayName: 'TACTICUS ANALYTICS',
      repository: 'thetimmyman/tacticus-analytics',
      packageName: 'tacticus-analytics',
      siteHosts: ['tacticusanalytics.com'],
      apiHosts: ['api.tacticusanalytics.com'],
      internalApiHosts: ['supabase-kong'],
      localHosts: ['localhost'],
      requiredPaths: ['app/(public)/explore/page.tsx'],
      forbiddenPaths: ['k8s/legacy-stack']
    })
  )
  writeFileSync(join(root, 'package.json'), '{"name":"tacticus-analytics"}')
  return root
}

test('accepts the Tacticus Analytics repository and backend', () => {
  const root = fixture()
  try {
    const result = verifyAppIdentity({
      root,
      origin: 'https://github.com/thetimmyman/tacticus-analytics.git',
      env: {
        NEXT_PUBLIC_SITE_URL: 'https://tacticusanalytics.com',
        NEXT_PUBLIC_SUPABASE_URL: 'https://api.tacticusanalytics.com'
      }
    })
    assert.deepEqual(result.errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a legacy-app remote, backend, and path', () => {
  const root = fixture()
  try {
    mkdirSync(join(root, 'k8s/legacy-stack'), { recursive: true })
    const result = verifyAppIdentity({
      root,
      origin: 'git@github.com:example/legacy.git',
      env: {
        NEXT_PUBLIC_SITE_URL: 'https://legacy.example',
        NEXT_PUBLIC_SUPABASE_URL: 'https://api.legacy.example'
      }
    })
    assert.equal(result.errors.length, 4)
    assert.ok(result.errors.some((error) => error.includes('origin is')))
    assert.ok(result.errors.some((error) => error.includes('cross-app path')))
    assert.ok(result.errors.some((error) => error.includes('SITE_URL')))
    assert.ok(result.errors.some((error) => error.includes('SUPABASE_URL')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a terminal branded for another application', () => {
  const root = fixture()
  try {
    const result = verifyAppIdentity({
      root,
      origin: 'https://github.com/thetimmyman/tacticus-analytics.git',
      env: { TACTICUS_APP_ID: 'legacy-app' }
    })
    assert.deepEqual(result.errors, [
      'TACTICUS_APP_ID is legacy-app; expected tacticus-analytics'
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('accepts the standard SSH URI form of the expected origin', () => {
  const root = fixture()
  try {
    const result = verifyAppIdentity({
      root,
      origin: 'ssh://git@github.com/thetimmyman/tacticus-analytics.git',
      env: {}
    })
    assert.deepEqual(result.errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects cross-app values in production-specific and server env', () => {
  const root = fixture()
  try {
    writeFileSync(
      join(root, '.env.production.local'),
      'NEXT_PUBLIC_SITE_URL=https://legacy.example\n'
    )
    const result = verifyAppIdentity({
      root,
      origin: 'https://github.com/thetimmyman/tacticus-analytics.git',
      env: { SUPABASE_URL: 'https://api.legacy.example' }
    })
    assert.ok(
      result.errors.includes(
        'NEXT_PUBLIC_SITE_URL uses forbidden host legacy.example'
      )
    )
    assert.ok(
      result.errors.includes(
        'SUPABASE_URL uses forbidden host api.legacy.example'
      )
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('accepts the in-namespace server endpoint', () => {
  const root = fixture()
  try {
    const result = verifyAppIdentity({
      root,
      origin: 'https://github.com/thetimmyman/tacticus-analytics.git',
      env: { SUPABASE_URL: 'http://supabase-kong:8000' }
    })
    assert.deepEqual(result.errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runtime mode validates environment without source-only files', () => {
  const root = fixture()
  try {
    rmSync(join(root, 'app'), { recursive: true, force: true })
    const result = verifyAppIdentity({
      root,
      origin: 'https://github.com/example/legacy.git',
      env: {
        APP_IDENTITY_RUNTIME: '1',
        TACTICUS_APP_ID: 'tacticus-analytics',
        SUPABASE_URL: 'http://supabase-kong:8000'
      }
    })
    assert.deepEqual(result.errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses to report OK when no identity signal is available', () => {
  const root = fixture()
  try {
    const result = verifyAppIdentity({ root, origin: null, env: {} })
    assert.ok(
      result.errors.some((error) =>
        error.includes('no identity signal was available')
      ),
      `expected a blind-check error, got: ${JSON.stringify(result.errors)}`
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
