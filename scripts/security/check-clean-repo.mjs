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

// Substring tripwires, hashed so this file does not carry the values. Rows are
// [sha256 of the value (lower-cased when case-insensitive), length, rolling hash, case-insensitive, label].
const HASHED_SUBSTRING_MARKERS = [
  [
    'df0fbcd8b0451791a755688b4bd859ba949010c0181292377701671beb788683',
    7,
    4194115851,
    true,
    'captured hardware fingerprint'
  ],
  [
    '5ca1e135b3e46704e05c9cf9decb001b2fdc6a5d5292472116d1d01733b42e74',
    11,
    855206725,
    true,
    'captured hardware fingerprint'
  ],
  [
    '92c97b384a6a44fdf32f787777048d78209e7ce5102f80e3d700b2f8aa579787',
    8,
    3186505484,
    true,
    'captured hardware fingerprint'
  ],
  [
    '76a8aa258eafbf1696fddc83444e77deb4febf5df4990b73cb4f45a9fdb9bc98',
    5,
    3026415296,
    false,
    'private guild alias'
  ],
  [
    '481dc5df488fb60bb17b340c63fddc65f78f1941281af08e77eefeca66caa9ff',
    5,
    2403109405,
    false,
    'private guild alias'
  ],
  [
    '037716aa92c3bf8fcec7ea4f089e480a0066c08821b8e39b7ded8452f8e2129d',
    8,
    967885180,
    true,
    'private deployment topology'
  ],
  [
    '32de129ad7c5f63c74aa6879ce6c62b2c28f400197fefb83a3be4c02d1a4ffd2',
    12,
    264207176,
    true,
    'private deployment topology'
  ],
  [
    '109026d6e7ca7c6eb573ff6175a7a4d6bc18cb1233434c724898e6c664ea6ca0',
    24,
    2226129050,
    true,
    'private deployment topology'
  ],
  [
    'a9e9a17f3052b580a09dff420aad36b8894cffdd888477c30ef73ac9c848f539',
    15,
    637290445,
    false,
    'operator home path'
  ],
  [
    'da4461765cf9e2340ced498d40e3c74605aee1dd9f9d5718aae913c16f2cffde',
    29,
    835426179,
    true,
    'clean-repo substring tripwire sentinel'
  ],
  [
    'f73bce98675a582a9f702800d60973f684dca54b3c3242b30237c097623e4698',
    15,
    1173554660,
    false,
    'clean-repo case-sensitive tripwire sentinel'
  ]
]
const SUBSTRING_SENTINEL = 'clean-repo-substring-sentinel'
const CASE_SENSITIVE_SENTINEL = '[SentinelAlias]'
const ROLLING_BASE = 257

// One group per (length, case) pair, so each text is rolled once per group.
const SUBSTRING_GROUPS = (() => {
  const groups = new Map()
  for (const [
    digest,
    length,
    rolling,
    caseInsensitive,
    label
  ] of HASHED_SUBSTRING_MARKERS) {
    const key = `${length}:${caseInsensitive}`
    if (!groups.has(key)) {
      let power = 1
      for (let i = 1; i < length; i += 1)
        power = Math.imul(power, ROLLING_BASE) >>> 0
      groups.set(key, { length, caseInsensitive, power, markers: [] })
    }
    groups.get(key).markers.push({ digest, rolling, label })
  }
  return [...groups.values()]
})()

