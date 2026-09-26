import {
  buildClusterWebhookMap,
  buildGuildProcessingPlan,
  buildWebhookMaps,
  getWebhookConfig
} from '../../../supabase/functions/update-discord-leaderboards/webhook-config.ts'

describe('leaderboard webhook configuration', () => {
  const rows = [
    {
      guild_code: 'ABC',
      webhook_url: 'https://legacy',
      webhook_type: 'leaderboard',
      thread_id: null
    },
    {
      guild_code: 'ABC',
      webhook_url: 'https://boss',
      webhook_type: 'boss_leaderboard',
      thread_id: 'boss-thread'
    }
  ]

  it('prefers a specific webhook and falls back to the legacy webhook', () => {
    const maps = buildWebhookMaps(rows)
    expect(getWebhookConfig(maps, 'ABC', 'main')).toEqual({
      url: 'https://boss',
      threadId: 'boss-thread'
    })
    expect(getWebhookConfig(maps, 'ABC', 'prime')).toEqual({
      url: 'https://legacy',
      threadId: null
    })
  })

  it('builds a filtered guild processing plan while keeping cluster members', () => {
    const plan = buildGuildProcessingPlan(
      [
        {
          guild_code: 'ABC',
          display_name: 'Alpha',
          enabled: true,
          cluster_code: 'ONE'
        },
        {
          guild_code: 'DEF',
          display_name: 'Delta',
          enabled: true,
          cluster_code: 'ONE'
        },
        {
          guild_code: 'TEST',
          display_name: 'Test',
          enabled: true,
          cluster_code: null
        }
      ],
      [
        ...rows,
        {
          guild_code: 'DEF',
          webhook_url: 'https://def',
          webhook_type: 'leaderboard',
          thread_id: null
        },
        {
          guild_code: 'TEST',
          webhook_url: 'https://test',
          webhook_type: 'leaderboard',
          thread_id: null
        }
      ],
      'abc'
    )

    expect(plan.activeGuilds).toEqual(['ABC'])
    expect(plan.allClusterGuilds).toEqual(['ABC', 'DEF', 'TEST'])
    expect(plan.testWebhook).toBe('https://test')
    expect(plan.guildInfo.get('ABC')?.getWebhook('main')).toBe('https://boss')
  })
})

describe('cluster leaderboard webhook map', () => {
  const valid = 'https://discord.com/api/webhooks/1/token'

  it('drops a pasted channel link and keeps the valid boss webhook', () => {
    const { map, rejected } = buildClusterWebhookMap([
      {
        webhook_type: 'overall_leaderboard',
        webhook_url: 'https://discord.com/channels/111/222',
        thread_id: null
      },
      { webhook_type: 'boss_leaderboard', webhook_url: valid, thread_id: '9' }
    ])
    expect(map.overall).toBeNull()
    expect(map.boss).toEqual({ url: valid, threadId: '9' })
    expect(map.prime).toBeNull()
    expect(rejected).toHaveLength(1)
    expect(rejected[0].webhookType).toBe('overall_leaderboard')
    expect(rejected[0].reason).toContain('channel link')
    expect(rejected[0].reason).not.toContain('111')
  })

  it('rejects null URLs and ignores unrelated webhook types', () => {
    const { map, rejected } = buildClusterWebhookMap([
      { webhook_type: 'overall_leaderboard', webhook_url: null },
      { webhook_type: 'sync_status', webhook_url: 'https://discord.com/x' }
    ])
    expect(map).toEqual({ overall: null, boss: null, prime: null })
    expect(rejected).toEqual([
      { webhookType: 'overall_leaderboard', reason: 'webhook URL is empty' }
    ])
  })
})
