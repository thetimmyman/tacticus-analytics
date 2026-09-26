import { describe, expect, it } from 'vitest'
import { handleAskCommand } from '@/app/api/discord/interactions/command-handlers/handlers/support/handle-ask'
import { SUPPORT_KNOWLEDGE_BASE } from '@/app/lib/guild-ops/support-knowledge-base'
import type {
  Supabase,
  CommandInteraction
} from '@/app/api/discord/interactions/command-handlers/types'

const EPHEMERAL_FLAG = 1 << 6

const supabaseThatThrows = new Proxy(
  {},
  {
    get() {
      throw new Error('handleAskCommand must not touch the database')
    }
  }
) as unknown as Supabase

function makeInteraction(question?: string): CommandInteraction {
  return {
    guild_id: '100000000000000001',
    data: {
      name: 'ask',
      options: question ? [{ name: 'question', type: 3, value: question }] : []
    }
  } as unknown as CommandInteraction
}

describe('handleAskCommand', () => {
  it('answers a KB-matching question with sources, ephemerally, without DB access', async () => {
    const response = await handleAskCommand(
      supabaseThatThrows,
      makeInteraction('How do I add my Player API key?')
    )

    expect(response.flags).toBe(EPHEMERAL_FLAG)
    const embed = response.embeds?.[0]
    expect(embed?.description).toBeTruthy()
    const sourcesField = embed?.fields?.find((f) => f.name === 'Sources')
    expect(sourcesField?.value).toBeTruthy()
    const knownRefs = SUPPORT_KNOWLEDGE_BASE.map((entry) => entry.sourceRef)
    expect(knownRefs.some((ref) => sourcesField?.value.includes(ref))).toBe(
      true
    )
  })

  it('routes an unmatchable question to human handoff instead of guessing', async () => {
    const response = await handleAskCommand(
      supabaseThatThrows,
      makeInteraction('zzqxw gibberish nonsense 12345')
    )

    expect(response.flags).toBe(EPHEMERAL_FLAG)
    expect(response.embeds?.[0]?.title).toContain('No confident answer')
    expect(response.embeds?.[0]?.description).toContain('officer')
  })

  it('rejects a missing question option', async () => {
    const response = await handleAskCommand(
      supabaseThatThrows,
      makeInteraction()
    )

    expect(response.flags).toBe(EPHEMERAL_FLAG)
    expect(JSON.stringify(response)).toContain('provide a question')
  })
})
