/** The script runs as a child process against miniature repos so the real exit code is asserted. */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SCRIPT = path.resolve(
  __dirname,
  '../../../scripts/validation/check-handler-coverage.mjs'
)
const REPO_ROOT = path.resolve(__dirname, '../../..')

let fixtureRoot: string

function write(relPath: string, contents: string): void {
  const full = path.join(fixtureRoot, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, contents)
}

function run(
  root: string,
  extraArgs: string[] = []
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      '--root',
      root,
      '--out-dir',
      path.join(fixtureRoot, '.artifacts'),
      ...extraArgs
    ],
    { encoding: 'utf8' }
  )
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

function writeCoveredFixture(): void {
  write(
    'app/api/worker/hooks/route.ts',
    `import { runWorkerTick } from '@/app/lib/jobs/worker-tick'\n` +
      `import '@/app/lib/jobs/register-hooks-handlers'\n` +
      `export async function POST() {\n  return runWorkerTick()\n}\n`
  )
  write(
    'app/lib/jobs/register-hooks-handlers.ts',
    `import { registerAlphaHandler } from './alpha'\n` +
      `import { registerBetaHandler } from './beta'\n\n` +
      `registerAlphaHandler()\nregisterBetaHandler()\n\nexport {}\n`
  )
  write(
    'app/lib/jobs/alpha.ts',
    `import { registerJobHandler } from './dispatcher'\n\n` +
      `const alphaHandler = async () => ({ status: 'ok' })\n\n` +
      `export function registerAlphaHandler(): void {\n` +
      `  registerJobHandler('alpha-job', alphaHandler)\n}\n`
  )
  write('app/lib/constants.ts', `export const BETA_JOB_TYPE = 'beta-job'\n`)
  write(
    'app/lib/jobs/beta.ts',
    `import { registerJobHandler } from './dispatcher'\n` +
      `import { BETA_JOB_TYPE } from '@/app/lib/constants'\n\n` +
      `const betaHandler = async () => ({ status: 'ok' })\n\n` +
      `export function registerBetaHandler(): void {\n` +
      `  registerJobHandler(BETA_JOB_TYPE, betaHandler)\n}\n`
  )
  write(
    'supabase/migrations/20260101000000_enqueue_alpha.sql',
    `-- INSERT INTO public.work_queue (job_type) VALUES ('commented-out-job')\n` +
      `CREATE FUNCTION public.enqueue_alpha() RETURNS void AS $$\n` +
      `BEGIN\n` +
      `  INSERT INTO public.work_queue (job_type, job_class, payload)\n` +
      `  VALUES ('alpha-job', 'hook', '{}'::jsonb);\n` +
      `END;\n$$ LANGUAGE plpgsql;\n`
  )
  write(
    'app/api/onboarding/route.ts',
    `export async function POST() {\n` +
      `  await client.rpc('enqueue_sync', { p_job_type: 'full_sync' })\n` +
      `  await client.from('onboarding_jobs').insert({ job_type: 'guild_initial_sync' })\n` +
      `  await client.mutate('work_queue', 'POST', {\n` +
      `    job_type: 'beta-job',\n` +
      `    job_class: 'hook'\n` +
      `  })\n}\n`
  )
  writeBaseline(['alpha-job', 'beta-job'])
}

function writeBaseline(jobTypes: string[]): void {
  write(
    'scripts/validation/handler-coverage.baseline.json',
    `${JSON.stringify(
      {
        refresh: { last_refreshed_from_database: '2026-09-19' },
        job_types: jobTypes.map((job_type) => ({ job_type, count: 10 }))
      },
      null,
      2
    )}\n`
  )
}

beforeEach(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ps79-coverage-'))
})

afterEach(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
})

