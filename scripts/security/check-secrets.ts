import { execSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

interface SecretPattern {
  name: string
  regex: RegExp
  ignoreMatch?: (match: RegExpExecArray, filePath: string) => boolean
}

interface Finding {
  file: string
  line?: number
  column?: number
  pattern: string
}

const ROOT = process.cwd()

// Gitignored real-secret files: being tracked is itself a finding. Never skip by path.
const MUST_NOT_BE_TRACKED = new Set([
  '.env.local',
  '.env.production',
  'docker/.env'
])

function isPlaceholderValue(value: string | undefined): boolean {
  return /YOUR|PLACEHOLDER|REPLACE_ME|<[^>]+>/i.test(value ?? '')
}

/**
 * Exempt on the value, never the path: demo keys carry `iss: "supabase-demo"`. The `.` in the two
 * capture groups is load-bearing; without it only the header is captured and this is always false.
 */
function isSupabaseDemoJwt(value: string | undefined): boolean {
  if (!value?.startsWith('eyJ')) return false
  const payloadSegment = value.split('.')[1]
  if (!payloadSegment) return false
  try {
    const decoded = Buffer.from(payloadSegment, 'base64url').toString('utf8')
    return (JSON.parse(decoded) as { iss?: string }).iss === 'supabase-demo'
  } catch {
    return false
  }
}

/** Decodes the payload and fires only on `role: "service_role"`. */
function isServiceRoleJwt(value: string | undefined): boolean {
  if (!value?.startsWith('eyJ')) return false
  const payloadSegment = value.split('.')[1]
  if (!payloadSegment) return false
  try {
    const decoded = Buffer.from(payloadSegment, 'base64url').toString('utf8')
    return (JSON.parse(decoded) as { role?: string }).role === 'service_role'
  } catch {
    return false
  }
}

// Real snowflakes are 17-19 digits; longer synthetic ids must be declared here.
const SYNTHETIC_WEBHOOK_IDS = new Set(['1234567890123456789'])

function isSyntheticWebhookId(id: string): boolean {
  return id.length < 17 || SYNTHETIC_WEBHOOK_IDS.has(id)
}

function isDiscordWebhookUnitFixture(filePath: string, url: string): boolean {
  // Fixture webhook URLs must use a synthetic id; offline, since probing Discord would disclose ids.
  if (!/^tests\/unit\/.+\.test\.ts$/i.test(filePath)) return false
  const id = /\/webhooks\/([0-9]+)\//.exec(url)?.[1] ?? ''
  return isSyntheticWebhookId(id)
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: 'Supabase service role key',
    regex:
      /(SUPABASE_SERVICE_ROLE_KEY\s*=\s*)(?<value>eyJ[A-Za-z0-9_.-]{30,})/g,
    ignoreMatch: (match) =>
      isPlaceholderValue(match.groups?.value) ||
      isSupabaseDemoJwt(match.groups?.value)
  },
  {
    name: 'Supabase anon key',
    regex:
      /(NEXT_PUBLIC_SUPABASE_ANON_KEY\s*=\s*)(?<value>eyJ[A-Za-z0-9_.-]{30,})/g,
    ignoreMatch: (match) =>
      isPlaceholderValue(match.groups?.value) ||
      isSupabaseDemoJwt(match.groups?.value)
  },
  {
    name: 'Resend API key',
    regex: /(RESEND_API_KEY\s*=\s*)(?<value>re_[A-Za-z0-9_-]{20,})/g,
    ignoreMatch: (match) => isPlaceholderValue(match.groups?.value)
  },
  {
    name: 'Discord bot token',
    regex: /(DISCORD_BOT_TOKEN\s*=\s*)(?<value>[A-Za-z0-9._-]{30,})/g,
    ignoreMatch: (match) => isPlaceholderValue(match.groups?.value)
  },
  {
    name: 'Discord webhook',
    regex: /(https:\/\/discord\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+)/g,
    ignoreMatch: (match, filePath) =>
      isPlaceholderValue(match[1]) ||
      isDiscordWebhookUnitFixture(filePath, match[1])
  },
  {
    name: 'GitHub personal access token',
    regex: /(GITHUB_TOKEN\s*=\s*)(?<value>github_pat_[A-Za-z0-9_]{20,})/g,
    ignoreMatch: (match) => isPlaceholderValue(match.groups?.value)
  },
  {
    name: 'Vercel access token',
    regex: /(VERCEL_TOKEN\s*=\s*)(?<value>[A-Za-z0-9._-]{20,})/g,
    ignoreMatch: (match) => isPlaceholderValue(match.groups?.value)
  },
  {
    name: 'Generic bearer secret',
    regex: /(=\s*)(?<value>sk_[A-Za-z0-9]{20,})/g,
    ignoreMatch: (match) => isPlaceholderValue(match.groups?.value)
  },
  // Value-shaped, no `VARNAME=` anchor: catches a bare token however it is named.
  {
    name: 'GitHub classic personal access token',
    regex: /(?<value>ghp_[A-Za-z0-9]{36})/g,
    ignoreMatch: (match) => isPlaceholderValue(match.groups?.value)
  },
  {
    name: 'PEM private key',
    regex:
      /(?<value>-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----)/g,
    ignoreMatch: (match) => isPlaceholderValue(match.groups?.value)
  },
  {
    name: 'GitHub fine-grained personal access token (bare)',
    regex: /(?<value>github_pat_[A-Za-z0-9_]{20,})/g,
    ignoreMatch: (match) => isPlaceholderValue(match.groups?.value)
  },
  {
    name: 'GitHub OAuth or server-to-server token',
    regex: /(?<value>gh[os]_[A-Za-z0-9]{36})/g,
    ignoreMatch: (match) => isPlaceholderValue(match.groups?.value)
  },
  {
    name: 'AWS access key ID',
    regex: /(?<value>AKIA[0-9A-Z]{16})/g,
    ignoreMatch: (match) => isPlaceholderValue(match.groups?.value)
  },
  {
    name: 'Supabase secret key',
    regex: /(?<value>sb_secret_[A-Za-z0-9_-]{20,})/g,
    ignoreMatch: (match) => isPlaceholderValue(match.groups?.value)
  },
  {
    name: 'Bare service-role JWT',
    // Matches any JWT; ignoreMatch (isServiceRoleJwt) does the real filtering.
    regex: /(?<value>eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)/g,
    ignoreMatch: (match) =>
      !isServiceRoleJwt(match.groups?.value) ||
      isPlaceholderValue(match.groups?.value) ||
      isSupabaseDemoJwt(match.groups?.value)
  }
]

