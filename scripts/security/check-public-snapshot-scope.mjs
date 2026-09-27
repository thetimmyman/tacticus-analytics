#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const FORBIDDEN_PREFIXES = [
  '.planning/',
  'agents/',
  'oracle/',
  'apps/battle-sim-service/',
  'data/battle-sim/',
  'modules/battle-sim-engine/',
  'modules/competitive-intel/',
  'modules/guild-war/',
  'tools/replay-converter/',
  'app/components/replay-viewer/',
  'app/components/premium/',
  'app/components/beta/',
  'app/components/degradation/',
  'app/(dashboard)/guild-api-keys/',
  'app/(dashboard)/guild-webhooks/',
  'app/lib/battle/',
  'app/lib/video/',
  'supabase/functions/scrape-guild/',
  'supabase/functions/scrape-leaderboard/'
]

// Exemptions name markers, so a new marker is never covered by an old exemption.
const FORBIDDEN_SOURCE_MARKERS = [
  { name: 'cluster-admin-predicate', pattern: /\bis_eot_cluster_admin\b/i },
  { name: 'leader-guild-page', pattern: /\beotLeaderGuildPage\b/i },
  { name: 'guild-merge-execute', pattern: /\bexecute_guild_merge\b/i },
  { name: 'guild-merge-find', pattern: /\bfind_mergeable_guilds\b/i },
  { name: 'guild-merge-preview', pattern: /\bpreview_guild_merge\b/i },
  { name: 'guild-merge-rollback', pattern: /\brollback_guild_merge\b/i },
  { name: 'cluster-member-predicate', pattern: /\bis_eot_member\b/i },
  { name: 'cluster-member-table', pattern: /\beot_cluster_member\b/i },
  { name: 'private-kong-host', pattern: /eot-supabase-kong/i },
  { name: 'private-project-name', pattern: /eye[ _-]?of[ _-]?terror/i },
  { name: 'cluster-code-equals', pattern: /cluster_code\s*=\s*['"]EOT['"]/i },
  {
    name: 'cluster-code-in',
    pattern: /cluster_code\s+IN\s*\([^)]*['"]EOT['"]/i
  }
]

const FORBIDDEN_SEGMENTS = [
  '(inactive-dashboard)',
  'applications',
  'battle-simulator',
  'competitive-intel',
  'degradation',
  'guild-war-sync',
  'meta-runs',
  'policy-labs',
  'premium',
  'recruitment',
  'replay-viewer',
  'replays',
  'showcase',
  'sim'
]

// Only the YouTube replay catalog may be public; any other replay module fails.
const APPROVED_TERMINUS_REPLAY_PATHS = new Set([
  'app/(dashboard)/replays/replaycatalogclient.tsx',
  'app/(dashboard)/replays/page.tsx',
  'app/lib/replays/community-replay-catalog-shared.ts',
  'app/lib/replays/community-replay-catalog.ts',
  'app/lib/replays/replay-source.ts',
  'tests/unit/replays/community-replay-catalog.test.ts'
])

// Exact paths only, each approved for named markers; all others are still checked.
const APPROVED_SOURCE_MARKER_PATHS = new Map([
  // Deny-list config: names the marker in order to reject it.
  ['.app-identity.json', new Set(['private-project-name'])],
  // Names the repo split; no implementation detail.
  ['readme.md', new Set(['private-project-name'])],
  // Recreates cleanup_long_stale_guilds from its live body (a cluster_code literal).
  [
    'supabase/migrations/20260925030000_ps516_drop_guild_war_sync_machinery.sql',
    new Set(['cluster-code-equals'])
  ],
  // Negative-test fixtures the verifier must reject.
  [
    'scripts/dev/verify-app-identity.test.mjs',
    new Set(['private-project-name'])
  ],
  // This script's own marker table and fixtures.
  [
    'scripts/security/check-public-snapshot-scope.mjs',
    new Set([
      'cluster-admin-predicate',
      'cluster-member-table',
      'private-kong-host',
      'cluster-code-equals'
    ])
  ]
])

function findForbiddenPaths(paths) {
  return paths.filter((candidate) => {
    const file = candidate.replaceAll('\\', '/').toLowerCase()
    if (APPROVED_TERMINUS_REPLAY_PATHS.has(file)) return false
    if (FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      return true
    }
    const segments = file.split('/')
    return FORBIDDEN_SEGMENTS.some((segment) => segments.includes(segment))
  })
}

function findForbiddenSourceMarkers(files) {
  const violations = []
  for (const [file, content] of Object.entries(files)) {
    const normalized = file.replaceAll('\\', '/').toLowerCase()
    const approved = APPROVED_SOURCE_MARKER_PATHS.get(normalized)
    for (const marker of FORBIDDEN_SOURCE_MARKERS) {
      if (approved?.has(marker.name)) continue
      if (marker.pattern.test(content)) {
        violations.push(`${file}: ${marker.name} ${marker.pattern}`)
      }
    }
  }
  return violations
}

// Markers hide in tests, scripts and docs as easily as in app code.
const SOURCE_SCAN_DIRECTORIES =
  /^(app|packages|supabase\/functions|supabase\/migrations|tests|scripts|docs)\//
const SOURCE_SCAN_CODE_EXTENSIONS = /\.(?:js|mjs|ts|tsx|sql)$/

const SOURCE_SCAN_TEXT_EXTENSIONS = /\.(?:md|json|ya?ml)$/

function isSourceScanTarget(file) {
  const normalized = file.replaceAll('\\', '/')
  if (SOURCE_SCAN_TEXT_EXTENSIONS.test(normalized)) return true
  return (
    SOURCE_SCAN_DIRECTORIES.test(normalized) &&
    SOURCE_SCAN_CODE_EXTENSIONS.test(normalized)
  )
}

function selfTest() {
  const planted = [
    'agents/workflows/subscriptionAgent.ts',
    'app/components/replay-viewer/ReplayViewer.tsx',
    'app/(dashboard)/replays/private-captured/page.tsx',
    'app/(inactive-dashboard)/layout.tsx',
    'modules/competitive-intel/index.ts',
    'data/battle-sim/docs/game-data/index.json'
  ]
  const detected = findForbiddenPaths(planted)
  if (detected.length !== planted.length) {
    throw new Error('positive control failed: a forbidden path was missed')
  }
  if (
    findForbiddenPaths([
      'app/components/status/ServiceHealthBanner.tsx',
      'app/(home)/home/page.tsx',
      'app/(dashboard)/meta-atlas/page.tsx',
      'app/(dashboard)/replays/page.tsx',
      'app/lib/replays/replay-source.ts',
      'app/api/meta-analysis/route.ts',
      'app/lib/meta/team-progression.ts',
      'data/game-data/heroes_index.json'
    ]).length !== 0
  ) {
    throw new Error('negative control failed: retained paths were rejected')
  }
  const plantedSource = findForbiddenSourceMarkers({
    'app/example.ts': "const privileged = cluster_code = 'EOT'",
    'supabase/example.sql': 'select is_eot_cluster_admin()'
  })
  if (plantedSource.length !== 2) {
    throw new Error('positive control failed: private source marker was missed')
  }
  if (
    findForbiddenSourceMarkers({
      'packages/app-core/src/api-constants.ts': "BATTLE_DATA: 'EOT_GR_data'",
      'app/lib/auth/config.ts': "name: 'tacticus-auth'"
    }).length !== 0
  ) {
    throw new Error(
      'negative control failed: compatibility marker was rejected'
    )
  }
  const summary = formatScanSummary(4417, 2907)
  const numbers = summary.match(/\d+/g) ?? []
  if (numbers.length !== 2 || numbers[0] === numbers[1]) {
    throw new Error(
      'selftest failed: success line must name two distinct populations'
    )
  }
  if (!summary.includes('4417') || !summary.includes('2907')) {
    throw new Error(
      'selftest failed: success line is missing one of the two population counts'
    )
  }
  const mustScan = [
    '.app-identity.json',
    'README.md',
    'scripts/dev/verify-app-identity.test.mjs',
    'scripts/security/check-public-snapshot-scope.mjs',
    'tests/unit/api/routes/members/roster.test.ts',
    'docs/some-doc.md'
  ]
  for (const file of mustScan) {
    if (!isSourceScanTarget(file)) {
      throw new Error(
        `selftest failed: marker scan coverage regressed for ${file}`
      )
    }
  }
  const exempted = findForbiddenSourceMarkers({
    'scripts/security/check-public-snapshot-scope.mjs':
      "forbidden: is_eot_cluster_admin(), 'eot_cluster_member', " +
      'eot-supabase-kong'
  })
  if (exempted.length !== 0) {
    throw new Error(
      'selftest failed: an approved source-marker path was not exempted'
    )
  }
  const narrowlyExempt = findForbiddenSourceMarkers({
    '.app-identity.json': 'forbidden: is_eot_cluster_admin()',
    'readme.md': "origin: 'eot_cluster_member'",
    'scripts/dev/verify-app-identity.test.mjs': "cluster_code = 'EOT'"
  })
  if (narrowlyExempt.length !== 3) {
    throw new Error(
      'selftest failed: a path exemption suppressed a marker it was never approved for'
    )
  }
  console.log('public snapshot scope self-test passed')
}

function formatScanSummary(trackedCount, sourceFileCount) {
  return `Public snapshot scope passed (${trackedCount} paths checked, ${sourceFileCount} source files scanned for markers)`
}

function scan() {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8'
  })
    .split('\0')
    .filter(Boolean)
  const violations = findForbiddenPaths(tracked)
  const sourceFiles = Object.fromEntries(
    tracked
      .filter((file) => isSourceScanTarget(file))
      .map((file) => [file, fs.readFileSync(file, 'utf8')])
  )
  const sourceViolations = findForbiddenSourceMarkers(sourceFiles)
  if (violations.length > 0 || sourceViolations.length > 0) {
    console.error('Public snapshot scope FAILED:')
    for (const violation of violations) console.error(`- ${violation}`)
    for (const violation of sourceViolations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log(
    formatScanSummary(tracked.length, Object.keys(sourceFiles).length)
  )
}

const command = process.argv[2] ?? '--scan'
if (command === '--selftest') selfTest()
else if (command === '--scan') scan()
else {
  console.error('usage: check-public-snapshot-scope.mjs [--selftest|--scan]')
  process.exit(2)
}
