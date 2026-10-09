import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = path.resolve(
  process.cwd(),
  'scripts/security/check-internal-ids.mjs'
)

// Built at runtime so this file itself carries no literal key.
const key = (prefix: string, n: number) => `${prefix}-${n}`
const slug = (prefix: string, n: number, rest: string) => `${prefix}${n}${rest}`

type Entry = { token?: string; file?: string; files?: string[]; why: string }

let repo = ''

function makeRepo(files: Record<string, string>, entries: Entry[]) {
  repo = mkdtempSync(path.join(tmpdir(), 'internal-ids-'))
  const all: Record<string, string> = {
    ...files,
    'config/internal-id-allow.json': JSON.stringify({
      frozenMigrations: { through: '20260101000000', why: 'applied history' },
      entries
    })
  }
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    writeFileSync(path.join(repo, file), text)
  }
  // Supply only tracked-file inventory at the external process boundary.
  // These scanner fixtures need no repository, credentials or Git mutation.
  const inventory = path.join(repo, 'fixture-inventory')
  writeFileSync(inventory, Object.keys(all).join('\0') + '\0')
  const bin = path.join(repo, 'fixture-bin')
  mkdirSync(bin)
  writeFileSync(
    path.join(bin, 'git'),
    `#!${process.execPath}\n` +
      `const fs = require('node:fs');\n` +
      `if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['ls-files', '-z'])) process.exit(64);\n` +
      `process.stdout.write(fs.readFileSync(${JSON.stringify(inventory)}));\n`,
    { mode: 0o700 }
  )
}

function guard(...args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: path.join(repo, 'fixture-bin') + path.delimiter + process.env.PATH
    }
  })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true })
  repo = ''
})

describe('internal-id guard', () => {
  it('passes its built-in controls', () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--selftest'], {
      encoding: 'utf8'
    })
    expect(out).toContain('controls passed')
  }, 60_000)

  it('passes a clean tree', () => {
    makeRepo({ 'app/a.ts': "export const a = 'guild sync lane'\n" }, [])
    const { status, out } = guard('--scan')
    expect(status).toBe(0)
    expect(out).toContain('Internal-ID scan passed')
  })

  it('fails on keys in strings, slugs in names and ticket-named paths', () => {
    makeRepo(
      {
        'app/a.ts': `logger.warn('${key('PS', 12)}: sync failed')\n`,
        'tests/b.test.ts': `const guild = '${slug('WI', 2570, 'A')}'\n`,
        [`tests/${slug('ps', 80, '-drain')}.test.ts`]: 'export {}\n'
      },
      []
    )
    const { status, out } = guard('--scan')
    expect(status).toBe(1)
    expect(out).toContain(`app/a.ts:1: key: "${key('PS', 12)}"`)
    expect(out).toContain(`tests/b.test.ts:1: slug: "${slug('WI', 2570, 'A')}"`)
    expect(out).toContain(`path: "${slug('ps', 80, '-drain')}"`)
  })

  it('leaves frozen migrations alone but checks later ones', () => {
    const frozen = `supabase/migrations/20250101000000_${slug('ps', 40, '_fix')}.sql`
    const later = 'supabase/migrations/20270101000000_later_fix.sql'
    makeRepo(
      {
        [frozen]: `-- ${key('PS', 40)}\n`,
        [later]: `-- ${key('PS', 41)}\n`,
        'tests/c.test.ts': `readMigration('${path.basename(frozen)}')\n`
      },
      []
    )
    const { status, out } = guard('--scan')
    expect(status).toBe(1)
    expect(out).toContain(`${later}:1: key`)
    expect(out).not.toContain(frozen)
    expect(out).not.toContain('tests/c.test.ts')
  })

  it('honours scoped entries and rejects stale ones on a full scan only', () => {
    const live = slug('wi', 3136, '_cluster_leaders_update')
    makeRepo({ 'app/policy.ts': `// mirrors the ${live} policy\n` }, [
      { token: live, files: ['app/policy.ts'], why: 'live policy name' },
      { token: 'gone', why: 'no longer referenced' }
    ])
    const full = guard('--scan')
    expect(full.status).toBe(1)
    expect(full.out).toContain('entries[1] (gone) matches nothing')
    expect(full.out).not.toContain('app/policy.ts')
    const staged = guard('--files', 'app/policy.ts')
    expect(staged.status).toBe(0)
  })

  it('refuses a malformed allowlist', () => {
    makeRepo({ 'app/a.ts': 'export {}\n' }, [
      { token: 'x', file: 'y', why: 'both' }
    ])
    const { status, out } = guard('--scan')
    expect(status).not.toBe(0)
    expect(out).toContain('exactly one of "token" or "file"')
  })
})