// Independent of SECRET_PATTERNS so --selftest fails when a pattern is removed.
const EXPECTED_PATTERN_NAMES = [
  'Supabase service role key',
  'Supabase anon key',
  'Resend API key',
  'Discord bot token',
  'Discord webhook',
  'GitHub personal access token',
  'Vercel access token',
  'Generic bearer secret',
  'GitHub classic personal access token',
  'PEM private key',
  'Bare service-role JWT',
  'GitHub fine-grained personal access token (bare)',
  'GitHub OAuth or server-to-server token',
  'AWS access key ID',
  'Supabase secret key'
]

function scanTrackedPath(filePath: string): Finding[] {
  if (MUST_NOT_BE_TRACKED.has(filePath)) {
    return [
      {
        file: filePath,
        pattern:
          'Gitignored secret file is TRACKED (holds real credentials; must never be committed)'
      }
    ]
  }

  const isMaintenanceCsv = /^scripts\/maintenance\/[^/]+\.csv$/i.test(filePath)
  const isSensitiveCsv =
    /(^|\/)[^/]*(?:api[-_]?keys?|keys?|secrets?|tokens?|credentials?|passwords?|exports?)[^/]*\.csv(?:\.[a-z0-9]+)?$/i.test(
      filePath
    )
  if (!isMaintenanceCsv && !isSensitiveCsv) {
    return []
  }

  return [
    {
      file: filePath,
      pattern: isMaintenanceCsv
        ? 'Tracked maintenance CSV export'
        : 'Tracked sensitive CSV filename'
    }
  ]
}

