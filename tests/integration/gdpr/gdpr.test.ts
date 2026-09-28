import type { SupabaseClient as BaseSupabaseClient } from '@supabase/supabase-js'
/** Requires RUN_GDPR_TESTS=1 and a local Supabase with real keys; skipped otherwise. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  revokeAndDeleteAttestedMapping,
  seedAttestedPlayerMapping,
  type AttestedMapping
} from '../helpers/attested-player-mapping'

// Lazy: `@/app/lib/db` creates a real Supabase client at module load.
async function getGdprManager() {
  const mod = await import('@/app/lib/compliance/gdpr-manager')
  return mod.gdprManager
}

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const PLACEHOLDER_KEYS = new Set([
  'unit-test-anon-key',
  'unit-test-service-role-key',
  'test-anon-key',
  'test-service-role-key'
])
const isPlaceholderKey = (value: string) =>
  PLACEHOLDER_KEYS.has(value) ||
  value.includes('placeholder') ||
  value.startsWith('your_') ||
  value.startsWith('your-')
const isLocalSupabaseUrl = (value: string) => {
  if (!value) return false
  try {
    const { hostname } = new URL(value)
    return (
      hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
    )
  } catch {
    return false
  }
}

const shouldRun =
  ['1', 'true', 'yes'].includes(
    (process.env.RUN_GDPR_TESTS || '').toLowerCase()
  ) &&
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY) &&
  isLocalSupabaseUrl(SUPABASE_URL) &&
  !isPlaceholderKey(SUPABASE_ANON_KEY) &&
  !isPlaceholderKey(SUPABASE_SERVICE_ROLE_KEY)

const describeGdpr = shouldRun ? describe : describe.skip

/** Live-only functions; a stale declaration (gap now present) fails, so it cannot outlive its blocker. */
const declaredGaps = new Set(
  (process.env.GDPR_LIVE_ONLY_GAPS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
)

async function resolveLiveOnlyRpc(
  client: SupabaseClient,
  fnName: string
): Promise<{ present: boolean; declared: boolean }> {
  const { error } = await client.rpc(fnName as never, {} as never)
  if (!error) return { present: true, declared: declaredGaps.has(fnName) }

  // PGRST202 covers a missing name or signature; only a `hint` naming real overloads proves existence.
  const present =
    error.code !== 'PGRST202' ||
    new RegExp(
      `\\b${fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`
    ).test(error.hint ?? '')
  return { present, declared: declaredGaps.has(fnName) }
}

function decideLiveOnlyCoverage(
  fnName: string,
  state: { present: boolean; declared: boolean }
): boolean {
  if (state.present && state.declared) {
    throw new Error(
      `GDPR_LIVE_ONLY_GAPS declares ${fnName} missing, but this database has it. ` +
        'Remove the declaration so the coverage it suppresses runs again.'
    )
  }
  if (!state.present && !state.declared) {
    throw new Error(
      `public.${fnName} is absent from this database and is not declared in ` +
        'GDPR_LIVE_ONLY_GAPS. Either seed it or declare the gap with a reason.'
    )
  }
  if (!state.present) {
    // eslint-disable-next-line no-console
    console.warn(
      `[gdpr] skipping coverage that needs public.${fnName}: declared live-only gap`
    )
    return false
  }
  return true
}

// Untyped client, as createClient returns without a Database generic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = BaseSupabaseClient<any>

const randomSuffix = () => Math.random().toString(36).slice(2, 8).toUpperCase()

async function pollExportStatus(
  admin: SupabaseClient,
  requestId: string,
  timeoutMs = 15_000
): Promise<{
  status: string
  download_url: string | null
  expires_at: string | null
}> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { data } = await admin
      .from('gdpr_data_exports')
      .select('status, download_url, expires_at')
      .eq('request_id', requestId)
      .single()
    if (data && ['completed', 'failed'].includes(String(data.status))) {
      return data as {
        status: string
        download_url: string | null
        expires_at: string | null
      }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(
    `pollExportStatus timed out after ${timeoutMs}ms for request ${requestId}`
  )
}

describeGdpr('GDPR export + scheduled deletion', () => {
  let adminClient: SupabaseClient
  let userId: string
  let userEmail: string
  let testGuildCode: string
  let testPlayerId: string
  let testDisplayName: string
  let seededMapping: AttestedMapping | undefined

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const suffix = randomSuffix()
    userEmail = `gdpr_${suffix}@example.com`
    testGuildCode = `GD738${suffix.slice(0, 3)}`
    testPlayerId = `gdpr_player_${suffix}`
    testDisplayName = `GdprPlayer_${suffix}`

    const { data: created, error: createErr } =
      await adminClient.auth.admin.createUser({
        email: userEmail,
        password: `Gdpr_${suffix}_${Math.random().toString(36).slice(2)}!`,
        email_confirm: true
      })
    if (createErr || !created.user) {
      throw new Error(
        `Failed to create test user: ${createErr?.message || 'no user returned'}`
      )
    }
    userId = created.user.id

    const { error: gcErr } = await adminClient.from('guild_config').upsert(
      {
        guild_code: testGuildCode,
        display_name: `Gdpr Guild ${suffix}`,
        enabled: true
      },
      { onConflict: 'guild_code' }
    )
    if (gcErr) {
      throw new Error(`Failed to seed guild_config: ${gcErr.message}`)
    }

    seededMapping = await seedAttestedPlayerMapping(adminClient, {
      playerId: testPlayerId,
      displayName: testDisplayName,
      guildCode: testGuildCode,
      userId
    })

    // encounterId is NOT NULL.
    const { error: battleErr } = await adminClient.from('EOT_GR_data').insert({
      Guild: testGuildCode,
      Season: '99999',
      displayName: testDisplayName,
      Name: 'TestBoss',
      damageType: 'Battle',
      damageDealt: 1,
      encounterId: 0,
      rarity: 'Legendary',
      set: 0,
      startedOn: new Date().toISOString(),
      userId: testPlayerId
    })
    if (battleErr) {
      throw new Error(`Failed to seed EOT_GR_data: ${battleErr.message}`)
    }
  })

  afterAll(async () => {
    if (!adminClient) return
    // A PostgREST filter builder is a thenable without `.catch`.
    const quietly = async (run: () => PromiseLike<unknown>) => {
      try {
        await run()
      } catch {
        // Teardown must never mask a test result.
      }
    }

    await quietly(() =>
      adminClient.from('EOT_GR_data').delete().eq('Guild', testGuildCode)
    )
    await revokeAndDeleteAttestedMapping(adminClient, seededMapping)
    await quietly(() =>
      adminClient.from('gdpr_data_exports').delete().eq('user_id', userId)
    )
    await quietly(() =>
      adminClient.from('gdpr_deletion_requests').delete().eq('user_id', userId)
    )
    await quietly(() =>
      adminClient.from('gdpr_processing_log').delete().eq('user_id', userId)
    )
    await quietly(() =>
      adminClient.from('guild_config').delete().eq('guild_code', testGuildCode)
    )
    if (userId) {
      await quietly(() => adminClient.auth.admin.deleteUser(userId))
    }
  })

  describe('Export — Article 15 right of access', () => {
    // Regression guard: the export RPC once failed at plan time on every call.
    it('get_user_data_for_export RPC returns a structured bundle without erroring', async () => {
      const { data, error } = await adminClient.rpc(
        'get_user_data_for_export',
        {
          p_user_id: userId
        }
      )

      expect(error).toBeNull()
      expect(data).toBeTruthy()

      const bundle = data as {
        user_id: string
        data: {
          profile: unknown
          player_mappings: unknown
          battle_data: unknown
          processing_history: unknown
        }
        data_summary: { total_players: number }
      }
      expect(bundle.user_id).toBe(userId)
      expect(Array.isArray(bundle.data.processing_history)).toBe(true)
      expect(Array.isArray(bundle.data.player_mappings)).toBe(true)
      expect(Array.isArray(bundle.data.battle_data)).toBe(true)
      expect(bundle.data_summary.total_players).toBeGreaterThan(0)
    })

    it('handleDataAccessRequest creates a pending row and returns the request id', async () => {
      const gdprManager = await getGdprManager()
      const result = await gdprManager.handleDataAccessRequest(userId)

      expect(result.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
      expect(result.user_id).toBe(userId)
      expect(['pending', 'processing', 'completed']).toContain(result.status)
    })

    it('async processing reaches a terminal status with a download_url when bucket is configured', async () => {
      const gdprManager = await getGdprManager()
      const result = await gdprManager.handleDataAccessRequest(userId)
      const final = await pollExportStatus(adminClient, result.request_id)

      // `failed` is acceptable only when the bucket is genuinely absent.
      const { data: bucket } =
        await adminClient.storage.getBucket('gdpr-exports')
      if (bucket) {
        expect(final.status).toBe('completed')
        expect(final.download_url).toBeTruthy()
        expect(final.expires_at).toBeTruthy()
      } else {
        expect(['completed', 'failed']).toContain(final.status)
        if (final.status === 'completed') {
          expect(final.download_url).toBeTruthy()
          expect(final.expires_at).toBeTruthy()
        }
      }
    })

    it('records a complete_export entry in gdpr_processing_log on success', async () => {
      const gdprManager = await getGdprManager()
      const result = await gdprManager.handleDataAccessRequest(userId)
      const final = await pollExportStatus(adminClient, result.request_id)
      if (final.status !== 'completed') return

      const { data: logs, error } = await adminClient
        .from('gdpr_processing_log')
        .select('data_type, processing_purpose')
        .eq('user_id', userId)
        .eq('data_type', 'complete_export')

      expect(error).toBeNull()
      expect(logs && logs.length).toBeGreaterThan(0)
      expect(logs![0]!.processing_purpose).toBe('gdpr_data_access')
    })
  })

  describe('Scheduled deletion — Article 17 right to erasure', () => {
    // prepare_player_account_deletion is live-only, so a replayed lane cannot complete.
    let erasureRunnable = false

    beforeAll(async () => {
      erasureRunnable = decideLiveOnlyCoverage(
        'prepare_player_account_deletion',
        await resolveLiveOnlyRpc(adminClient, 'prepare_player_account_deletion')
      )
    })

    it('executeScheduledDeletions processes a row whose scheduled_for is in the past', async () => {
      if (!erasureRunnable) return
      const gdprManager = await getGdprManager()
      const requestId = crypto.randomUUID()
      const pastWindow = new Date(Date.now() - 60 * 1000).toISOString()

      // Direct insert deliberately bypasses the 24h grace window.
      const { error: insertErr } = await adminClient
        .from('gdpr_deletion_requests')
        .insert({
          request_id: requestId,
          user_id: userId,
          request_type: 'complete',
          requested_at: pastWindow,
          scheduled_for: pastWindow,
          status: 'scheduled',
          data_categories: ['all']
        })
      expect(insertErr).toBeNull()

      await gdprManager.executeScheduledDeletions()

      const { data: req } = await adminClient
        .from('gdpr_deletion_requests')
        .select('status, completed_at')
        .eq('request_id', requestId)
        .single()
      expect(req?.status).toBe('completed')
      expect(req?.completed_at).toBeTruthy()

      const { data: authCheck } =
        await adminClient.auth.admin.getUserById(userId)
      expect(authCheck.user).toBeNull()

      const { data: pm } = await adminClient
        .from('player_mapping')
        .select('player_id')
        .eq('player_id', testPlayerId)
        .maybeSingle()
      expect(pm).toBeNull()

      const { data: original } = await adminClient
        .from('EOT_GR_data')
        .select('displayName')
        .eq('Guild', testGuildCode)
        .eq('displayName', testDisplayName)
      expect(original?.length ?? 0).toBe(0)

      const { data: anonymized } = await adminClient
        .from('EOT_GR_data')
        .select('displayName')
        .eq('Guild', testGuildCode)
        .like('displayName', '[DELETED_USER_%]')
      expect(anonymized?.length ?? 0).toBeGreaterThan(0)

      const { data: logs } = await adminClient
        .from('gdpr_processing_log')
        .select('data_type')
        .eq('user_id', userId)
        .eq('data_type', 'deletion_completed')
      expect(logs && logs.length).toBeGreaterThan(0)
    })
  })
})
