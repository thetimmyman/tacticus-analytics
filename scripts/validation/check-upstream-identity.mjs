#!/usr/bin/env node
// Gate: this application may name itself, never the game's client, and it must
// stay identifiable. Both failures are silent: borrowed game-client identity
// misrepresents the caller, while dropping our own name turns an identifiable
// integration into an anonymous scraper.
//
// Usage: check-upstream-identity.mjs [--selftest|--scan]

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SCRIPT_DIR, '..', '..')

// Identity that belongs to the game client. None of it describes this
// application, so no source file may carry it into a request.
const BORROWED_IDENTITY = [
  'UnityPlayer',
  'UnityWebRequest',
  'X-Unity-',
  'libcurl/'
]

// A browser User-Agent is legitimate when driving a local browser and a
// misrepresentation when sent to a game endpoint, so it is allowlisted by file
// and every allowlisted file is checked for game-host mentions below.
const BROWSER_IDENTITY = 'Mozilla/5.0'
const BROWSER_IDENTITY_FILES = new Map([
  ['playwright.config.ts', 'local browser configuration'],
  ['apps/desktop/proof/password-change-journey.mjs', 'drives a local browser']
])

// Files that may name a borrowed identity because they assert its absence.
const BORROWED_IDENTITY_FILES = new Map([
  [
    'tests/unit/edge-functions/loki-session-identity.test.ts',
    'pins the CONNECT headers that must stay absent'
  ]
])

const GAME_HOST_MARKERS = ['snowprintstudios.com', 'api.tacticusgame.com']

// The published device metadata is this application's deliberate, public
// identity. Changing either value is a product decision, not a refactor.
const APP_IDENTITY = [
  {
    file: 'app/lib/loki/public-device.ts',
    manufacturer: 'Tacticus Analytics',
    model: 'TacticusAnalytics'
  },
  {
    file: 'supabase/functions/_shared/loki-public-device.ts',
    manufacturer: 'Tacticus Analytics',
    model: 'TacticusAnalytics'
  }
]

// This file names the forbidden tokens in order to forbid them, and is a build
// gate rather than a request path. Scanning it would only match itself.
const SELF_PATH = 'scripts/validation/check-upstream-identity.mjs'

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/u
const SKIPPED = /(?:^|\/)(?:node_modules|\.next|coverage|reference)\//u

function isSourceFile(file) {
  return (
    SOURCE_FILE.test(file) &&
    !SKIPPED.test(file) &&
    !/\.d\.mts$/u.test(file) &&
    file !== SELF_PATH
  )
}

/** Tracked files only: an untracked scratch file is not shipped. */
function trackedSourceFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
    .split('\0')
    .filter((file) => file && isSourceFile(file))
}

