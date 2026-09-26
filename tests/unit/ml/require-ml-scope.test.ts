import { describe, it, expect, vi } from 'vitest'
import { requireMlScope } from '@/app/lib/ml/require-ml-scope'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

// /api/ml/* must not pass caller-supplied guild/cluster verbatim into RPCs.
const makeClient = (profile: unknown) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: profile }) })
        })
      })
    })
  }) as unknown as TypedSupabaseClient

describe('requireMlScope', () => {
  const member = {
    guild_code: 'TESTGLD',
    cluster_code: 'EOT',
    is_app_admin: false
  }

  it('allows the caller own guild', async () => {
    await expect(
      requireMlScope(makeClient(member), 'u1', 'TESTGLD', null)
    ).resolves.toBeUndefined()
  })

  it('rejects another guild', async () => {
    await expect(
      requireMlScope(makeClient(member), 'u1', 'OTHERGLD', null)
    ).rejects.toThrow(/Access denied for this guild/)
  })

  it('rejects the guild=other + cluster=mine bypass', async () => {
    // Pairing someone else's guild with your own cluster defeats a caller cluster param.
    await expect(
      requireMlScope(makeClient(member), 'u1', 'OTHERGLD', 'EOT')
    ).rejects.toThrow(/Access denied for this guild/)
  })

  it('rejects a cluster the caller does not belong to', async () => {
    await expect(
      requireMlScope(makeClient(member), 'u1', 'TESTGLD', 'OTHERCLUSTER')
    ).rejects.toThrow(/Access denied for this cluster/)
  })

  it('rejects a caller with no current membership', async () => {
    await expect(
      requireMlScope(makeClient(null), 'u1', 'TESTGLD', null)
    ).rejects.toThrow(/Current guild membership required/)
  })

  it('lets an app admin read across guilds', async () => {
    const admin = { ...member, is_app_admin: true }
    await expect(
      requireMlScope(makeClient(admin), 'u1', 'OTHERGLD', 'OTHERCLUSTER')
    ).resolves.toBeUndefined()
  })

  it('compares a post-WI-825 UUID guild_code case-insensitively', async () => {
    const uuid = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b'
    const uuidMember = { ...member, guild_code: uuid }
    await expect(
      requireMlScope(makeClient(uuidMember), 'u1', uuid.toUpperCase(), null)
    ).resolves.toBeUndefined()
  })
})
