/** Shared select constants must equal the inline strings they replaced. */
import { describe, it, expect } from 'vitest'
import {
  GUILD_DISPLAY_SELECT,
  GUILD_DISPLAY_COMPACT,
  TOKEN_THRESHOLD_SELECT,
  CLUSTER_LOOKUP_SELECT
} from '@/app/lib/guild-config-selects'

function columnSet(select: string): Set<string> {
  return new Set(
    select
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
  )
}

describe('select constants — exact inline-string identity', () => {
  it('GUILD_DISPLAY_SELECT === the inline string at all 6 sites', () => {
    expect(GUILD_DISPLAY_SELECT).toBe('guild_code, display_name, guild_tag')
  })

  it('GUILD_DISPLAY_COMPACT === the inline string at all 5 sites', () => {
    expect(GUILD_DISPLAY_COMPACT).toBe('guild_code,guild_tag,display_name')
  })

  it('TOKEN_THRESHOLD_SELECT === the inline string at all 3 sites', () => {
    expect(TOKEN_THRESHOLD_SELECT).toBe(
      'token_offender_threshold, token_abuser_threshold'
    )
  })

  it('CLUSTER_LOOKUP_SELECT === the inline string at all 6 sites', () => {
    expect(CLUSTER_LOOKUP_SELECT).toBe('guild_code, cluster_code')
  })
})

describe('select constants — column-set equivalence', () => {
  it('GUILD_DISPLAY_SELECT and GUILD_DISPLAY_COMPACT fetch the SAME column set', () => {
    // Column order differs by design, but the column sets must match.
    expect(columnSet(GUILD_DISPLAY_SELECT)).toEqual(
      columnSet(GUILD_DISPLAY_COMPACT)
    )
    expect(columnSet(GUILD_DISPLAY_SELECT)).toEqual(
      new Set(['guild_code', 'display_name', 'guild_tag'])
    )
  })

  it('TOKEN_THRESHOLD_SELECT is exactly the two threshold columns', () => {
    expect(columnSet(TOKEN_THRESHOLD_SELECT)).toEqual(
      new Set(['token_offender_threshold', 'token_abuser_threshold'])
    )
  })

  it('CLUSTER_LOOKUP_SELECT is exactly guild_code + cluster_code', () => {
    expect(columnSet(CLUSTER_LOOKUP_SELECT)).toEqual(
      new Set(['guild_code', 'cluster_code'])
    )
  })
})