function readSource(root, file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

/**
 * Judge one file. Pure so the self-test can exercise it without a repository.
 * Returns a list of human-readable problems.
 */
export function inspectSource(file, source) {
  const problems = []
  const namesGameHost = GAME_HOST_MARKERS.some((marker) =>
    source.includes(marker)
  )

  if (!BORROWED_IDENTITY_FILES.has(file)) {
    for (const identity of BORROWED_IDENTITY) {
      if (source.includes(identity)) {
        problems.push(
          `${file}: borrowed game-client identity "${identity}" — this is the game's client, not ours`
        )
      }
    }
  }

  if (source.includes(BROWSER_IDENTITY) && !BROWSER_IDENTITY_FILES.has(file)) {
    problems.push(
      `${file}: browser User-Agent "${BROWSER_IDENTITY}" outside the reviewed local-browser files`
    )
  }

  // An allowlisted file must stay away from the game endpoints, otherwise the
  // allowlist itself becomes the disguise.
  if (
    (BROWSER_IDENTITY_FILES.has(file) || BORROWED_IDENTITY_FILES.has(file)) &&
    namesGameHost
  ) {
    problems.push(
      `${file}: allowlisted to impersonate, but names a game host — move the assertion away from the request`
    )
  }

  return problems
}

/** Judge the application's own identity declarations. Pure, for the self-test. */
export function inspectAppIdentity(file, source, expected) {
  const problems = []
  for (const field of ['manufacturer', 'model']) {
    const value = expected[field]
    const pattern = new RegExp(
      `\\b${field}\\s*:\\s*(['"\`])${value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\1`,
      'u'
    )
    if (!pattern.test(source)) {
      problems.push(
        `${file}: ${field} is no longer "${value}" — the application must stay identifiable, not anonymous`
      )
    }
  }
  return problems
}

function scan(root) {
  const problems = []

  for (const file of trackedSourceFiles(root)) {
    problems.push(...inspectSource(file, readSource(root, file)))
  }

  for (const entry of APP_IDENTITY) {
    const absolute = path.join(root, entry.file)
    if (!fs.existsSync(absolute)) {
      problems.push(
        `${entry.file}: the application identity declaration is gone`
      )
      continue
    }
    problems.push(
      ...inspectAppIdentity(
        entry.file,
        fs.readFileSync(absolute, 'utf8'),
        entry
      )
    )
  }

  return problems
}

function selfTest() {
  let failed = 0
  const expectProblems = (label, problems, count) => {
    const ok = problems.length === count
    if (!ok) {
      failed += 1
      console.error(
        `  FAIL ${label}: expected ${count}, got ${problems.length}`
      )
      for (const problem of problems) console.error(`    ${problem}`)
    } else {
      console.log(`  ok   ${label}`)
    }
  }

  const spoof =
    "headers: { 'User-Agent': 'UnityPlayer/2022.3.40f1 (UnityWebRequest/1.0)', 'X-Unity-Version': '2022.3.40f1' }"
  expectProblems(
    'rejects the Unity client spoof',
    inspectSource('supabase/functions/x.ts', spoof),
    3
  )

  const versionHeaderOnly = "headers: { 'X-Unity-Version': '2022.3.40f1' }"
  expectProblems(
    'rejects a surviving Unity version header',
    inspectSource('app/lib/loki/client.ts', versionHeaderOnly),
    1
  )

  const honestName =
    "headers: { 'User-Agent': 'tacticus-analytics/refresh-global-config' }"
  expectProblems(
    'allows the application naming itself',
    inspectSource('app/lib/loki/global-config-refresh.ts', honestName),
    0
  )

  expectProblems(
    'allows the reviewed assertion file',
    inspectSource(
      'tests/unit/edge-functions/loki-session-identity.test.ts',
      spoof
    ),
    0
  )

  expectProblems(
    'rejects a browser User-Agent on a game endpoint',
    inspectSource(
      'supabase/functions/_shared/sync-modules/loki-session.ts',
      "headers: { 'User-Agent': 'Mozilla/5.0' }"
    ),
    1
  )

  expectProblems(
    'rejects an allowlisted file that smuggles the game host',
    inspectSource(
      'playwright.config.ts',
      "const url = 'https://api-live.loki.snowprintstudios.com'\nconst ua = 'Mozilla/5.0'"
    ),
    1
  )

  const identity = {
    manufacturer: 'Tacticus Analytics',
    model: 'TacticusAnalytics'
  }
  expectProblems(
    'accepts the published identity',
    inspectAppIdentity(
      'app/lib/loki/public-device.ts',
      "manufacturer: 'Tacticus Analytics',\n  model: 'TacticusAnalytics'",
      identity
    ),
    0
  )
  expectProblems(
    'rejects an anonymous identity',
    inspectAppIdentity(
      'app/lib/loki/public-device.ts',
      "manufacturer: 'Anonymous',\n  model: 'TacticusAnalytics'",
      identity
    ),
    1
  )

  if (failed > 0) {
    console.error(`upstream identity self-test failed (${failed})`)
    process.exit(1)
  }
  console.log('upstream identity self-test passed')
}

const mode = process.argv[2] ?? '--scan'
if (mode === '--selftest') {
  selfTest()
} else if (mode === '--scan') {
  const problems = scan(ROOT)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`)
    console.error(
      `upstream identity: ${problems.length} problem(s). The application may name itself, never the game client.`
    )
    process.exit(1)
  }
  console.log(
    `Upstream identity: no borrowed game-client identity across ${trackedSourceFiles(ROOT).length} tracked source files; application identity pinned`
  )
} else {
  console.error('usage: check-upstream-identity.mjs [--selftest|--scan]')
  process.exit(2)
}
