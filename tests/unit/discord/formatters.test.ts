import { describe, expect, it } from 'vitest'
import {
  formatBossAssignmentEmbed,
  formatLeaderboardEmbed,
  formatTokenCapAlert,
  formatWarUpdateEmbed
} from '@/app/lib/discord/formatters'

describe('discord formatters', () => {
  it('formats boss assignment embeds with summary', () => {
    const payload = formatBossAssignmentEmbed(
      [
        {
          tier: 'Legendary',
          boss_name: 'Mortarion',
          boss_code: 'L1',
          primary_tokens: 2,
          secondary_tokens: 1,
          assigned_players: ['Alice', 'Bob']
        }
      ],
      {
        season: '85',
        source: 'manual',
        contextLabel: 'EOT'
      }
    )

    const embed = payload.embeds?.[0]
    expect(embed?.title).toContain('Boss Assignments')
    expect(embed?.description).toContain('Season 85')
    expect(embed?.fields?.some((field) => field.name === '📊 Summary')).toBe(
      true
    )
  })

  it('formats war result updates', () => {
    const payload = formatWarUpdateEmbed({
      reportType: 'war_result',
      opponentGuildName: 'Opponents',
      result: 'win',
      guildScore: 300,
      opponentScore: 200,
      warSeason: 12,
      battlefieldLevel: 6,
      topPerformers: [{ name: 'Alice', score: 12345 }]
    })

    const embed = payload.embeds?.[0]
    expect(embed?.title).toContain('War Victory')
    expect(
      embed?.fields?.some((field) => field.name === '🌟 Top Performers')
    ).toBe(true)
  })

  it('formats token cap alerts with guild label', () => {
    const payload = formatTokenCapAlert([{ name: 'PlayerOne', tokens: 3 }], {
      guildName: 'EOT'
    })

    expect(payload.embeds?.[0].title).toContain('Token Cap Alert - EOT')
  })

  it('formats leaderboard embeds for overall rankings', () => {
    const payload = formatLeaderboardEmbed({
      type: 'overall_leaderboard',
      season: '85',
      data: [
        {
          display_name: 'Ace',
          total_damage: 123456,
          battle_count: 10,
          guild_code: 'EOT'
        }
      ]
    })

    expect(payload.embeds?.[0].title).toContain('Overall Leaderboard')
  })
})
