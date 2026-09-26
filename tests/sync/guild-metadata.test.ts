import { describe, expect, it } from 'vitest'
import {
  buildGuildConfigMetadataUpdate,
  extractGuildApiMetadata
} from '../../supabase/functions/_shared/sync-modules/guild-metadata.ts'

describe('guild metadata sync helpers', () => {
  it('extracts nested Tacticus guild name and tag metadata', () => {
    const metadata = extractGuildApiMetadata({
      guild: {
        name: 'Renamed Guild',
        guildTag: 'RNG'
      }
    })

    expect(metadata).toEqual({
      displayName: 'Renamed Guild',
      guildTag: 'RNG'
    })
  })

  it('builds a guild_config update when upstream metadata changed', () => {
    const update = buildGuildConfigMetadataUpdate(
      {
        guild: {
          name: 'Renamed Guild',
          guildTag: 'RNG'
        }
      },
      {
        display_name: 'Original Guild',
        guild_tag: 'ORG'
      },
      '2026-05-13T12:00:00.000Z'
    )

    expect(update).toEqual({
      display_name: 'Renamed Guild',
      guild_tag: 'RNG',
      updated_at: '2026-05-13T12:00:00.000Z'
    })
  })

  it('supports top-level API metadata fields', () => {
    const update = buildGuildConfigMetadataUpdate(
      {
        name: 'Current Game Name',
        guildTag: 'CGN'
      },
      {
        display_name: 'Old Name',
        guild_tag: null
      },
      '2026-05-13T12:00:00.000Z'
    )

    expect(update).toEqual({
      display_name: 'Current Game Name',
      guild_tag: 'CGN',
      updated_at: '2026-05-13T12:00:00.000Z'
    })
  })

  it('does not update unchanged metadata', () => {
    const update = buildGuildConfigMetadataUpdate(
      {
        guild: {
          name: 'Renamed Guild',
          guildTag: 'RNG'
        }
      },
      {
        display_name: 'Renamed Guild',
        guild_tag: 'RNG'
      },
      '2026-05-13T12:00:00.000Z'
    )

    expect(update).toEqual({})
  })

  it('does not overwrite current labels with empty upstream metadata', () => {
    const update = buildGuildConfigMetadataUpdate(
      {
        guild: {
          name: '   ',
          guildTag: ''
        }
      },
      {
        display_name: 'Existing Name',
        guild_tag: 'EXIST'
      },
      '2026-05-13T12:00:00.000Z'
    )

    expect(update).toEqual({})
  })
})