/** Rabin-Karp over every window, confirmed by SHA-256: the same substring semantics as a regex. */
function findHashedSubstrings(content) {
  const labels = new Set()
  // Long s (U+017F) is the one character /iu folds onto ASCII that toLowerCase() leaves alone.
  const lowered = content.toLowerCase().replace(/\u017f/gu, 's')
  for (const group of SUBSTRING_GROUPS) {
    const text = group.caseInsensitive ? lowered : content
    const { length, power, markers } = group
    if (text.length < length) continue
    let hash = 0
    for (let i = 0; i < length; i += 1) {
      hash = (Math.imul(hash, ROLLING_BASE) + text.charCodeAt(i)) >>> 0
    }
    for (let start = 0; ; start += 1) {
      for (const marker of markers) {
        if (hash !== marker.rolling || labels.has(marker.label)) continue
        const window = text.slice(start, start + length)
        if (
          createHash('sha256').update(window).digest('hex') === marker.digest
        ) {
          labels.add(marker.label)
        }
      }
      const next = start + length
      if (next >= text.length) break
      const dropped = Math.imul(text.charCodeAt(start), power)
      hash =
        (Math.imul(hash - dropped, ROLLING_BASE) + text.charCodeAt(next)) >>> 0
    }
  }
  return [...labels]
}

/** Windows slide across each hex run so an embedded identifier still matches. */
function findHashedIdentifiers(content) {
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

function findContentViolations(files) {
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
    for (const label of findHashedSubstrings(content)) {
      violations.push(`${file}: ${label}`)
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

function hashedSubstringControls() {
  for (const [digest, length, rolling] of HASHED_SUBSTRING_MARKERS) {
    if (
      !/^[0-9a-f]{64}$/u.test(digest) ||
      !Number.isInteger(length) ||
      !Number.isInteger(rolling)
    ) {
      throw new Error('hashed substring control failed: malformed table row')
    }
  }
  const expectLabel = (name, text, label) => {
    const hits = findContentViolations({ [name]: text })
    const want = label ? [`${name}: ${label}`] : []
    if (JSON.stringify(hits) !== JSON.stringify(want)) {
      throw new Error(
        `hashed substring control failed: ${name} produced ${JSON.stringify(hits)}`
      )
    }
  }
  const insensitive = 'clean-repo substring tripwire sentinel'
  const sensitive = 'clean-repo case-sensitive tripwire sentinel'
  expectLabel('whole.txt', SUBSTRING_SENTINEL, insensitive)
  expectLabel('upper.txt', SUBSTRING_SENTINEL.toUpperCase(), insensitive)
  expectLabel('embedded.txt', `x${SUBSTRING_SENTINEL}y`, insensitive)
  expectLabel(
    'long-s.txt',
    SUBSTRING_SENTINEL.replace('s', '\u017f'),
    insensitive
  )
  expectLabel(
    'at-end.txt',
    `${'a'.repeat(1000)}${SUBSTRING_SENTINEL}`,
    insensitive
  )
  expectLabel('alias.txt', `name: ${CASE_SENSITIVE_SENTINEL} guild`, sensitive)
  expectLabel('alias-case.txt', CASE_SENSITIVE_SENTINEL.toLowerCase(), null)
  expectLabel('near-miss.txt', SUBSTRING_SENTINEL.slice(0, -1), null)
  expectLabel('one-off.txt', SUBSTRING_SENTINEL.replace('-s', '_s'), null)

  // A loose bound: a quadratic scan of 2 MB takes minutes; a busy runner takes seconds.
  const large = `${'ordinary public text '.repeat(100_000)}${SUBSTRING_SENTINEL}`
  const startedAt = Date.now()
  const hits = findHashedSubstrings(large)
  const elapsedMs = Date.now() - startedAt
  if (!hits.includes(insensitive) || elapsedMs > 30_000) {
    throw new Error(
      `hashed substring control failed: ${large.length}-char text took ${elapsedMs}ms, hits ${JSON.stringify(hits)}`
    )
  }
}

function selfTest() {
  const planted = findContentViolations({
    'tool.py': 'import UnityPy',
    '.github/workflows/check.yml': 'runs-on: self-hosted',
    'auth.yml': '$2y$10$' + 'A'.repeat(53),
    'notes.md': `see /srv/${SUBSTRING_SENTINEL}/notes`,
    'fixture.json': TRIPWIRE_SENTINEL
  })
  if (planted.length !== 5) {
    throw new Error(
      `positive control failed: expected 5 violations, got ${planted.length}`
    )
  }
  hashedTripwireControls()
  hashedSubstringControls()
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
