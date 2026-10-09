import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = path.resolve('scripts/dev/lib/replay-migrations.sh')
const READER = '20261007210000_rest_reader_role.sql'
const SOURCE = path.resolve('supabase/migrations', READER)
const FOLLOWUP = '20990101000000_synthetic_followup.sql'
const fixtures: string[] = []
type Options = {
  readerRole?: string
  postgresSuperuser?: boolean
  probeFailure?: boolean
  readerFailure?: boolean
  followupFailure?: boolean
}
type Event = {
  kind: string
  file?: string
  role?: string
  sha256?: string
  query?: string
}

// A CLI transport stand-in, not a PostgreSQL evaluator. It models the measured
// role refusal and records which unchanged SQL file the real shell dispatches.
const DOCKER = String.raw`
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const options = JSON.parse(fs.readFileSync(process.env.SYNTHETIC_REPLAY_OPTIONS, 'utf8'));
const events = process.env.SYNTHETIC_REPLAY_EVENTS;
function emit(value) { fs.appendFileSync(events, JSON.stringify(value) + '\n'); }
const args = process.argv.slice(2);
if (args[0] === 'cp') process.exit(0);
if (args[0] !== 'exec') process.exit(90);
let i = args[1] === '-i' ? 2 : 1;
if (args[i++] !== 'synthetic-container') process.exit(91);
if (args[i] === 'mkdir') process.exit(0);
if (args[i++] !== 'psql') process.exit(92);
const rest = args.slice(i), value = flag => rest[rest.indexOf(flag) + 1];
const role = value('-U');
if (rest.includes('-c')) {
  const query = value('-c');
  if (query.includes('SELECT CASE') && query.includes('to_regnamespace')) {
    process.stdout.write('supabase_admin\n'); process.exit(0);
  }
  if (query.includes('SELECT CASE') && query.includes('rolsuper')) {
    emit({ kind: 'reader-role-probe' });
    if (options.probeFailure) process.exit(1);
    process.stdout.write((options.readerRole ?? (options.postgresSuperuser ? 'postgres' : 'supabase_admin')) + '\n');
    process.exit(0);
  }
  if (query.includes('INSERT INTO supabase_migrations')) emit({ kind: 'ledger', query });
  process.exit(0);
}
if (rest.includes('-f')) {
  const file = path.basename(value('-f'));
  const source = path.join(process.env.SYNTHETIC_REPLAY_REPO, 'supabase/migrations', file);
  emit({ kind: 'migration', file, role,
    sha256: fs.existsSync(source) ? crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex') : null });
  if (file === '${READER}' && (options.readerFailure || (role !== 'supabase_admin' && !(role === 'postgres' && options.postgresSuperuser)))) {
    process.stderr.write('permission denied to alter role\n'); process.exit(1);
  }
  if (file === '${FOLLOWUP}' && options.followupFailure) process.exit(1);
  process.exit(0);
}
process.stdin.resume();
`