function getTrackedFiles(): string[] {
  // The 1 MB default is smaller than `git ls-files` output (ENOBUFS).
  const raw = execSync('git ls-files', {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

// Excluded so the selftest fixtures do not match. Do not widen.
const SELF = 'scripts/security/check-secrets.ts'

function scanContent(filePath: string, content: string): Finding[] {
  const findings: Finding[] = []

  for (const pattern of SECRET_PATTERNS) {
    let match: RegExpExecArray | null
    pattern.regex.lastIndex = 0

    while ((match = pattern.regex.exec(content)) !== null) {
      if (pattern.ignoreMatch?.(match, filePath)) {
        continue
      }

      const { index } = match
      const beforeMatch = content.slice(0, index)
      const lineNumber = beforeMatch.split(/\r?\n/).length
      const column = index - beforeMatch.lastIndexOf('\n')

      findings.push({
        file: filePath,
        line: lineNumber,
        column,
        pattern: pattern.name
      })
    }
  }

  return findings
}

async function scanFile(filePath: string): Promise<Finding[]> {
  if (filePath === SELF) return []

  const absolutePath = join(ROOT, filePath)
  let content: string

  try {
    content = await fs.readFile(absolutePath, 'utf8')
  } catch {
    return []
  }

  return scanContent(filePath, content)
}

async function main() {
  const files = getTrackedFiles()
  const results: Finding[] = []

  for (const file of files) {
    results.push(...scanTrackedPath(file))
    const fileFindings = await scanFile(file)
    results.push(...fileFindings)
  }

  if (results.length === 0) {
    console.log('✅  No tracked secrets detected.')
    return
  }

  console.error('❌  Potential secrets detected:')
  for (const finding of results) {
    const location =
      finding.line === undefined
        ? finding.file
        : `${finding.file}:${finding.line}:${finding.column ?? 1}`

    console.error(`- [${finding.pattern}] ${location}`)
  }
  process.exit(1)
}

/** Fixtures are assembled at runtime so gitleaks never sees a contiguous token. */
function buildSyntheticJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = Buffer.from(
    'ps403-selftest-signature-not-a-real-key'
  ).toString('base64url')
  return `${header}.${payload}.${signature}`
}

const CLASSIC_PAT_PREFIX = 'ghp_'
const CLASSIC_PAT_BODY = 'vQuc2eoya6qaKQkG4AcSYgiSkckUyqc0ekw4'
const SYNTHETIC_CLASSIC_PAT = CLASSIC_PAT_PREFIX + CLASSIC_PAT_BODY

const PEM_BEGIN = '-----BEGIN '
const PEM_LABEL = 'RSA PRIVATE KEY'
const PEM_END = '-----'
const SYNTHETIC_PEM_HEADER = PEM_BEGIN + PEM_LABEL + PEM_END

const PEM_LABEL_ENCRYPTED = 'ENCRYPTED PRIVATE KEY'
const SYNTHETIC_ENCRYPTED_PEM_HEADER = PEM_BEGIN + PEM_LABEL_ENCRYPTED + PEM_END

const GITHUB_FINEGRAINED_PREFIX = 'github_pat_'
const GITHUB_FINEGRAINED_BODY = 'oS4SCCcMUyCuISeWAAGy6OeEqu62Gi0CKwaEIqAAAA'
const SYNTHETIC_GITHUB_FINEGRAINED_BARE =
  GITHUB_FINEGRAINED_PREFIX + GITHUB_FINEGRAINED_BODY

const GHO_TOKEN_PREFIX = 'gho_'
const GHO_TOKEN_BODY = 'x'.repeat(36)
const SYNTHETIC_GHO_TOKEN = GHO_TOKEN_PREFIX + GHO_TOKEN_BODY

const AWS_ACCESS_KEY_PREFIX = 'AKIA'
const AWS_ACCESS_KEY_BODY = 'IOSFODNN7EXAMPLE'
const SYNTHETIC_AWS_ACCESS_KEY = AWS_ACCESS_KEY_PREFIX + AWS_ACCESS_KEY_BODY

const SUPABASE_SECRET_PREFIX = 'sb_secret_'
const SUPABASE_SECRET_BODY = 'x'.repeat(40)
const SYNTHETIC_SUPABASE_SECRET_KEY =
  SUPABASE_SECRET_PREFIX + SUPABASE_SECRET_BODY

const SYNTHETIC_SERVICE_ROLE_JWT = buildSyntheticJwt({
  role: 'service_role',
  iss: 'ps403-selftest'
})
const SYNTHETIC_ANON_JWT = buildSyntheticJwt({
  role: 'anon',
  iss: 'ps403-selftest'
})
const SYNTHETIC_DEMO_SERVICE_ROLE_JWT = buildSyntheticJwt({
  role: 'service_role',
  iss: 'supabase-demo'
})

// VARNAME= patterns keep their prefix; value-shaped ones are deliberately bare.
const PATTERN_FIXTURES: Record<string, string> = {
  'Supabase service role key': `SUPABASE_SERVICE_ROLE_KEY=${SYNTHETIC_SERVICE_ROLE_JWT}`,
  'Supabase anon key': `NEXT_PUBLIC_SUPABASE_ANON_KEY=${SYNTHETIC_ANON_JWT}`,
  'Resend API key': 'RESEND_API_KEY=re_wOQQi0KyWQSa4CqwcWsKI6Ig4YK2iamM6',
  'Discord bot token':
    'DISCORD_BOT_TOKEN=4gaSMyqces2QkkwcsCK4S8SEIAmmGQiwcS8koS.selftest',
  'Discord webhook':
    'https://discord.com/api/webhooks/98765432109876543/IgIqmGa0oaawSGUy9CkSY0Sm0EqMcyUoK8Kqu2Ku',
  'GitHub personal access token':
    'GITHUB_TOKEN=github_pat_ggS84SCCcMUyCuISeWAAGy6OeEqu62Gi0CKwaEIq', // trufflehog:ignore -- self-test fixture
  'Vercel access token': 'VERCEL_TOKEN=YOG8UcyGwAa6ASqKGGkQCqKo6secQm0CICGI',
  'Generic bearer secret': 'API_KEY=sk_MKOK8IIigoIs9Uqq040kYAUKOIacs4oAY',
  'GitHub classic personal access token': SYNTHETIC_CLASSIC_PAT,
  'PEM private key': SYNTHETIC_PEM_HEADER,
  'Bare service-role JWT': SYNTHETIC_SERVICE_ROLE_JWT,
  'GitHub fine-grained personal access token (bare)':
    SYNTHETIC_GITHUB_FINEGRAINED_BARE,
  'GitHub OAuth or server-to-server token': SYNTHETIC_GHO_TOKEN,
  'AWS access key ID': SYNTHETIC_AWS_ACCESS_KEY,
  'Supabase secret key': SYNTHETIC_SUPABASE_SECRET_KEY
}

const SELFTEST_FIXTURE_PATH = 'ps403-selftest-fixture.txt'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`self-test failed: ${message}`)
}

