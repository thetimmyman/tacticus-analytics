import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The body is shared byte-identically with a second database, and the pgTAP lane cannot apply these migrations,
 * so this is the only CI check of the shipped body.
 */

const MIGRATION = join(
  process.cwd(),
  'supabase/migrations/20260904080000_ps200_estimator_freshness_guard.sql'
)

const ACTIVE_MIGRATION = join(
  process.cwd(),
  'supabase/migrations/20260921130000_ps293_late_arrival_window.sql'
)

// Recorded here as well as in the header so neither can change alone.
const EXPECTED_BODY_SHA256 =
  '74192b4a8552a5dd1fe50b931ea3820a76935cfc332c85d9657600af5560c279'

const EXPECTED_ACTIVE_BODY_SHA256 =
  '01caa2e66dd0a0b8921f68cab9718e10c5d47db74b5672bef1c5407d2824a403'

const CREATE_MARKER =
  'CREATE OR REPLACE FUNCTION public.run_token_invariant_monitor()'
const OPEN_DELIMITER = 'AS $fn$'
const CLOSE_DELIMITER = '$fn$;'

function extractBody(sql: string): string {
  const create = sql.indexOf(CREATE_MARKER)
  expect(create, 'the migration defines the monitor').toBeGreaterThanOrEqual(0)
  expect(
    sql.indexOf(CREATE_MARKER, create + 1),
    'exactly one definition of the monitor'
  ).toBe(-1)
  const open = sql.indexOf(OPEN_DELIMITER, create)
  expect(open, 'the definition opens an $fn$ body').toBeGreaterThan(create)
  const bodyStart = open + OPEN_DELIMITER.length
  const close = sql.indexOf(CLOSE_DELIMITER, bodyStart)
  expect(close, 'the $fn$ body is terminated').toBeGreaterThan(bodyStart)
  return sql.slice(bodyStart, close)
}

function extractPins(sql: string): string[] {
  return [...sql.matchAll(/^--\s*sha256\s*=\s*([0-9a-f]{64})\s*$/gm)].map(
    (match) => match[1]
  )
}

const sha256Hex = (text: string) =>
  createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')

function longestCommonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1
  return i
}

function longestCommonSuffix(a: string, b: string, floor: number): number {
  let i = 0
  while (
    i < a.length - floor &&
    i < b.length - floor &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  )
    i += 1
  return i
}

function legCRegion(body: string): string {
  const open = body.indexOf('WITH win AS (')
  expect(open, 'leg (c) opens its windowed CTE').toBeGreaterThanOrEqual(0)
  const close = body.indexOf('AS late_arrival', open)
  expect(close, 'leg (c) labels the late-arrival column').toBeGreaterThan(open)
  expect(
    body.indexOf('AS late_arrival', close + 1),
    'exactly one late_arrival column'
  ).toBe(-1)
  return body.slice(open, close)
}

describe('PS-200 monitor body pin', () => {
  const sql = readFileSync(MIGRATION, 'utf8')

  it('declares the General database as its target and hard-guards the apply', () => {
    expect(sql).toContain('-- target-db: general')
    expect(sql).toContain("IF current_database() <> 'postgres' THEN")
    expect(sql).toContain('RAISE EXCEPTION')
  })

  it('carries exactly one sha256 pin in its header', () => {
    expect(extractPins(sql)).toHaveLength(1)
  })

  it('the body hashes to the pinned value', () => {
    const body = extractBody(sql)
    // Non-vacuity floor: an empty or truncated body cannot match a pin.
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(10_000)
    expect(sha256Hex(body)).toBe(EXPECTED_BODY_SHA256)
    expect(extractPins(sql)[0]).toBe(EXPECTED_BODY_SHA256)
  })

  it('NEGATIVE CONTROL: a body edit that leaves the pin alone is caught', () => {
    const mutated = sql.replace('DECLARE', 'DECLARE -- drifted')
    expect(mutated, 'the mutation must actually change the file').not.toBe(sql)
    expect(sha256Hex(extractBody(mutated))).not.toBe(extractPins(mutated)[0])
  })

  it('NEGATIVE CONTROL: a pin edit that leaves the body alone is caught', () => {
    const mutated = sql.replace(
      /^--\s*sha256\s*=\s*[0-9a-f]{64}\s*$/m,
      '--   sha256 = ' + 'f'.repeat(64)
    )
    expect(mutated, 'the mutation must actually change the file').not.toBe(sql)
    expect(extractPins(mutated)[0]).toBe('f'.repeat(64))
    expect(sha256Hex(extractBody(mutated))).toBe(EXPECTED_BODY_SHA256)
    expect(extractPins(mutated)[0]).not.toBe(EXPECTED_BODY_SHA256)
  })
})

