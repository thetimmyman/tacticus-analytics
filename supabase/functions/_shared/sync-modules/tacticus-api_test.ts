import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  callTacticusApi,
  fetchGuildMembersViaTacticus
} from './tacticus-api.ts'

const logger = { debug: () => {}, warn: () => {}, info: () => {} }
const config = { baseUrl: 'https://provider.invalid/api/v1', maxRetries: 0 }
const timeouts = {
  createSignal: () => AbortSignal.timeout(1000),
  canStartOperation: () => true
}

Deno.test(
  'optional member failures do not suppress healthy guild and raid requests',
  async () => {
    const originalFetch = globalThis.fetch
    const paths: string[] = []
    globalThis.fetch = async (input) => {
      const path = new URL(String(input)).pathname
      paths.push(path)
      return path.endsWith('/members')
        ? new Response(null, { status: 500 })
        : Response.json({ guild: {}, entries: [] })
    }
    try {
      for (let i = 0; i < 2; i++) {
        const members = await fetchGuildMembersViaTacticus(
          'synthetic-key',
          'synthetic-guild',
          'TEST',
          timeouts,
          config,
          logger
        )
        assertEquals(members.success, false)
      }
      for (const endpoint of ['/guild', '/guildRaid']) {
        const result = await callTacticusApi(
          endpoint,
          'synthetic-key',
          'TEST',
          timeouts,
          config,
          logger
        )
        assertEquals(result.success, true)
      }
      // The optional endpoint still opens its own breaker and stops dispatching.
      const members = await fetchGuildMembersViaTacticus(
        'synthetic-key',
        'synthetic-guild',
        'TEST',
        timeouts,
        config,
        logger
      )
      assertEquals(members.error, 'Circuit breaker is OPEN')
      assertEquals(paths, [
        '/api/v1/guild/synthetic-guild/members',
        '/api/v1/guild/synthetic-guild/members',
        '/api/v1/guild',
        '/api/v1/guildRaid'
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  }
)

Deno.test(
  'repeated raid failures still stop dispatching essential requests',
  async () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return new Response(null, { status: 503 })
    }
    try {
      for (let i = 0; i < 2; i++) {
        const result = await callTacticusApi(
          '/guildRaid',
          'synthetic-key',
          'TEST',
          timeouts,
          config,
          logger
        )
        assertEquals(result.success, false)
      }
      const blocked = await callTacticusApi(
        '/guildRaid',
        'synthetic-key',
        'TEST',
        timeouts,
        config,
        logger
      )
      assertEquals(blocked.error, 'Circuit breaker is OPEN')
      assertEquals(calls, 2)
    } finally {
      globalThis.fetch = originalFetch
    }
  }
)