function selfTestScanTrackedPath(): void {
  const csv = scanTrackedPath('scripts/security/tokens.csv')
  assert(
    csv.length === 1 && csv[0]?.pattern === 'Tracked sensitive CSV filename',
    `tokens.csv should produce one 'Tracked sensitive CSV filename' finding, got ${JSON.stringify(csv)}`
  )

  const alsoSensitive = scanTrackedPath('data/exports/api_keys.csv')
  assert(
    alsoSensitive.length === 1 &&
      alsoSensitive[0]?.pattern === 'Tracked sensitive CSV filename',
    `api_keys.csv should produce a sensitive-CSV finding, got ${JSON.stringify(alsoSensitive)}`
  )

  const maintenance = scanTrackedPath('scripts/maintenance/roster.csv')
  assert(
    maintenance.length === 1 &&
      maintenance[0]?.pattern === 'Tracked maintenance CSV export',
    `scripts/maintenance/*.csv should produce a maintenance-CSV finding, got ${JSON.stringify(maintenance)}`
  )

  const clean = scanTrackedPath('scripts/security/check-secrets.ts')
  assert(
    clean.length === 0,
    `an ordinary path should produce no finding, got ${JSON.stringify(clean)}`
  )

  const trackedSecretFile = scanTrackedPath('.env.local')
  assert(
    trackedSecretFile.length === 1 &&
      trackedSecretFile[0]?.pattern.startsWith('Gitignored secret file'),
    `a tracked .env.local should still be flagged, got ${JSON.stringify(trackedSecretFile)}`
  )

  const backedUpCsv = scanTrackedPath('scripts/security/keys.csv.bak')
  assert(
    backedUpCsv.length === 1 &&
      backedUpCsv[0]?.pattern === 'Tracked sensitive CSV filename',
    `keys.csv.bak should produce a sensitive-CSV finding, got ${JSON.stringify(backedUpCsv)}`
  )
}

