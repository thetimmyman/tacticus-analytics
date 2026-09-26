import { describe, expect, it } from 'vitest'

import {
  buildGuildConfigData,
  numericValue
} from '@/app/api/guild/create-config/config-data'
import { splitElevatedRoleIds } from '@/app/api/guild/create-config/initial-sync'

describe('create-config data model', () => {
  it('coerces finite numeric settings and rejects invalid values', () => {
    expect(numericValue('12')).toBe(12)
    expect(numericValue('invalid')).toBeNull()
    expect(numericValue(null)).toBeNull()
  })

  it('builds one timestamped, server-authoritative guild row', () => {
    const row = buildGuildConfigData({
      guildCode: 'EOT',
      clusterCode: 'CLUSTER',
      clusterId: 'cluster-id',
      encryptedApiKey: 'encrypted',
      apiKeyIsValid: true,
      sessionId: 'session',
      discovered: {
        guildId: 'guild-id',
        guildTag: 'TAG',
        guildName: 'Discovered Name',
        memberCount: 30,
        userRole: 'officer',
        isLeader: false
      },
      overrides: {
        displayName: 'Submitted Name',
        apiOwner: ' owner ',
        grRanking: '7',
        tokenOffenderThreshold: '10',
        enabled: false
      },
      now: '2026-08-18T00:00:00.000Z'
    })

    expect(row).toMatchObject({
      guild_code: 'EOT',
      display_name: 'Discovered Name',
      cluster_id: 'cluster-id',
      cluster_code: 'CLUSTER',
      is_cluster: true,
      API_Owner: 'owner',
      GR_Ranking: 7,
      GW_Ranking: null,
      token_offender_threshold: 10,
      enabled: false,
      auto_sync_enabled: true,
      created_at: '2026-08-18T00:00:00.000Z',
      updated_at: '2026-08-18T00:00:00.000Z'
    })
    expect(row).not.toHaveProperty('token_abuser_threshold')
  })

  it('defers automatic sync when registration cannot obtain a LOKI session', () => {
    const row = buildGuildConfigData({
      guildCode: 'EOT',
      clusterCode: '',
      clusterId: null,
      encryptedApiKey: 'encrypted',
      apiKeyIsValid: true,
      sessionId: null,
      discovered: null,
      overrides: { displayName: 'Example Guild' },
      now: '2026-08-24T00:00:00.000Z'
    })

    // guild-batch-sync's healing cohort owns recovery from this state.
    expect(row).toMatchObject({
      enabled: true,
      api_key_is_valid: true,
      session_id: null,
      auto_sync_enabled: false,
      consecutive_sync_failures: 0
    })
  })

  it('partitions only elevated Tacticus guild roles', () => {
    expect(
      splitElevatedRoleIds([
        { userId: 'leader', role: 'LEADER' },
        { userId: 'officer', role: 'OFFICER' },
        { userId: 'member', role: 'MEMBER' },
        { role: 'LEADER' }
      ])
    ).toEqual({ leaderIds: ['leader'], officerIds: ['officer'] })
  })
})