describe('PS-293 monitor body pin (the body the databases run)', () => {
  const sql = readFileSync(ACTIVE_MIGRATION, 'utf8')

  it('declares the General database as its target and hard-guards the apply', () => {
    expect(sql).toContain('-- target-db: general')
    expect(sql).toContain("IF current_database() <> 'postgres' THEN")
    expect(sql).toContain('RAISE EXCEPTION')
  })

  it("carries this repository's PS-331 version allocation (:00 seconds)", () => {
    const version = ACTIVE_MIGRATION.split('/').pop()!.slice(0, 14)
    expect(version > '20260920000000').toBe(true)
    expect(version.endsWith('00')).toBe(true)
  })

  it('carries exactly one sha256 pin in its header', () => {
    expect(extractPins(sql)).toHaveLength(1)
  })

  it('the body hashes to the pinned value', () => {
    const body = extractBody(sql)
    // Non-vacuity floor.
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(10_000)
    expect(sha256Hex(body)).toBe(EXPECTED_ACTIVE_BODY_SHA256)
    expect(extractPins(sql)[0]).toBe(EXPECTED_ACTIVE_BODY_SHA256)
  })

  it('supersedes PS-200: a different body, and the old pin is not reused', () => {
    expect(EXPECTED_ACTIVE_BODY_SHA256).not.toBe(EXPECTED_BODY_SHA256)
    expect(sha256Hex(extractBody(sql))).not.toBe(
      sha256Hex(extractBody(readFileSync(MIGRATION, 'utf8')))
    )
  })

  it('differs from the PS-200 body only inside leg (c)', () => {
    const oldBody = extractBody(readFileSync(MIGRATION, 'utf8'))
    const newBody = extractBody(sql)

    const prefix = longestCommonPrefix(oldBody, newBody)
    const suffix = longestCommonSuffix(oldBody, newBody, prefix)
    const oldMiddle = oldBody.slice(prefix, oldBody.length - suffix)
    const newMiddle = newBody.slice(prefix, newBody.length - suffix)

    expect(oldMiddle.length).toBeGreaterThan(0)
    expect(newMiddle.length).toBeGreaterThan(0)

    expect(legCRegion(oldBody)).toContain(oldMiddle)
    expect(legCRegion(newBody)).toContain(newMiddle)

    expect(oldMiddle).not.toContain('startedOn')
    expect(newMiddle).toContain('"startedOn" <= t.created_at')
    expect(newMiddle).toContain('coalesce(min(g.id), 9223372036854775807)')
  })

  it('NEGATIVE CONTROL: an edit outside leg (c) is caught by that comparison', () => {
    const oldBody = extractBody(readFileSync(MIGRATION, 'utf8'))
    const newBody = extractBody(sql)
    const mutated = newBody.replace(
      "c_window      timestamptz := now() - interval '26 hours';",
      "c_window      timestamptz := now() - interval '48 hours';"
    )
    expect(mutated, 'the mutation must actually change the body').not.toBe(
      newBody
    )

    const prefix = longestCommonPrefix(oldBody, mutated)
    const suffix = longestCommonSuffix(oldBody, mutated, prefix)
    const mutatedMiddle = mutated.slice(prefix, mutated.length - suffix)
    expect(legCRegion(mutated)).not.toContain(mutatedMiddle)
  })

  it('NEGATIVE CONTROL: a body edit that leaves the pin alone is caught', () => {
    const mutated = sql.replace('DECLARE', 'DECLARE -- drifted')
    expect(mutated, 'the mutation must actually change the file').not.toBe(sql)
    expect(sha256Hex(extractBody(mutated))).not.toBe(extractPins(mutated)[0])
  })

  it('NEGATIVE CONTROL: a pin edit that leaves the body alone is caught', () => {
    const mutated = sql.replace(
      /^--\s*sha256\s*=\s*[0-9a-f]{64}\s*$/m,
      '--   sha256 = ' + 'f'.repeat(64)
    )
    expect(mutated, 'the mutation must actually change the file').not.toBe(sql)
    expect(extractPins(mutated)[0]).toBe('f'.repeat(64))
    expect(sha256Hex(extractBody(mutated))).toBe(EXPECTED_ACTIVE_BODY_SHA256)
    expect(extractPins(mutated)[0]).not.toBe(EXPECTED_ACTIVE_BODY_SHA256)
  })
})
