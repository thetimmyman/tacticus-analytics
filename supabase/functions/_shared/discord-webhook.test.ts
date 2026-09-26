import {
  assert,
  assertEquals,
  assertStringIncludes
} from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { sendOrUpdateMessage, sendWebhookMessage } from './discord-webhook.ts'
import { discordWebhookUrlProblem } from './discord-webhook-url.ts'

const WEBHOOK = 'https://discord.com/api/webhooks/123/PLACEHOLDER_tok-1'

async function withFetch(
  impl: (url: string, init?: RequestInit) => Response,
  fn: (calls: string[]) => Promise<void>
) {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push(url)
    return Promise.resolve(impl(url, init))
  }) as typeof fetch
  try {
    await fn(calls)
  } finally {
    globalThis.fetch = original
  }
}

Deno.test('discordWebhookUrlProblem classifies stored URLs', () => {
  assertEquals(discordWebhookUrlProblem(WEBHOOK), null)
  assertEquals(discordWebhookUrlProblem(`${WEBHOOK}?thread_id=9`), null)
  assertEquals(
    discordWebhookUrlProblem('https://discordapp.com/api/v10/webhooks/1/t'),
    null
  )
  assertEquals(
    discordWebhookUrlProblem('https://discord.com/channels/111/222'),
    'channel-url'
  )
  assertEquals(
    discordWebhookUrlProblem('https://example.com/api/webhooks/1/t'),
    'not-webhook'
  )
  assertEquals(
    discordWebhookUrlProblem('http://discord.com/api/webhooks/1/t'),
    'not-webhook'
  )
  assertEquals(discordWebhookUrlProblem(null), 'empty')
})

Deno.test('sendWebhookMessage never POSTs to a channel link', async () => {
  await withFetch(
    () => new Response('<!DOCTYPE html>', { status: 200 }),
    async (calls) => {
      const result = await sendWebhookMessage(
        'https://discord.com/channels/111/222',
        { content: 'x' },
        { ignoreEnabledFlag: true }
      )
      assertEquals(result.success, false)
      assertStringIncludes(result.error ?? '', 'channel link')
      assertEquals(calls.length, 0)
    }
  )
})

Deno.test(
  'sendWebhookMessage treats a 2xx HTML body as a failure without retrying',
  async () => {
    await withFetch(
      () =>
        new Response('<!DOCTYPE html><html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        }),
      async (calls) => {
        const result = await sendWebhookMessage(
          WEBHOOK,
          { content: 'x' },
          { ignoreEnabledFlag: true, retries: 3, retryDelay: 0 }
        )
        assertEquals(result.success, false)
        assertStringIncludes(result.error ?? '', 'non-JSON')
        assertStringIncludes(result.error ?? '', 'discord.com')
        assert(
          !(result.error ?? '').includes('PLACEHOLDER_tok-1'),
          'token leaked'
        )
        assertEquals(calls.length, 1)
      }
    )
  }
)

Deno.test(
  'sendWebhookMessage merges wait/thread_id into an existing query',
  async () => {
    await withFetch(
      () =>
        new Response(JSON.stringify({ id: '555' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }),
      async (calls) => {
        const result = await sendWebhookMessage(
          `${WEBHOOK}?thread_id=9`,
          { content: 'x' },
          { ignoreEnabledFlag: true, threadId: '77' }
        )
        assertEquals(result, { success: true, messageId: '555' })
        const url = new URL(calls[0])
        assertEquals(url.searchParams.get('wait'), 'true')
        assertEquals(url.searchParams.get('thread_id'), '77')
        assertEquals(calls[0].split('?').length, 2)
      }
    )
  }
)

Deno.test(
  'sendWebhookMessage redacts the token from network errors',
  async () => {
    const original = globalThis.fetch
    globalThis.fetch = (() =>
      Promise.reject(
        new TypeError(
          `error sending request for url (${WEBHOOK}?wait=true): connection refused`
        )
      )) as typeof fetch
    try {
      const result = await sendWebhookMessage(
        WEBHOOK,
        { content: 'x' },
        { ignoreEnabledFlag: true, retries: 1 }
      )
      assertEquals(result.success, false)
      assert(
        !(result.error ?? '').includes('PLACEHOLDER_tok-1'),
        'token leaked'
      )
      assertStringIncludes(result.error ?? '', 'webhooks/123/<redacted>')
    } finally {
      globalThis.fetch = original
    }
  }
)

const unknownWebhook = () =>
  new Response(JSON.stringify({ message: 'Unknown Webhook', code: 10015 }), {
    status: 404,
    headers: { 'content-type': 'application/json' }
  })

Deno.test('a deleted webhook is reported as gone, not retried', async () => {
  await withFetch(unknownWebhook, async (calls) => {
    const result = await sendWebhookMessage(
      WEBHOOK,
      { content: 'x' },
      { ignoreEnabledFlag: true, retries: 3, retryDelay: 0 }
    )
    assertEquals(result.success, false)
    assertEquals(result.webhookGone, true)
    assertEquals(calls.length, 1)
  })
})

Deno.test(
  'sendOrUpdateMessage does not re-create when the webhook itself is gone',
  async () => {
    await withFetch(unknownWebhook, async (calls) => {
      const result = await sendOrUpdateMessage(
        WEBHOOK,
        { content: 'x' },
        '999',
        { ignoreEnabledFlag: true }
      )
      assertEquals(result.webhookGone, true)
      assertEquals(result.messageGone, undefined)
      assertEquals(calls.length, 1)
    })
  }
)

Deno.test('an unknown message (10008) is still re-created', async () => {
  let n = 0
  await withFetch(
    () =>
      n++ === 0
        ? new Response(
            JSON.stringify({ message: 'Unknown Message', code: 10008 }),
            { status: 404, headers: { 'content-type': 'application/json' } }
          )
        : new Response(JSON.stringify({ id: '42' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }),
    async (calls) => {
      const result = await sendOrUpdateMessage(
        WEBHOOK,
        { content: 'x' },
        '999',
        { ignoreEnabledFlag: true }
      )
      assertEquals(result.success, true)
      assertEquals(result.messageId, '42')
      assertEquals(calls.length, 2)
    }
  )
})
