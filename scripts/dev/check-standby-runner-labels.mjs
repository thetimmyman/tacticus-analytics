#!/usr/bin/env node
// Tripwire: fails if any job's `runs-on` could land on the standby self-hosted
// runner (eligible iff job labels ⊆ runner labels). Unparseable dynamic
// runs-on fails closed. Usage: --census | --scan | --selftest

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows')
const ALLOWLIST_PATH = path.join(
  ROOT,
  'config',
  'runner-standby-allowlist.json'
)

// The standby runner's registered labels; change only after re-probing its registration.
export const STANDBY_RUNNER_LABELS = [
  'self-hosted',
  'linux',
  'x64',
  'cheap',
  'x64-heavy',
  'minipc'
]
const STANDBY_LABEL_SET = new Set(
  STANDBY_RUNNER_LABELS.map((l) => l.toLowerCase())
)

// Case-insensitive: a case-only mismatch must not read as "safe".
export function jobMatchesStandby(labels) {
  if (labels.length === 0) return false
  return labels.every((label) => STANDBY_LABEL_SET.has(label.toLowerCase()))
}

function splitTopLevel(text, token) {
  const parts = []
  let depth = 0
  let quote = null
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (depth === 0 && text.startsWith(token, i)) {
      parts.push(text.slice(start, i))
      start = i + token.length
      i += token.length - 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

function parseBranchValue(raw) {
  const value = raw.trim()
  const fromJson = value.match(/^fromJSON\(\s*'(\[[^']*\])'\s*\)$/u)
  if (fromJson) {
    try {
      const parsed = JSON.parse(fromJson[1])
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
        return parsed
      }
    } catch {
      return null
    }
    return null
  }
  const literal = value.match(/^'([^']*)'$/u)
  if (literal) return [literal[1]]
  return null
}

/** Resolves a `cond && A || B` runs-on to its label-array branches; null otherwise (caller fails closed). */
export function resolveExpressionBranches(expr) {
  const inner = expr.trim()

  const direct = parseBranchValue(inner)
  if (direct) return [direct]

  const orParts = splitTopLevel(inner, '||')
  if (orParts.length !== 2) return null
  const [condAndTrue, falseBranch] = orParts

  const andParts = splitTopLevel(condAndTrue, '&&')
  if (andParts.length < 2) return null
  const trueBranch = andParts[andParts.length - 1]

  const trueLabels = parseBranchValue(trueBranch)
  const falseLabels = parseBranchValue(falseBranch)
  if (!trueLabels || !falseLabels) return null
  return [trueLabels, falseLabels]
}

