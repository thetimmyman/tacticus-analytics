#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createHash } from 'node:crypto'

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

// Hashes keep private values out of source while preserving substring checks.
const FORBIDDEN_SOURCE_MARKERS = [
  [
    '5bab788c1cbe8ee9540cf73122967975d226f8f3cf7f5c7c32efeddca61899eb',
    20,
    1986328140,
    true,
    'cluster-admin-predicate'
  ],
  [
    '4936b9a3c1e9cb68b434ce661ae3766b46b788f9e7bd40b48a6ab789fc132c19',
    18,
    2134463335,
    true,
    'leader-guild-page'
  ],
  [
    'e66c7f4755eb710f25c9deedf8122ca59da98eed0e8016400909352cacfd0c02',
    19,
    727781846,
    true,
    'guild-merge-execute'
  ],
  [
    'a0bbf2baeccbacec8d191120a68b73077c464bdfb8136090608c07592304fc08',
    21,
    3776241803,
    true,
    'guild-merge-find'
  ],
  [
    'd6b6108715bb2d42d36cf0a35f9a5c03779fa5fbca89e0592344666341a7f950',
    19,
    3177053157,
    true,
    'guild-merge-preview'
  ],
  [
    '00bb9dcee5fe52b7709b9c4badc4d959180ef5d7d96e23eaeabdc5f5abb73dae',
    20,
    877208621,
    true,
    'guild-merge-rollback'
  ],
  [
    'a0af6cb237c49291244ee655265cfd64858bea1cac86317fc900404599413079',
    13,
    1347430490,
    true,
    'cluster-member-predicate'
  ],
  [
    '1938bffd7ba1bda6c8dd0b95bd366602da84cb8938590c3b79ad16e849040dae',
    18,
    3577020288,
    true,
    'cluster-member-table'
  ],
  [
    'b9a14009c899867305cc60a97486f8292a282aa25fad8818a0531826a1d2cd4d',
    17,
    3426570149,
    true,
    'private-kong-host'
  ],
  [
    '6b4ccdd750e608cf8cf0ce8ac51df582577410a64831bfec6691d847e9e19730',
    11,
    480988598,
    true,
    'private-project-name'
  ],
  [
    '8dcabb419a243e1d7ce83742d0b2e1aa4896eda0eaf012e05d8226d9e4bda846',
    12,
    2505450966,
    true,
    'private-project-name'
  ],
  [
    'f9eb2338861671e857bf1bdc401227089cc94f5ba9050f5febd5681e35eb4152',
    12,
    2231934997,
    true,
    'private-project-name'
  ],
  [
    'e598da16518c9ce30f202de8d2afa647f3cca932548e816e28a715827a5943ed',
    12,
    2585359331,
    true,
    'private-project-name'
  ],
  [
    '07a178aee762dcec9ac934923f5f1b990a1bc645e5790fb7f558f0ea45957381',
    12,
    4236808406,
    true,
    'private-project-name'
  ],
  [
    'd6dde83e28fe9e7e4363eff42fcdb150d4fcd24f26741a0c11c875b77b7656e4',
    13,
    1383500022,
    true,
    'private-project-name'
  ],
  [
    '1b8be3897fae21711916e43ff063a0c5b4f0c9248e672e76bf7c5a20a2c94020',
    13,
    1109984053,
    true,
    'private-project-name'
  ],
  [
    'c49f5618b9a312d3261f5e07225dbd6d92a787ccd954165405ca72e7a08dfe76',
    13,
    1463408387,
    true,
    'private-project-name'
  ],
  [
    '66ac8722bb74015d6e27b5f3b512483557d24732bcb70a9cd6f34358613a3806',
    12,
    3413018901,
    true,
    'private-project-name'
  ],
  [
    '78139fb677bf4803de98cb9513d7e80428e65d2fe884b54301aaec6d5fb62b84',
    13,
    122994741,
    true,
    'private-project-name'
  ],
  [
    '8e3c0f794351fa312e9bde35b9286d52aaab9c1456da5495cfbcd2901dbb3de5',
    13,
    4144446068,
    true,
    'private-project-name'
  ],
  [
    'b15d4e1cf73cb5888e5b8d18ba693665536699e4ca35633042bf812df801daf5',
    13,
    202903106,
    true,
    'private-project-name'
  ],
  [
    '0e34d716480d002a3c522fbd78ff65822554beb5e0907fcf759b6d4ed7aa4180',
    12,
    3589601507,
    true,
    'private-project-name'
  ],
  [
    '4f01c1b7477366091fb8510f5de5b03293df8be4efd551f09db608b2cadd616c',
    13,
    2555051523,
    true,
    'private-project-name'
  ],
  [
    '0533288f37b220f64eaef15a70807f8a0ef79c51ac23cf45bd73e03a4049ee6c',
    13,
    2281535554,
    true,
    'private-project-name'
  ],
  [
    '639a9a222ceb6cd46109cc9e1241232d1c3674cccb8ca01a15413faadb3ec8ec',
    13,
    2634959888,
    true,
    'private-project-name'
  ]
]

