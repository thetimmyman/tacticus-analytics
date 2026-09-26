#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SELF = 'scripts/security/check-clean-repo.mjs'

const FORBIDDEN_ROOTS = [
  '.claude/',
  '.planning/',
  'agents/',
  'docs/archive/',
  'docs/architecture/',
  'docs/coverage/',
  'docs/database/',
  'docs/ops/',
  'docs/parity-program/',
  'docs/reports/',
  'docs/runbooks/',
  'docs/security/',
  'docs/shared/',
  'docs/work-items/',
  'k8s/',
  'scripts/backup/',
  'scripts/deploy/',
  'scripts/ops/',
  'scripts/testing/schema-baseline/',
  'supabase/baseline/',
  'public/images/boss-assignments/',
  'public/images/cluster-management/',
  'public/images/meta-analysis/',
  'public/images/performance-metrics/',
  'public/images/real-time-tracking/'
]

const FORBIDDEN_FILES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'scripts/dev/claude-ps',
  'scripts/dev/claude-wt',
  'scripts/dev/landmine-review.mjs',
  'scripts/dev/pgq.sh',
  'scripts/dev/premature-stop-review.mjs',
  'scripts/governance/check-wi-id-uniqueness.mjs',
  'scripts/lint-wi-status-vs-git.js',
  'scripts/lint-wi-status.js',
  'scripts/lint-work-item-identity.js',
  'docker/dozzle/users.yml',
  'docker/Dockerfile.prod.dockerignore',
  'supabase/function-index.json',
  'config/battle-sim-production-source.json',
  'config/battle-sim-canonical-release-contract.json'
])

const TOOLCHAIN_MARKERS = [
  /\bCpp2IL\b/iu,
  /\bIL2CPP\b/iu,
  /\bUnityPy\b/iu,
  /\bAssetRipper\b/iu,
  /\bGhidra\b/iu,
  /\bapktool\b/iu,
  /\bjadx\b/iu,
  /\bdnSpy\b/iu,
  /global-metadata\.dat/iu,
  /libil2cpp/iu
]

// Hashed tripwires for real identifiers that must never return: tokens are normalised and SHA-256
// compared, so this file does not carry the values.
const IDENTIFIER_TOKEN_LENGTHS = [32, 40]
const SEEN_CACHE_LIMIT = 100_000
const UUID_TOKEN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu
const HEX_RUN = /[0-9a-f]{32,}/giu

// Synthetic positive control; only the self-test may contain it.
const TRIPWIRE_SENTINEL = '00000000-0000-4000-8000-00000000c0de'

const HASHED_IDENTIFIER_MARKERS = new Map([
  [
    '7a8a14e899c90f1ae2f5a54a3710a88571048d81770a6031f27c17f0efe145da',
    'captured guild identifier'
  ],
  [
    '65d5afa385bd527ac6e1edbcc7686250dc11d29b2bb14bfada5c30d0e3027b44',
    'captured install identifier'
  ],
  [
    '25b0aafd6c22d330fb6fd9b94e6ff0e393abf7c5262cd74b884918063440e355',
    'captured device identifier'
  ],
  [
    'f3478014875be5487340d1439d414a666badec2d31777fad89269ca659dd029f',
    'captured guild identifier (fixture)'
  ],
  [
    'c0b4a96faa26e6012640f8f43cbbe18d6d9c48c458fdd74a955366131aff4314',
    'captured player account identifier'
  ],
  [
    '6439851d96b9317437e0ccb774c199bfa7a76a03a5674ab8fbd7d1b88977e738',
    'captured player account identifier (secondary)'
  ],
  [
    'c7222e3971edf5bb15dda3ed57c7cd005873cffe858a32ee9b499a56b5568205',
    'captured auth user identifier'
  ],
  [
    'c0f50e7a1874b9a7296080d808f054d77b67a2a0112da6132f19cda7e77d75cd',
    'clean-repo tripwire sentinel'
  ]
])

// Literal on purpose: no token grammar to hash against.
const SENSITIVE_MARKERS = [
  {
    pattern: /(?:MS-7B50|RTX 2080 Ti|i9-9900K)/iu,
    label: 'captured hardware fingerprint'
  },
  {
    pattern: /(?:\[EoT\]|《EoT》)/u,
    label: 'private guild alias'
  },
  {
    pattern: /(?:pi-k3s-8|10\.43\.0\.0\/16|app=patroni,role=primary)/iu,
    label: 'private deployment topology'
  }
]

