import { describe, expect, it } from 'vitest'
import {
  apiKeyProvesGuild,
  canonicalizeGuildCode,
  guildIdentitiesMatch,
  nullableGuildIdentitiesMatch
} from '@/app/api/clusters/_lib/guild-identity'

describe('cluster guild identity helpers', () => {
  it('canonicalizes tags and immutable UUID identifiers consistently', () => {
    expect(canonicalizeGuildCode(' eot ')).toBe('EOT')
    expect(canonicalizeGuildCode('A0B1C2D3-E4F5-6789-ABCD-EF0123456789')).toBe(
      'a0b1c2d3-e4f5-6789-abcd-ef0123456789'
    )
  })

  it('requires non-empty identities while preserving nullable comparisons', () => {
    expect(guildIdentitiesMatch(' eot ', 'EOT')).toBe(true)
    expect(guildIdentitiesMatch(null, null)).toBe(false)
    expect(nullableGuildIdentitiesMatch(null, null)).toBe(true)
    expect(nullableGuildIdentitiesMatch(null, 'EOT')).toBe(false)
  })

  it('accepts API-key proof by immutable id or canonical code only', () => {
    const proof = {
      isValid: true,
      guildInfo: { guildId: 'guild-id', guildCode: 'EOT' }
    }

    expect(apiKeyProvesGuild(proof, 'GUILD-ID')).toBe(true)
    expect(apiKeyProvesGuild(proof, 'eot')).toBe(true)
    expect(apiKeyProvesGuild(proof, 'OTHER')).toBe(false)
    expect(apiKeyProvesGuild({ ...proof, isValid: false }, 'EOT')).toBe(false)
  })
})