describe('check-handler-coverage', () => {
  it('exits 0 when every produced job_type has a registered handler', () => {
    writeCoveredFixture()
    const { status, stdout } = run(fixtureRoot)
    expect(stdout).toContain('OK: every produced job_type has a registered')
    expect(status).toBe(0)
  })

  it('enumerates handlers from the real wiring, not from a hand-kept list', () => {
    writeCoveredFixture()
    const { stdout } = run(fixtureRoot, ['--json'])
    const report = JSON.parse(stdout)
    expect(report.handlers.map((h: { jobType: string }) => h.jobType)).toEqual([
      'alpha-job',
      'beta-job'
    ])
    const produced = report.produced.map((p: { jobType: string }) => p.jobType)
    expect(produced).toEqual(['alpha-job', 'beta-job'])
  })

  it('writes a handlers.txt artifact the operator can diff against the queue', () => {
    writeCoveredFixture()
    run(fixtureRoot)
    const artifact = fs.readFileSync(
      path.join(fixtureRoot, '.artifacts', 'handlers.txt'),
      'utf8'
    )
    expect(artifact).toBe('alpha-job\nbeta-job\n')
  })

  it('fails and names the job_type when a PRODUCER has no handler', () => {
    writeCoveredFixture()
    write(
      'supabase/migrations/20260102000000_enqueue_gamma.sql',
      `INSERT INTO work_queue (job_type, job_class) VALUES ('gamma-job', 'batch');\n`
    )
    const { status, stdout } = run(fixtureRoot)
    expect(status).toBe(1)
    expect(stdout).toContain('produced job_type(s) have NO registered handler')
    expect(stdout).toContain('gamma-job')
    expect(stdout).toContain('20260102000000_enqueue_gamma.sql')
  })

  it('fails and names the job_type when a BASELINE entry has no handler', () => {
    writeCoveredFixture()
    writeBaseline(['alpha-job', 'beta-job', 'delta-job'])
    const { status, stdout } = run(fixtureRoot)
    expect(status).toBe(1)
    expect(stdout).toContain('delta-job  produced by: baseline')
  })

  it('NEGATIVE CONTROL: dropping one handler from the dispatch map fails the roll', () => {
    writeCoveredFixture()
    write(
      'app/lib/jobs/register-hooks-handlers.ts',
      `import { registerAlphaHandler } from './alpha'\n\n` +
        `registerAlphaHandler()\n\nexport {}\n`
    )
    const { status, stdout } = run(fixtureRoot)
    expect(status).toBe(1)
    expect(stdout).toContain('beta-job')
    expect(stdout).toContain('FAILED: do not roll this image.')
  })

  it('warns (but does not fail) on a handler nothing produces', () => {
    writeCoveredFixture()
    writeBaseline(['alpha-job'])
    write('app/api/onboarding/route.ts', `export async function POST() {}\n`)
    const { status, stdout } = run(fixtureRoot)
    expect(status).toBe(0)
    expect(stdout).toContain('registered handler(s) no known producer enqueues')
    expect(stdout).toContain('beta-job')
  })

  it('fails closed when a registration argument is not statically resolvable', () => {
    writeCoveredFixture()
    write(
      'app/lib/jobs/beta.ts',
      `import { registerJobHandler } from './dispatcher'\n\n` +
        `export function registerBetaHandler(): void {\n` +
        `  registerJobHandler(computeJobType(), betaHandler)\n}\n`
    )
    const { status, stdout } = run(fixtureRoot)
    expect(status).toBe(1)
    expect(stdout).toContain('not statically resolvable')
  })

  it('fails closed when the baseline is missing', () => {
    writeCoveredFixture()
    fs.rmSync(
      path.join(
        fixtureRoot,
        'scripts/validation/handler-coverage.baseline.json'
      )
    )
    const { status, stdout } = run(fixtureRoot)
    expect(status).toBe(1)
    expect(stdout).toContain('is missing')
  })

  it('passes against this repository as it stands', () => {
    const { status, stdout } = run(REPO_ROOT)
    expect(stdout).toContain('OK: every produced job_type has a registered')
    expect(status).toBe(0)
  })
})