/** Windows slide across each hex run so an embedded identifier still matches. */
export function findHashedIdentifiers(content) {
  const labels = new Set()
  const seen = new Set()

  const consider = (token) => {
    const normalised = token.toLowerCase().replace(/-/gu, '')
    if (seen.has(normalised)) return
    // Past the limit only the dedupe shortcut stops; capping coverage would hide ids at the end of a run.
    if (seen.size < SEEN_CACHE_LIMIT) seen.add(normalised)
    const label = HASHED_IDENTIFIER_MARKERS.get(
      createHash('sha256').update(normalised).digest('hex')
    )
    if (label) labels.add(label)
  }

  for (const [token] of content.matchAll(UUID_TOKEN)) consider(token)
  for (const [run] of content.matchAll(HEX_RUN)) {
    for (const length of IDENTIFIER_TOKEN_LENGTHS) {
      for (let start = 0; start + length <= run.length; start += 1) {
        consider(run.slice(start, start + length))
      }
    }
  }
  return [...labels]
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
    .split('\0')
    .filter(Boolean)
    .filter((file) => fs.existsSync(path.join(ROOT, file)))
}

function readText(relativePath) {
  const bytes = fs.readFileSync(path.join(ROOT, relativePath))
  if (bytes.includes(0)) return null
  return bytes.toString('utf8')
}

// Matches only the decisive comparison because YAML folding varies whitespace.
const FORK_GUARD =
  /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/u

export function findContentViolations(files) {
  const violations = []
  for (const [file, content] of Object.entries(files)) {
    if (file === SELF || content === null) continue

    for (const marker of TOOLCHAIN_MARKERS) {
      if (marker.test(content)) {
        violations.push(`${file}: reverse-engineering marker ${marker}`)
      }
    }
    for (const label of findHashedIdentifiers(content)) {
      violations.push(`${file}: ${label}`)
    }
    for (const { pattern, label } of SENSITIVE_MARKERS) {
      if (pattern.test(content)) {
        violations.push(`${file}: ${label}`)
      }
    }
    if (/\/home\/tdefreest(?:\/|\b)/u.test(content)) {
      violations.push(`${file}: operator home path`)
    }
    if (/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/u.test(content)) {
      violations.push(`${file}: committed bcrypt verifier`)
    }
    if (
      file.startsWith('.github/workflows/') &&
      /\bself-hosted\b/u.test(content) &&
      !FORK_GUARD.test(content)
    ) {
      violations.push(`${file}: self-hosted runner without a fork guard`)
    }
    if (
      /(?:import|from|require|COPY|ADD)[^\n]*modules\/battle-sim-engine/iu.test(
        content
      )
    ) {
      violations.push(`${file}: executable battle-sim engine dependency`)
    }
  }
  return violations
}

function fixtureViolations() {
  const fixturePath =
    'tests/boss-assignment-scenarios/guild-fixtures/iw-guild-34-members.json'
  const baselinePath = 'tests/boss-assignment-scenarios/baselines.json'
  const fixture = JSON.parse(readText(fixturePath))
  const baseline = JSON.parse(readText(baselinePath))
  const violations = []

  const members = Array.isArray(fixture.members) ? fixture.members : []
  if (members.length === 0) {
    violations.push(`${fixturePath}: expected synthetic members`)
  }
  members.forEach((member, index) => {
    const number = String(index + 1).padStart(2, '0')
    if (
      member.playerId !== `synthetic-player-${number}` ||
      member.displayName !== `Synthetic Player ${number}`
    ) {
      violations.push(`${fixturePath}: member ${index + 1} is not synthetic`)
    }
  })

  const baselineText = JSON.stringify(baseline)
  for (const member of members) {
    if (!baselineText.includes(member.displayName)) {
      violations.push(
        `${baselinePath}: missing synthetic identity ${member.playerId}`
      )
    }
  }
  return violations
}

function sessionFixtureViolations() {
  const file = 'data/loki-api/connect-response.json'
  const value = JSON.parse(readText(file))
  const text = JSON.stringify(value)
  const violations = []
  for (const key of ['userId', 'sessionId', 'newsfeed']) {
    if (text.includes(`"${key}"`)) {
      violations.push(`${file}: captured session field ${key}`)
    }
  }
  return violations
}

const EXPECTED_HASHED_LABELS = [
  'captured guild identifier',
  'captured install identifier',
  'captured device identifier',
  'captured guild identifier (fixture)',
  'captured player account identifier',
  'captured player account identifier (secondary)',
  'captured auth user identifier',
  'clean-repo tripwire sentinel'
]

