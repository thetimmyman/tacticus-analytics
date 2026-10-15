import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createHmac } from 'node:crypto'
import { expect, it } from 'vitest'

const run = promisify(execFile)

async function observe(scenario = 'unavailable', key = '') {
  const { stdout } = await run(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(
        new URL(
          '../../fixtures/network/provider-observation.mts',
          import.meta.url
        )
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
        PROVIDER_ADMISSION_MODE: ['enforced', 'refused'].includes(scenario)
          ? 'enforce'
          : 'off',
        PROVIDER_ADMISSION_ORIGIN: 'https://synthetic-control.invalid',
        PROVIDER_ADMISSION_TOKEN: 'synthetic-control-token',
        PROVIDER_ACCOUNT_LABEL_KEY: key
      }
    }
  )
  const records = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  expect(stdout).not.toContain('synthetic-player-key')
  expect(stdout).not.toContain('synthetic-second-key')
  expect(stdout).not.toContain('synthetic-mutated-key')
  expect(stdout).not.toContain('synthetic-control-token')
  if (key) expect(stdout).not.toContain(key)
  expect(
    records.filter((record) => record.event === 'fixture_ready')
  ).toHaveLength(1)
  return {
    result: records.find((record) => record.event === 'fixture_result'),
    dispatches: records.filter(
      (record) => record.event === 'provider_dispatch'
    ),
    outcomes: records.filter(
      (record) => record.event === 'provider_dispatch_result'
    )
  }
}

it('records one physical dispatch through the actual Node logger with unavailable account attribution', async () => {
  const { result, dispatches, outcomes } = await observe()
  expect(result).toMatchObject({
    physicalRequests: 1,
    metrics: { api_calls: 1, api_errors: 0, api_retry_count: 0 }
  })
  expect(dispatches).toHaveLength(1)
  expect(dispatches[0]).toMatchObject({
    schema_version: 1,
    application: 'tacticus-analytics',
    runtime: 'node',
    domain: 'official',
    endpoint: '/api/v1/player',
    purpose: 'unknown',
    account_label: null,
    attribution: 'unavailable',
    retry: false
  })
  expect(dispatches[0]?.correlation_id).toMatch(/^corr_[0-9a-f-]{36}$/)
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0]).toMatchObject({
    correlation_id: dispatches[0]?.correlation_id,
    outcome: 'fetch-resolved',
    status: 200,
    response_bytes: null,
    body_completion: 'unknown',
    error_kind: 'none',
    fetch_duration_ms: expect.any(Number)
  })
})

it('binds concurrent keyed attribution to immutable wire inputs and existing retry context', async () => {
  const key = 'K'.repeat(32)
  const { result, dispatches, outcomes } = await observe('attributed', key)
  expect(result).toMatchObject({
    physicalRequests: 2,
    metrics: { api_calls: 2, api_errors: 0, api_retry_count: 1 }
  })
  const label = (credential: string) =>
    createHmac('sha256', key)
      .update(`official-credential\0${credential}`)
      .digest('hex')
  expect(dispatches).toHaveLength(2)
  expect(dispatches).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        endpoint: '/api/v1/player',
        purpose: 'roster-fetch',
        account_label: label('synthetic-player-key'),
        attribution: 'resolved',
        retry: false
      }),
      expect.objectContaining({
        endpoint: '/api/v1/player',
        purpose: 'credential-check',
        account_label: label('synthetic-second-key'),
        attribution: 'resolved',
        retry: true
      })
    ])
  )
  expect(new Set(dispatches.map((r) => r.correlation_id)).size).toBe(2)
  expect(outcomes.map((r) => r.correlation_id).sort()).toEqual(
    dispatches.map((r) => r.correlation_id).sort()
  )
})

it('does not charge Discord, internal traffic, pre-abort, invalid configuration or local admission refusal', async () => {
  const excluded = await observe('excluded')
  expect(excluded.result).toMatchObject({
    physicalRequests: 0,
    controls: 0,
    metrics: { api_calls: 0, api_errors: 0, api_retry_count: 0 }
  })
  expect(excluded.dispatches).toHaveLength(0)
  expect(excluded.outcomes).toHaveLength(0)
  const refused = await observe('refused', 'K'.repeat(32))
  expect(refused.result).toMatchObject({
    physicalRequests: 0,
    controls: 1,
    metrics: { api_calls: 0, api_errors: 0, api_retry_count: 0 }
  })
  expect(refused.dispatches).toHaveLength(0)
  expect(refused.outcomes).toHaveLength(0)
})

it('records only the admitted physical send and retains its opaque attribution', async () => {
  const { result, dispatches, outcomes } = await observe(
    'enforced',
    'K'.repeat(32)
  )
  expect(result).toMatchObject({
    physicalRequests: 1,
    metrics: { api_calls: 1, api_errors: 0 }
  })
  expect(Number(result?.controls)).toBeGreaterThanOrEqual(3)
  expect(dispatches).toHaveLength(1)
  expect(dispatches[0]).toMatchObject({
    purpose: 'roster-fetch',
    attribution: 'resolved',
    account_label: expect.stringMatching(/^[0-9a-f]{64}$/)
  })
  expect(outcomes).toHaveLength(1)
})

it('keeps missing or invalid account-label configuration explicitly unattributed', async () => {
  for (const key of ['', 'short']) {
    const { result, dispatches } = await observe('decode', key)
    expect(result).toMatchObject({ physicalRequests: 1 })
    expect(dispatches).toHaveLength(1)
    expect(dispatches[0]).toMatchObject({
      purpose: 'roster-fetch',
      account_label: null,
      attribution: 'unavailable'
    })
  }
})

it('keeps fetch completion separate from late JSON failures on the response and clone', async () => {
  const { result, dispatches, outcomes } = await observe('decode')
  expect(result).toMatchObject({
    physicalRequests: 1,
    metrics: { api_calls: 1, api_errors: 1, api_retry_count: 0 }
  })
  expect(dispatches).toHaveLength(1)
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0]).toMatchObject({
    outcome: 'fetch-resolved',
    status: 200,
    error_kind: 'none',
    body_completion: 'unknown'
  })
})
