import { describe, it, expect, vi, beforeEach } from 'vitest'

const getOrFetch = vi.fn(
  async (_key: string, fetcher: () => Promise<unknown>) => fetcher()
)

vi.mock('@tacticus/app-core/unified-cache', () => ({
  mainCache: {
    getOrFetch: (key: string, fetcher: () => Promise<unknown>) =>
      getOrFetch(key, fetcher)
  }
}))

import { GuildConfigService } from '@/app/lib/services/guild-config-service'

// anon/authenticated lack SELECT on these; naming one fails the whole row (42501) for non-service callers.
const CREDENTIAL_COLUMNS = ['api_key_encrypted', 'session_id']

type Capture = {
  client: Parameters<typeof GuildConfigService.getFull>[0]
  selects: string[]
}

const capturingClient = (): Capture => {
  const selects: string[] = []
  const chain = {
    select: (columns: string) => {
      selects.push(columns)
      return chain
    },
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: null })
  }
  return {
    client: { from: () => chain } as unknown as Capture['client'],
    selects
  }
}

const columnsOf = (select: string | undefined): string[] =>
  (select ?? '')
    .split(',')
    .map((c) => c.trim().replace(/"/g, ''))
    .filter(Boolean)

beforeEach(() => {
  getOrFetch.mockClear()
})

describe('GuildConfigService projections', () => {
  it('getFull names no credential column', async () => {
    const { client, selects } = capturingClient()
    await GuildConfigService.getFull(client, 'WI5730A')

    expect(selects).toHaveLength(1)
    const columns = columnsOf(selects[0])
    for (const secret of CREDENTIAL_COLUMNS) {
      expect(columns).not.toContain(secret)
    }
    expect(columns).toContain('guild_code')
    expect(columns).toContain('api_key_is_valid')
    expect(columns).toContain('guild_id')
  })

  it('getFullWithSecrets names every credential column', async () => {
    const { client, selects } = capturingClient()
    await GuildConfigService.getFullWithSecrets(client, 'WI5730B')

    expect(selects).toHaveLength(1)
    const columns = columnsOf(selects[0])
    for (const secret of CREDENTIAL_COLUMNS) {
      expect(columns).toContain(secret)
    }
    expect(columns).toContain('guild_code')
  })

  it('getFullWithSecrets does not populate the cache getFull reads', async () => {
    // getFull's cache has no privilege dimension; a cached secret row would leak.
    const { client } = capturingClient()
    await GuildConfigService.getFullWithSecrets(client, 'WI5730C')
    expect(getOrFetch).not.toHaveBeenCalled()

    const second = capturingClient()
    await GuildConfigService.getFull(second.client, 'WI5730C')
    expect(getOrFetch).toHaveBeenCalledTimes(1)
  })
})
