import type { SupabaseClient as BaseSupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  revokeAndDeleteAttestedMapping,
  seedAttestedPlayerMapping,
  type AttestedMapping
} from '../helpers/attested-player-mapping'

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

const shouldRunRls =
  ['1', 'true', 'yes'].includes(
    (process.env.RUN_RLS_TESTS || '').toLowerCase()
  ) &&
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY) &&
  isLocalSupabaseUrl(SUPABASE_URL) &&
  !isPlaceholderKey(SUPABASE_ANON_KEY) &&
  !isPlaceholderKey(SUPABASE_SERVICE_ROLE_KEY)

const describeRls = shouldRunRls ? describe : describe.skip

// Untyped client, as createClient returns without a Database generic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = BaseSupabaseClient<any>

type SeedError = {
  message?: string
  details?: string | null
  hint?: string | null
} | null

const randomSuffix = () => Math.random().toString(36).slice(2, 6).toUpperCase()
const assertSeedOk = (label: string, error: SeedError) => {
  if (!error) return
  const extras = [error.details, error.hint].filter(Boolean).join(' | ')
  const message = error.message || 'unknown error'
  throw new Error(
    `RLS seed failed (${label}): ${extras ? `${message} (${extras})` : message}`
  )
}

describeRls('RLS integration checks', () => {
  let adminClient: SupabaseClient
  let userAClient: SupabaseClient
  let userBClient: SupabaseClient
  let userAId: string
  let userBId: string
  let systemConfigKey: string
  let guildCodeA: string
  let guildCodeB: string
  let playerIdA: string
  let playerIdB: string
  let mappingA: AttestedMapping | undefined
  let mappingB: AttestedMapping | undefined

  const createUserSession = async (label: string) => {
    const email = `wi136_${label}_${Date.now()}@example.com`
    const password = `Wi136_${label}_${Math.random().toString(36).slice(2)}!`

    const { data: createData, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })

    if (createError || !createData.user) {
      throw new Error(
        `Failed to create test user: ${createError?.message || 'unknown error'}`
      )
    }

    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password
    })

    if (signInError) {
      throw new Error(
        `Failed to sign in test user: ${signInError.message || 'unknown error'}`
      )
    }

    return { client, userId: createData.user.id, email }
  }

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const userASession = await createUserSession('A')
    const userBSession = await createUserSession('B')

    userAClient = userASession.client
    userBClient = userBSession.client
    userAId = userASession.userId
    userBId = userBSession.userId

    const suffix = randomSuffix()
    systemConfigKey = `wi136_config_${suffix}`
    guildCodeA = `W1A${suffix}`
    guildCodeB = `W1B${suffix}`
    playerIdA = `player_${suffix}_A`
    playerIdB = `player_${suffix}_B`

    const { error: systemConfigError } = await adminClient
      .from('system_config')
      .upsert(
        {
          key: systemConfigKey,
          value: 'wi136-test'
        },
        { onConflict: 'key' }
      )

    assertSeedOk('system_config', systemConfigError)

    const { error: guildConfigError } = await adminClient
      .from('guild_config')
      .upsert(
        [
          {
            guild_code: guildCodeA,
            display_name: `WI136 Guild ${suffix}A`,
            enabled: true
          },
          {
            guild_code: guildCodeB,
            display_name: `WI136 Guild ${suffix}B`,
            enabled: true
          }
        ],
        { onConflict: 'guild_code' }
      )

    assertSeedOk('guild_config', guildConfigError)

    mappingA = await seedAttestedPlayerMapping(adminClient, {
      playerId: playerIdA,
      displayName: `WI136 Player ${suffix}A`,
      guildCode: guildCodeA,
      userId: userAId,
      extra: { is_active: true }
    })
    mappingB = await seedAttestedPlayerMapping(adminClient, {
      playerId: playerIdB,
      displayName: `WI136 Player ${suffix}B`,
      guildCode: guildCodeB,
      userId: userBId,
      extra: { is_active: true }
    })

    const { error: syncStatusError } = await adminClient
      .from('guild_sync_status')
      .upsert(
        [
          { guild_code: guildCodeA, status: 'ready' },
          { guild_code: guildCodeB, status: 'ready' }
        ],
        { onConflict: 'guild_code' }
      )

    assertSeedOk('guild_sync_status', syncStatusError)
  })

  afterAll(async () => {
    if (adminClient) {
      await adminClient
        .from('guild_sync_status')
        .delete()
        .in('guild_code', [guildCodeA, guildCodeB])
      await revokeAndDeleteAttestedMapping(adminClient, mappingA)
      await revokeAndDeleteAttestedMapping(adminClient, mappingB)
      await adminClient
        .from('guild_config')
        .delete()
        .in('guild_code', [guildCodeA, guildCodeB])
      await adminClient
        .from('system_config')
        .delete()
        .eq('key', systemConfigKey)

      if (userAId) {
        await adminClient.auth.admin.deleteUser(userAId).catch(() => undefined)
      }
      if (userBId) {
        await adminClient.auth.admin.deleteUser(userBId).catch(() => undefined)
      }
    }
  })

  it('allows service role to read protected tables', async () => {
    const { data, error } = await adminClient
      .from('system_config')
      .select('key, value')
      .eq('key', systemConfigKey)

    expect(error).toBeNull()
    expect(data?.[0]?.key).toBe(systemConfigKey)
  })

  it('denies standard users from protected tables', async () => {
    const { data, error } = await userAClient
      .from('system_config')
      .select('key')
      .eq('key', systemConfigKey)

    if (error) {
      expect(error.message).toMatch(/permission|security|policy|denied/i)
      return
    }

    expect(data).toEqual([])
  })

  it('enforces tenant isolation for guild data', async () => {
    // The row exists, so a miss below is a policy result.
    const { data: adminView, error: adminError } = await adminClient
      .from('guild_sync_status')
      .select('guild_code')
      .eq('guild_code', guildCodeA)

    expect(adminError).toBeNull()
    expect(adminView?.[0]?.guild_code).toBe(guildCodeA)

    // Membership resolves through `_pm_caller_guild_codes()` without SELECT on player_mapping.user_id.
    const { data: userAData, error: userAError } = await userAClient
      .from('guild_sync_status')
      .select('guild_code')
      .eq('guild_code', guildCodeA)

    expect(userAError).toBeNull()
    expect(userAData).toEqual([{ guild_code: guildCodeA }])

    const { data: userBData, error: userBError } = await userBClient
      .from('guild_sync_status')
      .select('guild_code')
      .eq('guild_code', guildCodeA)

    expect(userBData ?? []).toEqual([])
    if (userBError) {
      expect(userBError.code).toBe('42501')
    }
  })

  it('rejects inserts with invalid foreign keys', async () => {
    const invalidUserId = '00000000-0000-0000-0000-000000000000'
    const playerId = `wi136_invalid_${randomSuffix()}`

    const { data: mapping, error: mappingError } = await adminClient
      .from('player_mapping')
      .insert({
        player_id: playerId,
        display_name: 'WI136 Invalid User',
        guild_code: guildCodeA,
        is_current: true
      })
      .select('id')
      .single()

    expect(mappingError).toBeNull()

    const mappingId = (mapping as { id: number } | null)?.id as number

    const { data: attestation, error: attestationError } = await adminClient
      .from('player_identity_attestations')
      .insert({
        mapping_id: mappingId,
        player_id: playerId,
        subject_user_id: invalidUserId,
        consumed_at: new Date().toISOString(),
        source: 'operator_quarantine_restore'
      })
      .select('id')
      .single()

    expect(attestationError).toBeNull()

    const { error } = await adminClient
      .from('player_mapping')
      .update({
        user_id: invalidUserId,
        ownership_attestation_id: (attestation as { id: string } | null)?.id
      })
      .eq('id', mappingId)

    expect(error).not.toBeNull()
    if (error) {
      expect(error.message).toMatch(/foreign key|player_mapping_user_id_fkey/i)
    }

    await adminClient.from('player_mapping').delete().eq('id', mappingId)
  })
})
