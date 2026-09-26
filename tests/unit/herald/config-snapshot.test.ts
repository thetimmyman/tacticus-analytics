import { describe, expect, it } from 'vitest'
import { validateSnapshot } from '@/app/lib/herald/config-snapshot'

describe('validateSnapshot', () => {
  it('defaults missing per-boss Discord role labels to an empty map', () => {
    const out = validateSnapshot({
      guild_config: null,
      herald_meta_role_mapping: [],
      herald_boss_config: [
        {
          boss_id: 'Magnus_E0',
          rarity_set: null,
          enabled: true,
          webhook_config_ids: [],
          discord_role_ids: []
        }
      ]
    })

    expect(out).not.toBeNull()
    expect(out!.herald_boss_config[0].discord_role_labels).toEqual({})
  })
})
