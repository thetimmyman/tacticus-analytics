/**
 * The exposed-schema credential census runs twice (pgTAP on the replay lane, SQL on a live
 * database); both must test the schemas PostgREST actually serves, with the same predicates.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

const suite = read('supabase/tests/pgtap/exposed_schema_secret_columns.sql')
const census = read('scripts/security/exposed-schema-census.sql')
const config = read('supabase/config.toml')

function exposedSchemas(): string[] {
  const api = config.split(/^\[/m).find((section) => section.startsWith('api]'))
  const match = api?.match(/^schemas\s*=\s*\[([^\]]*)\]/m)
  if (!match) throw new Error('supabase/config.toml has no [api] schemas list')
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()
}

function schemaLists(sql: string): string[][] {
  return [...sql.matchAll(/n\.nspname IN \(([^)]*)\)/g)].map((m) =>
    [...m[1].matchAll(/'([^']+)'/g)].map((s) => s[1]).sort()
  )
}

function secretPatterns(sql: string): string[] {
  return [...sql.matchAll(/a\.attname ~\* '([^']+)'/g)].map((m) => m[1])
}

function allowlist(sql: string): string[] {
  return [
    ...sql.matchAll(
      /AND NOT \(\((n\.nspname[^\n]*)\n\s*(AND CASE [^\n]*? END\))/g
    )
  ].map((m) => `${m[1]} ${m[2]}`)
}

describe('exposed-schema credential census', () => {
  it('covers exactly the schemas PostgREST serves, in both copies', () => {
    const expected = exposedSchemas()
    for (const [name, sql] of [
      ['pgTAP suite', suite],
      ['live census', census]
    ] as const) {
      const lists = schemaLists(sql)
      expect(lists.length, `${name} schema filters`).toBe(2)
      for (const list of lists) expect(list, name).toEqual(expected)
    }
  })

  it('uses one credential-column pattern and one allowlist in both copies', () => {
    expect(secretPatterns(suite)).toHaveLength(1)
    expect(secretPatterns(census)).toEqual(secretPatterns(suite))
    expect(allowlist(suite)).toHaveLength(1)
    expect(allowlist(census)).toEqual(allowlist(suite))
  })

  it('matches credential column names and ignores look-alike metadata', () => {
    const pattern = new RegExp(secretPatterns(suite)[0], 'i')
    for (const name of [
      'client_secret',
      'session_id',
      'api_key_encrypted',
      'tacticus_api_key_encrypted',
      'refresh_token',
      'password',
      'webhook_url',
      'discord_webhook_url',
      'bomb_alert_webhook_url'
    ]) {
      expect(pattern.test(name), name).toBe(true)
    }
    for (const name of [
      'api_key_is_valid',
      'client_secret_uploaded_at',
      'primary_assignment_tokens',
      'next_token_seconds',
      'discord_webhook_enabled',
      'webhook_url_hash',
      'webhook_type'
    ]) {
      expect(pattern.test(name), name).toBe(false)
    }
  })
})