/** Parse one `runs-on:` value into label-array branches, or null if unclassifiable. */
export function parseRunsOnScalar(value) {
  const trimmed = value.trim()

  const exprMatch = trimmed.match(/^\$\{\{([\s\S]*)\}\}$/u)
  if (exprMatch) {
    return resolveExpressionBranches(exprMatch[1])
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inside = trimmed.slice(1, -1).trim()
    if (inside === '') return [[]]
    const labels = inside
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/gu, ''))
    return [labels]
  }

  const bare = trimmed.replace(/^['"]|['"]$/gu, '')
  return [[bare]]
}

/** Line-based parse; relies on job ids sitting two spaces under `jobs:`. */
export function parseWorkflowJobs(source) {
  const lines = source.split(/\r?\n/)
  const jobsIndex = lines.findIndex((l) => /^jobs:\s*$/u.test(l))
  if (jobsIndex === -1) return []

  const jobs = []
  let current = null

  const indentOf = (line) => line.match(/^(\s*)/u)[1].length
  const isBlankOrComment = (line) => /^\s*(#.*)?$/u.test(line)

  for (let i = jobsIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (isBlankOrComment(line)) continue
    const indent = indentOf(line)
    if (indent === 0) break // next top-level key ends the jobs block

    const jobIdMatch =
      indent === 2 && line.match(/^\s{2}([A-Za-z0-9_.-]+):\s*(#.*)?$/u)
    if (jobIdMatch) {
      current = { id: jobIdMatch[1], runsOnLine: null, runsOnValue: null }
      jobs.push(current)
      continue
    }
    if (!current) continue

    const runsOnMatch = line.match(/^\s{4}runs-on:\s*(.*)$/u)
    if (runsOnMatch && current.runsOnLine === null) {
      current.runsOnLine = i + 1
      const rest = runsOnMatch[1].replace(/\s*#.*$/u, '').trim()
      if (rest !== '') {
        current.runsOnValue = rest
        continue
      }
      // Block sequence form (`runs-on:` then `- label` lines).
      const seqLabels = []
      let j = i + 1
      while (j < lines.length) {
        const seqLine = lines[j]
        if (isBlankOrComment(seqLine)) {
          j += 1
          continue
        }
        const seqMatch = seqLine.match(/^\s{4,}-\s*(.+)$/u)
        if (!seqMatch) break
        seqLabels.push(seqMatch[1].trim().replace(/^['"]|['"]$/gu, ''))
        j += 1
      }
      current.runsOnValue = `[${seqLabels.join(', ')}]`
    }
  }

  return jobs
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return []
  const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'))
  if (!Array.isArray(parsed.entries)) {
    throw new Error(
      `${path.relative(ROOT, ALLOWLIST_PATH)} is malformed: expected an { entries: [...] } object`
    )
  }
  for (const entry of parsed.entries) {
    if (!entry.workflow || !entry.job || !entry.reason) {
      throw new Error(
        `${path.relative(ROOT, ALLOWLIST_PATH)}: every entry needs workflow, job and reason — got ${JSON.stringify(entry)}`
      )
    }
  }
  return parsed.entries
}

function isAllowlisted(allowlist, workflow, job) {
  return allowlist.find((e) => e.workflow === workflow && e.job === job) ?? null
}

function listWorkflowFiles() {
  if (!fs.existsSync(WORKFLOWS_DIR)) return []
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
}

/** Every job and its branches, matched before the allowlist so the census shows raw reality. */
export function census(workflowsDir = WORKFLOWS_DIR) {
  const rows = []
  const files = fs.existsSync(workflowsDir)
    ? fs
        .readdirSync(workflowsDir)
        .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
        .sort()
    : []

  for (const file of files) {
    const source = fs.readFileSync(path.join(workflowsDir, file), 'utf8')
    for (const job of parseWorkflowJobs(source)) {
      if (job.runsOnValue === null) {
        rows.push({
          workflow: file,
          job: job.id,
          line: job.runsOnLine,
          raw: null,
          branches: null,
          unparsed: true,
          matches: true // fail closed: no runs-on found under a job is suspicious, treat as needing review
        })
        continue
      }
      const branches = parseRunsOnScalar(job.runsOnValue)
      const unparsed = branches === null
      const matches = unparsed
        ? true // fail closed
        : branches.some((labels) => jobMatchesStandby(labels))
      rows.push({
        workflow: file,
        job: job.id,
        line: job.runsOnLine,
        raw: job.runsOnValue,
        branches,
        unparsed,
        matches
      })
    }
  }
  return rows
}

export function violations(rows, allowlist) {
  const problems = []
  for (const row of rows) {
    if (!row.matches) continue
    const allowed = isAllowlisted(allowlist, row.workflow, row.job)
    if (allowed) continue
    if (row.unparsed) {
      problems.push(
        `${row.workflow}:${row.line} job '${row.job}': runs-on '${row.raw ?? '(none)'}' could not be classified — ` +
          `rewrite it into a recognised shape or add a config/runner-standby-allowlist.json entry with a reason`
      )
    } else {
      const branchDesc = row.branches
        .map((b) => `[${b.join(', ')}]`)
        .join(' or ')
      problems.push(
        `${row.workflow}:${row.line} job '${row.job}': runs-on ${branchDesc} is a subset of minipc-runner's labels ` +
          `(${STANDBY_RUNNER_LABELS.join(', ')}) — this job would schedule onto the standby runner`
      )
    }
  }
  return problems
}

function formatTable(rows) {
  const lines = []
  const width = Math.max(...rows.map((r) => `${r.workflow}:${r.job}`.length), 4)
  lines.push(`${'workflow:job'.padEnd(width)}  standby-match  runs-on`)
  lines.push('-'.repeat(width + 40))
  for (const row of rows) {
    const desc = row.unparsed
      ? `UNPARSED(${row.raw ?? 'none'})`
      : row.branches.map((b) => `[${b.join(',')}]`).join(' | ')
    lines.push(
      `${`${row.workflow}:${row.job}`.padEnd(width)}  ${(row.matches ? 'YES' : 'no').padEnd(13)}  ${desc}`
    )
  }
  return lines.join('\n')
}

function selftest() {
  const checks = []

  checks.push([
    'positive control: [self-hosted, amd64-builder] does not match standby',
    () => jobMatchesStandby(['self-hosted', 'amd64-builder']) === false
  ])
  checks.push([
    'negative control: [self-hosted, cheap] matches standby',
    () => jobMatchesStandby(['self-hosted', 'cheap']) === true
  ])
  checks.push([
    'x64-heavy alone matches standby',
    () => jobMatchesStandby(['self-hosted', 'x64-heavy']) === true
  ])
  checks.push([
    'minipc label alone matches standby',
    () => jobMatchesStandby(['minipc']) === true
  ])
  checks.push([
    'bare self-hosted (no arch label) matches standby',
    () => jobMatchesStandby(['self-hosted']) === true
  ])
  checks.push([
    'arm64-builder does not match standby',
    () => jobMatchesStandby(['self-hosted', 'arm64-builder']) === false
  ])
  checks.push([
    'case-insensitive match (X64-HEAVY)',
    () => jobMatchesStandby(['self-hosted', 'X64-HEAVY']) === true
  ])
  checks.push([
    'empty label set never matches',
    () => jobMatchesStandby([]) === false
  ])

  checks.push([
    'parseRunsOnScalar: bracket array',
    () =>
      JSON.stringify(parseRunsOnScalar('[self-hosted, amd64-builder]')) ===
      JSON.stringify([['self-hosted', 'amd64-builder']])
  ])
  checks.push([
    'parseRunsOnScalar: bare scalar',
    () =>
      JSON.stringify(parseRunsOnScalar('ubuntu-latest')) ===
      JSON.stringify([['ubuntu-latest']])
  ])

  const realExpr =
    "${{ (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository) && 'ubuntu-latest' || fromJSON('[\"self-hosted\",\"amd64-builder\"]') }}"
  checks.push([
    'dynamic ternary expression resolves to both real branches',
    () => {
      const branches = parseRunsOnScalar(realExpr)
      if (!branches) return false
      const asStrings = branches.map((b) => b.join(',')).sort()
      return (
        asStrings.length === 2 &&
        asStrings[0] === 'self-hosted,amd64-builder' &&
        asStrings[1] === 'ubuntu-latest'
      )
    }
  ])
  checks.push([
    'neither branch of the real dynamic expression matches standby',
    () => {
      const branches = parseRunsOnScalar(realExpr)
      return branches.every((labels) => jobMatchesStandby(labels) === false)
    }
  ])
  checks.push([
    'unclassifiable dynamic expression fails closed (returns null)',
    () => parseRunsOnScalar('${{ needs.plan.outputs.runner }}') === null
  ])

  const positiveFixture = [
    'name: fixture-positive',
    'on: push',
    'jobs:',
    '  build:',
    '    name: build',
    '    runs-on: [self-hosted, amd64-builder]',
    '    steps:',
    '      - run: echo ok'
  ].join('\n')
  const negativeFixture = [
    'name: fixture-negative',
    'on: push',
    'jobs:',
    '  build:',
    '    name: build',
    '    runs-on: [self-hosted, cheap]',
    '    steps:',
    '      - run: echo ok'
  ].join('\n')
  const dynamicFixture = [
    'name: fixture-dynamic',
    'on: push',
    'jobs:',
    '  gate:',
    '    name: gate',
    `    runs-on: ${realExpr.replace('${{ ', '${{').replace(' }}', '}}')}`,
    '    steps:',
    '      - run: echo ok'
  ].join('\n')
  const sequenceFixture = [
    'name: fixture-sequence',
    'on: push',
    'jobs:',
    '  build:',
    '    name: build',
    '    runs-on:',
    '      - self-hosted',
    '      - cheap',
    '    steps:',
    '      - run: echo ok'
  ].join('\n')

  function jobRow(source) {
    const jobs = parseWorkflowJobs(source)
    if (jobs.length !== 1)
      throw new Error(`expected exactly one job, got ${jobs.length}`)
    const job = jobs[0]
    const branches = parseRunsOnScalar(job.runsOnValue)
    return {
      matches: branches ? branches.some((l) => jobMatchesStandby(l)) : true,
      branches
    }
  }

  checks.push([
    'positive control fixture (amd64-builder): census sees it as no-match',
    () => jobRow(positiveFixture).matches === false
  ])
  checks.push([
    'negative control fixture ([self-hosted, cheap]): census sees it as a match',
    () => jobRow(negativeFixture).matches === true
  ])
  checks.push([
    'dynamic-expression fixture (real governance-baseline.yml idiom): no match',
    () => jobRow(dynamicFixture).matches === false
  ])
  checks.push([
    'block-sequence runs-on fixture ([self-hosted, cheap] as a YAML list): matches',
    () => jobRow(sequenceFixture).matches === true
  ])

  checks.push([
    'violations() flags an unallowlisted match',
    () => {
      const rows = [
        {
          workflow: 'f.yml',
          job: 'j',
          line: 5,
          raw: '[self-hosted, cheap]',
          branches: [['self-hosted', 'cheap']],
          unparsed: false,
          matches: true
        }
      ]
      return violations(rows, []).length === 1
    }
  ])
  checks.push([
    'violations() respects an allowlist entry with a reason',
    () => {
      const rows = [
        {
          workflow: 'f.yml',
          job: 'j',
          line: 5,
          raw: '[self-hosted, cheap]',
          branches: [['self-hosted', 'cheap']],
          unparsed: false,
          matches: true
        }
      ]
      const allowlist = [{ workflow: 'f.yml', job: 'j', reason: 'deliberate' }]
      return violations(rows, allowlist).length === 0
    }
  ])
  checks.push([
    'violations() flags an unparsed expression even without an allowlist entry',
    () => {
      const rows = [
        {
          workflow: 'f.yml',
          job: 'j',
          line: 5,
          raw: '${{ needs.plan.outputs.runner }}',
          branches: null,
          unparsed: true,
          matches: true
        }
      ]
      return violations(rows, []).length === 1
    }
  ])
  checks.push([
    'violations() passes a no-match row through untouched',
    () => {
      const rows = [
        {
          workflow: 'f.yml',
          job: 'j',
          line: 5,
          raw: '[self-hosted, amd64-builder]',
          branches: [['self-hosted', 'amd64-builder']],
          unparsed: false,
          matches: false
        }
      ]
      return violations(rows, []).length === 0
    }
  ])

  let failed = 0
  for (const [name, check] of checks) {
    let ok = false
    try {
      ok = check() === true
    } catch (error) {
      ok = false
      console.error(`  ${name}: threw ${error.message}`)
    }
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
    if (!ok) failed += 1
  }
  return failed === 0
}

function main() {
  const args = process.argv.slice(2)
  const wantCensus = args.includes('--census')
  const wantScan = args.includes('--scan')
  const wantSelftest = args.includes('--selftest')

  if (!wantCensus && !wantScan && !wantSelftest) {
    console.error(
      'usage: check-standby-runner-labels.mjs [--census] [--scan] [--selftest]'
    )
    process.exit(2)
  }

  if (wantSelftest && !selftest()) {
    process.exit(1)
  }

  if (wantCensus || wantScan) {
    const rows = census()
    if (wantCensus) console.log(formatTable(rows))
    if (wantScan) {
      const allowlist = loadAllowlist()
      const problems = violations(rows, allowlist)
      if (problems.length > 0) {
        console.error(
          "\nminipc-runner standby check failed — a job's runs-on would schedule onto the documented standby runner:"
        )
        for (const problem of problems) console.error(`  - ${problem}`)
        console.error(
          '\nSee docs/ci/runners.md#minipc-runner-standby. Either change the runs-on labels so they no ' +
            'longer subset minipc-runner (self-hosted, linux, x64, cheap, x64-heavy, minipc), or add a ' +
            'config/runner-standby-allowlist.json entry with a reason if this is intentional.'
        )
        process.exit(1)
      }
      console.log(
        `minipc-runner standby check OK: ${rows.length} job(s) scanned, none schedule onto the standby runner`
      )
    }
  }
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
