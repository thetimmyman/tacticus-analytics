import { describe, expect, it } from 'vitest'
import type {
  Supabase,
  CommandInteraction
} from '@/app/api/discord/interactions/command-handlers/types'
import { handlePlaybookCommand } from '@/app/api/discord/interactions/command-handlers/handlers/playbook/handle-playbook'

const interaction = (boss: string): CommandInteraction =>
  ({
    guild_id: 'guild-1',
    data: {
      name: 'playbook',
      options: [{ name: 'boss', type: 3, value: boss }]
    }
  }) as CommandInteraction

describe('/playbook', () => {
  it('links a known boss to the curated playbooks page without database reads', async () => {
    const from = () => {
      throw new Error('unexpected database read')
    }
    const result = await handlePlaybookCommand(
      { from } as unknown as Supabase,
      interaction('magnus')
    )
    expect(result.embeds?.[0]?.description).toContain('/boss-playbooks')
  })

  it('rejects an unknown boss', async () => {
    const result = await handlePlaybookCommand(
      {} as Supabase,
      interaction('not-a-boss')
    )
    expect(result.embeds?.[0]?.description).toContain('Unknown boss')
  })
})