function replay(options: Options = {}) {
  const repo = mkdtempSync(path.join(tmpdir(), 'synthetic-replay-'))
  fixtures.push(repo)
  mkdirSync(path.join(repo, 'supabase/migrations'), { recursive: true })
  mkdirSync(path.join(repo, 'scripts/dev/lib'), { recursive: true })
  mkdirSync(path.join(repo, 'bin'))
  copyFileSync(SOURCE, path.join(repo, 'supabase/migrations', READER))
  writeFileSync(
    path.join(repo, 'supabase/migrations', '20260813000000_clean_baseline.sql'),
    '-- synthetic baseline\n'
  )
  writeFileSync(
    path.join(repo, 'supabase/migrations', FOLLOWUP),
    '-- synthetic followup\n'
  )
  writeFileSync(path.join(repo, 'scripts/dev/lib/replay-unappliable.txt'), '')
  const docker = path.join(repo, 'bin/docker')
  writeFileSync(
    docker,
    '#!/bin/sh\nexec "$SYNTHETIC_REPLAY_NODE" "$SYNTHETIC_REPLAY_DOCKER" "$@"\n'
  )
  chmodSync(docker, 0o700)
  writeFileSync(path.join(repo, 'docker.cjs'), DOCKER)
  writeFileSync(path.join(repo, 'options.json'), JSON.stringify(options))
  const eventPath = path.join(repo, 'events.jsonl')
  writeFileSync(eventPath, '')
  const result = spawnSync(
    'bash',
    [
      '-c',
      'source "$1"; replay_migrations synthetic-container "$2" /synthetic-replay',
      'synthetic-replay',
      SCRIPT,
      repo
    ],
    {
      cwd: repo,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${path.join(repo, 'bin')}:${process.env.PATH}`,
        SYNTHETIC_REPLAY_NODE: process.execPath,
        SYNTHETIC_REPLAY_DOCKER: path.join(repo, 'docker.cjs'),
        SYNTHETIC_REPLAY_OPTIONS: path.join(repo, 'options.json'),
        SYNTHETIC_REPLAY_EVENTS: eventPath,
        SYNTHETIC_REPLAY_REPO: repo
      }
    }
  )
  const events = readFileSync(eventPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Event)
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    events
  }
}

afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture, { recursive: true, force: true })
})

describe('disposable migration replay authority', () => {
  it('applies the exact reader migration with verified disposable superuser, leaving other migrations as postgres', () => {
    const result = replay()
    expect(
      result.events.find((e) => e.kind === 'migration' && e.file === READER)
        ?.role
    ).toBe('supabase_admin')
    expect(result.status).toBe(0)
    expect(
      result.events.find((e) => e.kind === 'migration' && e.file === READER)
    ).toEqual({
      kind: 'migration',
      file: READER,
      role: 'supabase_admin',
      sha256: createHash('sha256').update(readFileSync(SOURCE)).digest('hex')
    })
    expect(
      result.events.find((e) => e.kind === 'migration' && e.file === FOLLOWUP)
        ?.role
    ).toBe('postgres')
    expect(
      result.events.some(
        (e) => e.kind === 'ledger' && e.query?.includes('20261007210000')
      )
    ).toBe(true)
    expect(result.output).not.toContain('NOT APPLIED (UNEXPECTED)')
  })
  it('uses postgres only when the catalog confirms postgres is a superuser', () => {
    const result = replay({ postgresSuperuser: true })
    expect(result.status).toBe(0)
    expect(
      result.events.find((e) => e.kind === 'migration' && e.file === READER)
        ?.role
    ).toBe('postgres')
    expect(
      result.events.filter((e) => e.kind === 'reader-role-probe')
    ).toHaveLength(1)
  })
  it.each(['', 'synthetic_foreign_admin'])(
    'refuses absent or unexpected superuser result %j before applying reader SQL',
    (readerRole) => {
      const result = replay({ readerRole })
      expect(result.status).toBe(1)
      expect(result.output).toContain(
        'no verified disposable superuser for the reader-role migration'
      )
      expect(
        result.events.some((e) => e.kind === 'migration' && e.file === READER)
      ).toBe(false)
      expect(
        result.events.some(
          (e) => e.kind === 'ledger' && e.query?.includes('20261007210000')
        )
      ).toBe(false)
    }
  )
  it('refuses a failed catalog probe instead of falling back to postgres', () => {
    const result = replay({ probeFailure: true })
    expect(result.status).toBe(1)
    expect(result.output).toContain(
      'could not verify a disposable superuser for the reader-role migration'
    )
    expect(
      result.events.some((e) => e.kind === 'migration' && e.file === READER)
    ).toBe(false)
  })
  it('still refuses failed reader-role SQL without registering it as applied or allowed', () => {
    const result = replay({ readerFailure: true })
    expect(result.status).toBe(1)
    expect(result.output).toContain(`NOT APPLIED (UNEXPECTED) ${READER}`)
    expect(result.output).toContain(
      'the schema this lane seeded is therefore incomplete'.replace(
        'the',
        'The'
      )
    )
    expect(
      result.events.some(
        (e) => e.kind === 'ledger' && e.query?.includes('20261007210000')
      )
    ).toBe(false)
  })
  it('preserves strict unknown-migration refusal and postgres dispatch for every other migration', () => {
    const result = replay({ followupFailure: true })
    expect(result.status).toBe(1)
    expect(result.output).toContain(`NOT APPLIED (UNEXPECTED) ${FOLLOWUP}`)
    expect(
      result.events.find((e) => e.kind === 'migration' && e.file === FOLLOWUP)
        ?.role
    ).toBe('postgres')
    expect(
      result.events.some(
        (e) => e.kind === 'ledger' && e.query?.includes('20261007210000')
      )
    ).toBe(true)
    expect(
      result.events.some(
        (e) => e.kind === 'ledger' && e.query?.includes('20990101000000')
      )
    ).toBe(false)
  })
})
