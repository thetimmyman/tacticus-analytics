import test from 'node:test'
import assert from 'node:assert/strict'
import { rendererCredentialSurface } from '../../../apps/desktop/platform/macos/credential-surface.mjs'

test('legacy forms and key handlers stay behind native input even after Player activation', () => {
  for (const path of [
    '/api-keys',
    '/profile/edit',
    '/profile',
    '/onboarding/claim',
    '/token-usage',
    '/roster/SyntheticMember',
    '/guild-management/settings',
    '/guild-management/members',
    '/api/player-api-key',
    '/api/validate-api-key',
    '/api/player/test-api-key',
    '/api/onboarding/guild/start',
    '/api/members/request-api-key',
    '/api/profile/change-player-id',
    '/api/admin/player-api-key',
    '/%70rofile/edit',
    '/PROFILE/edit',
    '/profile%2fedit',
    '/profile%5cedit',
    '/%2570rofile/edit',
    '/profile%ZZedit',
    '/supabase/rest/v1/player_api_keys'
  ])
    assert.equal(
      rendererCredentialSurface(new URL(path, 'http://localhost')),
      true,
      path
    )
})

test('personal data, normal Auth unlock and selected local analytics remain available', () => {
  for (const path of [
    '/desktop/personal',
    '/api/desktop/personal',
    '/desktop/setup',
    '/api/auth/login',
    '/supabase/auth/v1/token',
    '/api/health',
    '/player-performance',
    '/api/player/roster',
    '/_next/static/app.js'
  ])
    assert.equal(
      rendererCredentialSurface(new URL(path, 'http://localhost')),
      false,
      path
    )
})
