import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The pin PR must reach main without a human, so it is opened as the pin-stamp App and
// queued to auto-merge; any gh failure fails the step instead of leaving an orphan branch.

const scriptPath = 'scripts/ci/stamp-pin-open-pr.sh'
const workflowPath = '.github/workflows/build-edge-runtime-image.yml'
const read = (path: string) => readFileSync(path, 'utf8')

const PR_URL = 'https://github.com/thetimmyman/tacticus-analytics/pull/999'
const BRANCH = 'ci/stamp-tacticus-pin-abc12345'

type Stub = { list?: string; create?: string; merge?: string }

// Each subcommand's stub body; the stub logs its argv so a test can assert what was called.
function withStubGh(stub: Stub, run: (dir: string, log: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'stamp-pin-stub-gh-'))
  const log = join(dir, 'gh.log')
  const script = [
    '#!/usr/bin/env bash',
    `echo "$*" >> "${log}"`,
    'case "$1 $2" in',
    `  "pr list") ${stub.list ?? 'exit 0'} ;;`,
    `  "pr create") ${stub.create ?? `echo "${PR_URL}"`} ;;`,
    `  "pr merge") ${stub.merge ?? 'exit 0'} ;;`,
    '  *) echo "unexpected gh call: $*" >&2; exit 9 ;;',
    'esac',
    ''
  ].join('\n')
  try {
    writeFileSync(join(dir, 'gh'), script)
    chmodSync(join(dir, 'gh'), 0o755)
    run(dir, log)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function runScript(stubDir: string, extraEnv: Record<string, string> = {}) {
  return execFileSync(scriptPath, [], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      BRANCH,
      PR_TITLE: 'chore(deploy): stamp tacticus edge pin at abc12345',
      PR_BODY: 'Automated pin stamp for namespace tacticus from this build.',
      GITHUB_REPOSITORY: 'thetimmyman/tacticus-analytics',
      GH_TOKEN: 'not-a-real-token',
      ...extraEnv
    }
  })
}

function runExpectingFailure(stubDir: string) {
  try {
    runScript(stubDir)
  } catch (error) {
    const typed = error as { status?: number; stdout?: string; stderr?: string }
    return {
      status: typed.status,
      stdout: String(typed.stdout ?? ''),
      stderr: String(typed.stderr ?? '')
    }
  }
  throw new Error('expected stamp-pin-open-pr.sh to fail')
}

describe('stamp-pin-open-pr.sh', () => {
  it('opens the PR and queues a squash auto-merge on it', () => {
    withStubGh({}, (dir, log) => {
      const summaryPath = join(dir, 'summary.md')
      writeFileSync(summaryPath, '')
      const output = runScript(dir, { GITHUB_STEP_SUMMARY: summaryPath })

      expect(output).toContain(`PR: ${PR_URL}`)
      expect(output).toContain('Auto-merge (squash) queued')
      const calls = read(log)
      expect(calls).toContain(`pr create --repo thetimmyman/tacticus-analytics`)
      expect(calls).toContain(`--head ${BRANCH}`)
      expect(calls).toContain(
        `pr merge ${PR_URL} --repo thetimmyman/tacticus-analytics --auto --squash`
      )
      expect(read(summaryPath)).toContain(PR_URL)
    })
  })

  it('reuses an open PR for the same branch instead of creating a second one', () => {
    withStubGh({ list: `echo "${PR_URL}"`, create: 'exit 42' }, (dir, log) => {
      const output = runScript(dir)
      expect(output).toContain(`PR: ${PR_URL}`)
      expect(read(log)).not.toContain('pr create')
      expect(read(log)).toContain(`pr merge ${PR_URL}`)
    })
  })

  it('fails when the PR cannot be created, e.g. the GITHUB_TOKEN refusal', () => {
    withStubGh(
      {
        create:
          'echo "pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests" >&2; exit 1'
      },
      (dir, log) => {
        const result = runExpectingFailure(dir)
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('not permitted')
        expect(read(log)).not.toContain('pr merge')
      }
    )
  })

  it('fails loudly when auto-merge cannot be queued', () => {
    withStubGh(
      {
        merge:
          'echo "GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)" >&2; exit 1'
      },
      (dir) => {
        const result = runExpectingFailure(dir)
        expect(result.status).not.toBe(0)
        expect(result.stdout).toContain('::error::')
        expect(result.stdout).toContain('will not reach main on its own')
        expect(result.stderr).toContain('Auto merge is not allowed')
      }
    )
  })
})

describe('build-edge-runtime-image.yml stamp-pin job', () => {
  const workflow = read(workflowPath)
  const stampJob = workflow.slice(workflow.indexOf('  stamp-pin:'))

  it('keeps the "Pin already up to date" short-circuit and delegates the PR to the script', () => {
    expect(stampJob).toContain(
      'if git diff --quiet -- deploy/tacticus.pin.json; then'
    )
    expect(stampJob).toContain(
      'echo "Pin already up to date at $commit; nothing to do."'
    )
    expect(stampJob).toContain('scripts/ci/stamp-pin-open-pr.sh')
  })

  it('pushes and opens the PR with the pin-stamp App token, never GITHUB_TOKEN', () => {
    expect(stampJob).toMatch(
      /uses: actions\/create-github-app-token@[0-9a-f]{40} # v\d/
    )
    expect(stampJob).toContain('client-id: ${{ vars.PIN_STAMP_APP_CLIENT_ID }}')
    expect(stampJob).toContain(
      'private-key: ${{ secrets.PIN_STAMP_APP_PRIVATE_KEY }}'
    )
    expect(stampJob).toContain('token: ${{ steps.app-token.outputs.token }}')
    expect(stampJob).toContain('GH_TOKEN: ${{ steps.app-token.outputs.token }}')
    expect(stampJob).not.toContain('github.token')
    expect(stampJob).not.toContain('secrets.GITHUB_TOKEN')
    expect(stampJob).not.toContain('STAMP_PIN_TOKEN')
  })

  it('keeps the job GITHUB_TOKEN read-only', () => {
    const permissions = stampJob.slice(
      stampJob.indexOf('permissions:'),
      stampJob.indexOf('needs:')
    )
    expect(permissions).toContain('contents: read')
    expect(permissions).not.toContain('write')
  })

  it('commits as the App bot noreply identity and names no ticket in the commit or PR title', () => {
    expect(stampJob).toContain(
      'git config user.email "${bot_id}+${APP_SLUG}[bot]@users.noreply.github.com"'
    )
    expect(stampJob).toContain(
      'git commit -m "chore(deploy): stamp tacticus edge pin at ${TAG}"'
    )
    expect(stampJob).toContain(
      'PR_TITLE="chore(deploy): stamp tacticus edge pin at ${TAG}"'
    )
    expect(workflow).not.toMatch(/\b(PS|WI)-\d+/)
  })
})