const CONTEXT_VALUE_DIGEST =
  '0ac329cdd431e2e83a7d959b9569914ea3fd2c0d90cd088b2112486973c46dd3'
const ROLLING_BASE = 257
const WORD_BOUNDARY_MARKERS = new Set([
  'cluster-admin-predicate',
  'leader-guild-page',
  'guild-merge-execute',
  'guild-merge-find',
  'guild-merge-preview',
  'guild-merge-rollback',
  'cluster-member-predicate',
  'cluster-member-table'
])

function buildMarkerGroups(rows) {
  const groups = new Map()
  for (const [digest, length, rolling, caseInsensitive, label] of rows) {
    const key = `${length}:${caseInsensitive}`
    if (!groups.has(key)) {
      let power = 1
      for (let i = 1; i < length; i += 1)
        power = Math.imul(power, ROLLING_BASE) >>> 0
      groups.set(key, { length, power, caseInsensitive, markers: [] })
    }
    groups.get(key).markers.push({ digest, rolling, label })
  }
  return [...groups.values()]
}

function rollingHash(value) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (Math.imul(hash, ROLLING_BASE) + value.charCodeAt(i)) >>> 0
  }
  return hash
}

// Builds a marker row from plaintext; only the self-test calls it, with synthetic values.
function markerRow(value, label) {
  const lowered = value.toLowerCase()
  return [sha256(lowered), lowered.length, rollingHash(lowered), true, label]
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const PRODUCTION_MARKERS = {
  groups: buildMarkerGroups(FORBIDDEN_SOURCE_MARKERS),
  contextDigest: CONTEXT_VALUE_DIGEST
}

function findHashedSourceMarkers(content, groups) {
  const hits = new Set()
  const lowered = content.toLowerCase().replace(/\u017f/gu, 's')
  for (const { length, power, caseInsensitive, markers } of groups) {
    const value = caseInsensitive ? lowered : content
    if (value.length < length) continue
    let hash = rollingHash(value.slice(0, length))
    for (let start = 0; ; start += 1) {
      for (const { digest, rolling, label } of markers) {
        if (hash !== rolling || hits.has(label)) continue
        if (WORD_BOUNDARY_MARKERS.has(label)) {
          if (
            /\w/u.test(value[start - 1] ?? '') ||
            /\w/u.test(value[start + length] ?? '')
          )
            continue
        }
        if (sha256(value.slice(start, start + length)) === digest)
          hits.add(label)
      }
      const next = start + length
      if (next >= value.length) break
      hash =
        (Math.imul(
          hash - Math.imul(value.charCodeAt(start), power),
          ROLLING_BASE
        ) +
          value.charCodeAt(next)) >>>
        0
    }
  }
  return hits
}

function hasContextValue(text, contextDigest) {
  for (const [, value] of text.matchAll(/['"]([^'"]+)['"]/gu)) {
    if (sha256(value.toLowerCase()) === contextDigest) return true
  }
  return false
}

function findContextMarkers(content, contextDigest) {
  const labels = new Set()
  for (const match of content.matchAll(
    /cluster_code\s*=\s*['"][^'"]+['"]/giu
  )) {
    if (hasContextValue(match[0], contextDigest))
      labels.add('cluster-code-equals')
  }
  for (const match of content.matchAll(/cluster_code\s+IN\s*\([^)]*/giu)) {
    if (hasContextValue(match[0], contextDigest)) labels.add('cluster-code-in')
  }
  return labels
}

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

// Exact paths, each approved only for the markers it must name; all other markers still fail.
const APPROVED_SOURCE_MARKER_PATHS = new Map([
  // Deny-list config: names the marker in order to reject it.
  ['.app-identity.json', new Set(['private-project-name'])],
  // Each recreates cleanup_long_stale_guilds from its applied body (a cluster_code literal).
  [
    'supabase/migrations/20260925030000_ps516_drop_guild_war_sync_machinery.sql',
    new Set(['cluster-code-equals'])
  ],
  [
    'supabase/migrations/20260927210000_orphan_guild_cleanup_keeps_battle_history.sql',
    new Set(['cluster-code-equals'])
  ]
])

function isApprovedSourceMarker(file, name) {
  const key = file.replaceAll('\\', '/').toLowerCase()
  return APPROVED_SOURCE_MARKER_PATHS.get(key)?.has(name) ?? false
}

function findForbiddenSourceMarkers(files, markers = PRODUCTION_MARKERS) {
  const violations = []
  for (const [file, content] of Object.entries(files)) {
    for (const name of [
      ...findHashedSourceMarkers(content, markers.groups),
      ...findContextMarkers(content, markers.contextDigest)
    ]) {
      if (isApprovedSourceMarker(file, name)) continue
      violations.push(`${file}: ${name}`)
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
  const privateValue = 'synthetic_private_predicate'
  const contextValue = 'ZQX'
  const projectValue = 'synthetic-project'
  const markers = {
    groups: buildMarkerGroups([
      markerRow(privateValue, 'cluster-admin-predicate'),
      markerRow(projectValue, 'private-project-name')
    ]),
    contextDigest: sha256(contextValue.toLowerCase())
  }
  for (const [digest, length, rolling, , label] of FORBIDDEN_SOURCE_MARKERS) {
    if (
      !/^[0-9a-f]{64}$/.test(digest) ||
      !(length > 0) ||
      rolling !== rolling >>> 0 ||
      !label
    ) {
      throw new Error(`selftest failed: malformed marker row ${label}`)
    }
  }
  const plantedSource = findForbiddenSourceMarkers(
    {
      'app/example.ts': `const privileged = cluster_code = '${contextValue}'`,
      'supabase/example.sql': `select ${privateValue}()`
    },
    markers
  )
  if (plantedSource.length !== 2) throw new Error('positive control failed')
  if (
    findForbiddenSourceMarkers({ 'app/example.ts': projectValue }, markers)
      .length !== 1
  ) {
    throw new Error('project marker control failed')
  }
  if (
    findForbiddenSourceMarkers(
      {
        'app/example.ts': `cluster_code IN ('other', '${contextValue}')`
      },
      markers
    ).length !== 1
  ) {
    throw new Error('context marker control failed')
  }
  if (
    findForbiddenSourceMarkers(
      {
        'packages/app-core/src/api-constants.ts': `BATTLE_DATA: '${contextValue}_GR_data'`,
        'app/lib/auth/config.ts': "name: 'tacticus-auth'",
        'app/lib/other.ts': `my_${privateValue}_v2()`
      },
      markers
    ).length !== 0
  )
    throw new Error('negative control failed')
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
  const approvedMigration =
    'supabase/migrations/20260925030000_ps516_drop_guild_war_sync_machinery.sql'
  if (
    !isApprovedSourceMarker(approvedMigration, 'cluster-code-equals') ||
    isApprovedSourceMarker(approvedMigration, 'private-project-name') ||
    isApprovedSourceMarker('app/example.ts', 'cluster-code-equals')
  ) {
    throw new Error(
      'selftest failed: a source-marker exemption is not path- and marker-exact'
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
