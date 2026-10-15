import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const run = promisify(execFile)

async function observe(scenario: string) {
  const { stdout } = await run(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(
        new URL('../../fixtures/network/global-config-cdn.mts', import.meta.url)
      ),
      scenario
    ],
    {
      cwd: process.cwd(),
      timeout: 8000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        NEXT_PUBLIC_RUNTIME_PROFILE: 'hosted',
        PROVIDER_ADMISSION_MODE: [
          'refused',
          'enforced',
          'siblings',
          'missing',
          'http-enforced',
          'http-enforced-open'
        ].includes(scenario)
          ? 'enforce'
          : 'off',
        PROVIDER_ADMISSION_ORIGIN: 'https://synthetic-control.invalid',
        PROVIDER_ADMISSION_TOKEN: 'synthetic-control-token',
        PROVIDER_ACCOUNT_LABEL_KEY: 'K'.repeat(32)
      }
    }
  )
  expect(stdout).not.toContain('synthetic-control-token')
  expect(stdout).not.toContain('K'.repeat(32))
  expect(stdout).not.toContain('synthetic-account')
  expect(stdout).not.toContain('synthetic alert')
  const records = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  return {
    result: records.find((r) => r.event === 'fixture_result'),
    dispatches: records.filter((r) => r.event === 'provider_dispatch'),
    outcomes: records.filter((r) => r.event === 'provider_dispatch_result')
  }
}

it('observes the public CDN download once with closed operation labels and preserves its config', async () => {
  const { result, dispatches, outcomes } = await observe('success')
  expect(result).toMatchObject({
    physicalRequests: 1,
    controls: 0,
    metrics: { api_calls: 1, api_errors: 0, api_retry_count: 0 }
  })
  expect(dispatches).toHaveLength(1)
  expect(dispatches[0]).toMatchObject({
    domain: 'cdn',
    endpoint: '/config/global/GlobalConfig.<hash>.json',
    purpose: 'game-config-refresh',
    trigger: 'scheduled',
    retry: false,
    attribution: 'resolved',
    account_label: expect.stringMatching(/^[0-9a-f]{64}$/)
  })
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0]).toMatchObject({
    correlation_id: dispatches[0]?.correlation_id,
    status: 200,
    response_bytes: null,
    body_completion: 'unknown'
  })
})

it.each(['retry', 'exhausted'])(
  'charges each of at most three physical attempts on %s',
  async (scenario) => {
    const { result, dispatches, outcomes } = await observe(scenario)
    expect(result).toMatchObject({
      physicalRequests: 3,
      metrics: {
        api_calls: 3,
        api_errors: scenario === 'retry' ? 2 : 3,
        api_retry_count: 2
      }
    })
    expect(dispatches).toHaveLength(3)
    expect(dispatches.map((r) => r.retry)).toEqual([false, true, true])
    expect(new Set(dispatches.map((r) => r.correlation_id)).size).toBe(3)
    expect(outcomes.map((r) => r.correlation_id)).toEqual(
      dispatches.map((r) => r.correlation_id)
    )
  }
)

it('stops at local admission refusal with zero physical attempts and no retry storm', async () => {
  const { result, dispatches, outcomes } = await observe('refused')
  expect(result).toMatchObject({
    physicalRequests: 0,
    controls: 1,
    metrics: { api_calls: 0, api_errors: 0, api_retry_count: 0 }
  })
  expect(dispatches).toHaveLength(0)
  expect(outcomes).toHaveLength(0)
})

it('uses the existing authority exchanges without counting them as CDN attempts', async () => {
  const { result, dispatches, outcomes } = await observe('enforced')
  expect(result).toMatchObject({
    physicalRequests: 1,
    metrics: { api_calls: 1, api_errors: 0, api_retry_count: 0 }
  })
  expect(Number(result?.controls)).toBeGreaterThanOrEqual(3)
  expect(dispatches).toHaveLength(1)
  expect(outcomes).toHaveLength(1)
})

it('does not retry HTTP 429 or invalid version input', async () => {
  const http = await observe('http')
  expect(http.result).toMatchObject({
    physicalRequests: 1,
    metrics: { api_calls: 1, api_errors: 1, api_retry_count: 0 }
  })
  expect(http.outcomes).toHaveLength(1)
  expect(http.outcomes[0]).toMatchObject({ status: 429 })
  const invalid = await observe('invalid')
  expect(invalid.result).toMatchObject({
    physicalRequests: 0,
    controls: 0,
    metrics: { api_calls: 0, api_errors: 0, api_retry_count: 0 }
  })
  expect(invalid.dispatches).toHaveLength(0)
})

it('does not enroll APP_START or Discord when managed CDN traffic is enabled', async () => {
  const { result, dispatches } = await observe('siblings')
  expect(result).toMatchObject({
    physicalRequests: 0,
    controls: 0,
    siblingRequests: 2,
    metrics: { api_calls: 0, api_errors: 0, api_retry_count: 0 }
  })
  expect(dispatches).toHaveLength(0)
})

it('keeps absent caller metadata unknown rather than inventing a trigger', async () => {
  const { dispatches } = await observe('unknown')
  expect(dispatches).toHaveLength(1)
  expect(dispatches[0]).toMatchObject({ trigger: 'unknown' })
})

it('refuses missing operation context under enforcement before any control or CDN request', async () => {
  const { result, dispatches, outcomes } = await observe('missing')
  expect(result).toMatchObject({
    physicalRequests: 0,
    controls: 0,
    metrics: { api_calls: 0, api_errors: 0, api_retry_count: 0 }
  })
  expect(dispatches).toHaveLength(0)
  expect(outcomes).toHaveLength(0)
})

it.each(['http-enforced', 'http-enforced-open'])(
  'settles %s before the deadline and admits the next one-slot operation',
  async (scenario) => {
    const { result, dispatches, outcomes } = await observe(scenario)
    expect(result).toMatchObject({
      physicalRequests: 2,
      settledHttpErrors: 1,
      permitHeld: false,
      slotDenials: 0,
      metrics: { api_calls: 2, api_errors: 1, api_retry_count: 0 }
    })
    if (scenario === 'http-enforced-open')
      expect(result).toMatchObject({ firstBodyCancelled: true })
    expect(dispatches).toHaveLength(2)
    expect(dispatches.map((r) => r.retry)).toEqual([false, false])
    expect(outcomes.map((r) => r.status)).toEqual([429, 200])
  }
)
