import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const entrypoint = readFileSync(
  'supabase/functions/discord-notifications/index.ts',
  'utf8'
)
const handlers = readFileSync(
  'supabase/functions/discord-notifications/command-handlers.ts',
  'utf8'
)

describe('Discord notification command boundary', () => {
  it('keeps request verification and dispatch in a thin entrypoint', () => {
    expect(entrypoint.split('\n').length).toBeLessThan(80)
    expect(entrypoint).toContain('verifyDiscordRequest')
    expect(entrypoint).toContain('createDiscordCommandContext(supabase)')
    expect(entrypoint).toContain('getDiscordCommandHandler(body.data.name)')
    expect(entrypoint).toContain('sendFollowupMessage(body.token')
    expect(entrypoint).not.toContain('sendFollowUpMessage')
    expect(entrypoint).not.toContain('async function handleTokensCommand')
  })

  it('registers every supported command behind an own-property lookup', () => {
    for (const command of [
      'help',
      'status',
      'link',
      'tokens',
      'bombs',
      'token-usage',
      'player-tokens',
      'raid-status',
      'token-reminder',
      'guild-stats',
      'player-stats',
      'time-to-burn'
    ]) {
      expect(handlers).toMatch(
        new RegExp(`(?:'${command}'|${command.replace('-', '\\-')}):`)
      )
    }
    expect(handlers).toContain('Object.hasOwn(commandHandlers, name)')
  })
})