function hashedTripwireControls() {
  const tableLabels = [...HASHED_IDENTIFIER_MARKERS.values()]
  for (const label of EXPECTED_HASHED_LABELS) {
    if (!tableLabels.includes(label)) {
      throw new Error(`hashed marker control failed: '${label}' is not stored`)
    }
  }
  for (const digest of HASHED_IDENTIFIER_MARKERS.keys()) {
    if (!/^[0-9a-f]{64}$/u.test(digest)) {
      throw new Error(
        `hashed marker control failed: '${digest}' is not a sha256 digest`
      )
    }
  }

  const compact = TRIPWIRE_SENTINEL.replace(/-/gu, '')
  const spellings = {
    'hyphenated.json': TRIPWIRE_SENTINEL,
    'uppercase.json': TRIPWIRE_SENTINEL.toUpperCase(),
    'compact.json': compact,
    'embedded.md': `see ticket ${TRIPWIRE_SENTINEL} for context`,
    'inside-longer-hex-run.txt': `ff${compact}ff`
  }
  for (const [file, content] of Object.entries(spellings)) {
    const hits = findContentViolations({ [file]: content })
    if (
      hits.length !== 1 ||
      hits[0] !== `${file}: clean-repo tripwire sentinel`
    ) {
      throw new Error(
        `hashed tripwire control failed: ${file} produced ${JSON.stringify(hits)}`
      )
    }
  }

  const nearMiss = TRIPWIRE_SENTINEL.slice(0, -1) + 'f'
  if (findContentViolations({ 'near-miss.json': nearMiss }).length) {
    throw new Error(
      'hashed tripwire control failed: a near-miss identifier was flagged'
    )
  }

  // The cache limit must not bound coverage: bury the sentinel past it.
  let filler = ''
  for (let i = 0; filler.length < SEEN_CACHE_LIMIT + 2048; i += 1) {
    filler += i.toString(16).padStart(8, '0')
  }
  const buried = `${filler}${compact}`
  const startedAt = Date.now()
  const buriedHits = findContentViolations({ 'buried-in-hex-run.txt': buried })
  const elapsedMs = Date.now() - startedAt
  if (
    buriedHits.length !== 1 ||
    buriedHits[0] !== 'buried-in-hex-run.txt: clean-repo tripwire sentinel'
  ) {
    throw new Error(
      `hashed tripwire control failed: sentinel buried at the end of a ${buried.length}-char hex run produced ${JSON.stringify(buriedHits)}`
    )
  }
  if (elapsedMs > 30_000) {
    throw new Error(
      `hashed tripwire control failed: scanning a ${buried.length}-char hex run took ${elapsedMs}ms`
    )
  }
}

function selfTest() {
  const planted = findContentViolations({
    'tool.py': 'import UnityPy',
    '.github/workflows/check.yml': 'runs-on: self-hosted',
    'auth.yml': '$2y$10$' + 'A'.repeat(53),
    'notes.md': '/home/tdefreest/secrets',
    'fixture.json': TRIPWIRE_SENTINEL
  })
  if (planted.length !== 5) {
    throw new Error(
      `positive control failed: expected 5 violations, got ${planted.length}`
    )
  }
  hashedTripwireControls()
  const guarded = findContentViolations({
    '.github/workflows/ci.yml':
      '    if: >-\n' +
      "      github.event_name != 'pull_request' ||\n" +
      '      github.event.pull_request.head.repo.full_name == github.repository\n' +
      '    runs-on: [self-hosted, amd64-builder]\n'
  })
  if (guarded.length) {
    throw new Error(
      `fork-guard control failed: guarded self-hosted job flagged ${guarded.length} violation(s)`
    )
  }
  if (findContentViolations({ 'README.md': 'ordinary public source' }).length) {
    throw new Error('negative control failed')
  }
  console.log('clean-repo positive and negative controls passed')
}

function scan() {
  const files = trackedFiles()
  const violations = []

  for (const file of files) {
    if (FORBIDDEN_FILES.has(file)) {
      violations.push(`${file}: forbidden internal file`)
    }
    if (FORBIDDEN_ROOTS.some((root) => file.startsWith(root))) {
      violations.push(`${file}: forbidden internal path`)
    }
    if (/\.(?:apk|aab|dll|exe)$/iu.test(file)) {
      violations.push(`${file}: executable or game package`)
    }
  }

  const readable = Object.fromEntries(
    files.map((file) => [file, readText(file)])
  )
  violations.push(...findContentViolations(readable))
  violations.push(...fixtureViolations())
  violations.push(...sessionFixtureViolations())

  if (violations.length) {
    console.error('Clean repository gate FAILED:')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log(`Clean repository gate passed (${files.length} tracked files)`)
}

const command = process.argv[2] ?? '--scan'
if (command === '--selftest') selfTest()
else if (command === '--scan') scan()
else {
  console.error('usage: check-clean-repo.mjs [--selftest|--scan]')
  process.exit(2)
}