function selfTestSecretPatterns(): void {
  const liveNames = new Set(SECRET_PATTERNS.map((pattern) => pattern.name))

  for (const expected of EXPECTED_PATTERN_NAMES) {
    assert(
      liveNames.has(expected),
      `pattern '${expected}' is missing from SECRET_PATTERNS (removed or renamed)`
    )
  }

  for (const name of EXPECTED_PATTERN_NAMES) {
    const fixture = PATTERN_FIXTURES[name]
    assert(fixture !== undefined, `no fixture registered for pattern '${name}'`)

    const findings = scanContent(SELFTEST_FIXTURE_PATH, fixture)
    assert(
      findings.some((finding) => finding.pattern === name),
      `pattern '${name}' did not fire on its own fixture: ${JSON.stringify(fixture)}`
    )
  }
}

function selfTestPrecisionControls(): void {
  const anonFindings = scanContent(SELFTEST_FIXTURE_PATH, SYNTHETIC_ANON_JWT)
  assert(
    !anonFindings.some((f) => f.pattern === 'Bare service-role JWT'),
    'an anon-role JWT with no VARNAME= prefix must not match "Bare service-role JWT"'
  )

  const demoFindings = scanContent(
    SELFTEST_FIXTURE_PATH,
    SYNTHETIC_DEMO_SERVICE_ROLE_JWT
  )
  assert(
    !demoFindings.some((f) => f.pattern === 'Bare service-role JWT'),
    'a supabase-demo service-role JWT must remain exempt under the bare pattern'
  )

  const shortPat = scanContent(
    SELFTEST_FIXTURE_PATH,
    CLASSIC_PAT_PREFIX + CLASSIC_PAT_BODY.slice(0, -1)
  )
  assert(
    !shortPat.some((f) => f.pattern === 'GitHub classic personal access token'),
    'a 35-character classic-PAT body must not match the 36-character pattern'
  )

  const clean = scanContent(
    SELFTEST_FIXTURE_PATH,
    'this is an ordinary line of source with no secrets in it'
  )
  assert(clean.length === 0, 'ordinary text must not produce any finding')

  const encryptedPemFindings = scanContent(
    SELFTEST_FIXTURE_PATH,
    SYNTHETIC_ENCRYPTED_PEM_HEADER
  )
  assert(
    encryptedPemFindings.some((f) => f.pattern === 'PEM private key'),
    'a "-----BEGIN ENCRYPTED PRIVATE KEY-----" header must match "PEM private key"'
  )
}

function selfTest(): void {
  try {
    selfTestScanTrackedPath()
    selfTestSecretPatterns()
    selfTestPrecisionControls()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  console.log(
    `✅  check-secrets self-test passed (${EXPECTED_PATTERN_NAMES.length} patterns).`
  )
}

const command = process.argv[2]

if (command === '--selftest') {
  selfTest()
} else if (command === undefined) {
  main().catch((error) => {
    console.error('Secret scan failed:', error)
    process.exit(1)
  })
} else {
  console.error('usage: check-secrets.ts [--selftest]')
  process.exit(2)
}
