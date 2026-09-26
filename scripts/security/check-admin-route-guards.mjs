#!/usr/bin/env node
// Every `app/api/admin/**` route must use `withAdminGuards`, which applies the rate
// limiter and an explicit guard kind (`requireRoleForApi('leader')` admits any guild leader).
// Usage: --census | --scan | --selftest

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const ADMIN_API_DIR = path.join('app', 'api', 'admin')

const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS'
]

// Delegating routes are checked in the factory file; the map is explicit.
const DELEGATED_FACTORIES = {
  createRemoveAccessGrantHandler: path.join(
    ADMIN_API_DIR,
    '_remove-access-grant-route.ts'
  )
}

// Kept in sync with with-admin-guards.ts; the self-test pins the list.
const APP_ADMIN_GUARDS = new Set([
  'app-admin',
  'app-admin-user-id',
  'app-admin-session'
])
const GUARD_KINDS = new Set([...APP_ADMIN_GUARDS, 'guild-role', 'in-handler'])

const LEGACY_GUARDS = [
  ['requireAppAdminForApi', 'app-admin'],
  ['requireCurrentAppAdminForApi', 'app-admin-session'],
  ['requireAppAdminUserIdForApi', 'app-admin-user-id'],
  ['requireAppAdmin', 'app-admin-user-id'],
  ['requireRoleForApi', 'guild-role'],
  ['requireActiveMembershipForApi', 'active-membership'],
  ['requireAuthForApi', 'auth-only'],
  ['requireSessionUser', 'session-only']
]

const RATE_LIMIT_CALLS = [
  'withAdminGuards',
  'apiSecurityMiddleware',
  'checkRateLimit',
  'rateLimit('
]

function listRouteFiles(dir = path.join(ROOT, ADMIN_API_DIR)) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listRouteFiles(full))
    else if (entry.name === 'route.ts') out.push(path.relative(ROOT, full))
  }
  return out.sort()
}

// Only bare-token literals are kept, so a string quoting
// `withAdminGuards({ guard: 'app-admin' })` cannot make a route look guarded.
const BARE_VALUE_LITERAL = /^[A-Za-z0-9_@./:-]*$/

/** Closing-quote index or -1; `'`/`"` stop at a newline so a stray apostrophe cannot blank the file. */
function findStringEnd(source, open) {
  const quote = source[open]
  for (let i = open + 1; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '\\') {
      i += 1
      continue
    }
    if (ch === quote) return i
    if (ch === '\n' && quote !== '`') return -1
  }
  return -1
}

function stripNonCode(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const two = source.slice(i, i + 2)
    if (two === '//') {
      while (i < source.length && source[i] !== '\n') {
        i += 1
      }
      continue
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      out += source.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    const ch = source[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = findStringEnd(source, i)
      if (end === -1) {
        out += ch
        i += 1
        continue
      }
      const body = source.slice(i + 1, end)
      // Template literals are always blanked: `${}` can hold arbitrary code shape.
      const keep = ch !== '`' && BARE_VALUE_LITERAL.test(body)
      out += ch + (keep ? body : body.replace(/[^\n]/g, ' ')) + source[end]
      i = end + 1
      continue
    }
    i += 1
    out += source[i - 1]
  }
  return out
}

/** Per exported method: wrapper, declared guard kind and whether the limiter is reached. */
export function analyseRoute(
  relPath,
  readFile = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
) {
  const raw = readFile(relPath)
  const source = stripNonCode(raw)

  const exports = []
  const exportRe = new RegExp(
    `export\\s+(?:const|async\\s+function|function)\\s+(${HTTP_METHODS.join('|')})\\b`,
    'g'
  )
  let match
  while ((match = exportRe.exec(source)) !== null) {
    exports.push({ method: match[1], start: match.index })
  }

  const usesLimiterDirectly = RATE_LIMIT_CALLS.some(
    (call) => call !== 'withAdminGuards' && source.includes(call)
  )

  const results = exports.map((exp, index) => {
    const end =
      index + 1 < exports.length ? exports[index + 1].start : source.length
    const body = source.slice(exp.start, end)

    let delegate = null
    for (const [factory, factoryPath] of Object.entries(DELEGATED_FACTORIES)) {
      if (body.includes(`${factory}(`)) delegate = factoryPath
    }

    const scope = delegate ? stripNonCode(readFile(delegate)) : body
    const wrapped = /withAdminGuards\s*\(/.test(scope)

    const fileScope = delegate ? stripNonCode(readFile(delegate)) : source
    const byIdentifier = scope.match(/withAdminGuards\(\s*([A-Z_][A-Z0-9_]*)\b/)
    const optionsText =
      byIdentifier && !/guard:/.test(scope)
        ? (fileScope.match(
            new RegExp(`const\\s+${byIdentifier[1]}\\s*=\\s*\\{[^}]*\\}`)
          )?.[0] ?? scope)
        : scope

    const guardMatch = optionsText.match(/guard:\s*'([a-z-]+)'/)
    const minRoleMatch = optionsText.match(/minRole:\s*'([A-Za-z]+)'/)

    let guard = wrapped && guardMatch ? guardMatch[1] : null
    if (!guard) {
      for (const [call, kind] of LEGACY_GUARDS) {
        if (new RegExp(`\\b${call}\\s*\\(`).test(scope)) {
          guard = kind
          if (kind === 'guild-role' && !minRoleMatch) {
            const roleArg = scope.match(
              new RegExp(`\\b${call}\\s*\\(\\s*'([A-Za-z]+)'`)
            )
            if (roleArg) guard = `guild-role:${roleArg[1]}`
          }
          break
        }
      }
    } else if (guard === 'guild-role' && minRoleMatch) {
      guard = `guild-role:${minRoleMatch[1]}`
    }

    return {
      method: exp.method,
      guard: guard ?? 'none',
      wrapped,
      delegate,
      rateLimited: wrapped || usesLimiterDirectly
    }
  })

  return { file: relPath, handlers: results }
}

export function census(files = listRouteFiles()) {
  const rows = files.map((file) => {
    const { handlers } = analyseRoute(file)
    const guards = [...new Set(handlers.map((h) => h.guard))]
    return {
      file,
      methods: handlers.map((h) => h.method),
      guards,
      wrapped: handlers.length > 0 && handlers.every((h) => h.wrapped),
      rateLimited: handlers.length > 0 && handlers.every((h) => h.rateLimited)
    }
  })

  return {
    total: rows.length,
    rateLimited: rows.filter((r) => r.rateLimited).length,
    wrapped: rows.filter((r) => r.wrapped).length,
    rows
  }
}

export function violations(result = census()) {
  const problems = []
  for (const row of result.rows) {
    if (row.methods.length === 0) {
      problems.push(`${row.file}: no exported HTTP handler found`)
      continue
    }
    if (!row.wrapped) {
      problems.push(
        `${row.file}: handler(s) ${row.methods.join('/')} are not wrapped in withAdminGuards — ` +
          `the '/api/admin/' rate-limit bucket and the declared guard are both skipped`
      )
      continue
    }
    for (const guard of row.guards) {
      const kind = guard.split(':')[0]
      if (!GUARD_KINDS.has(kind)) {
        problems.push(`${row.file}: unknown guard kind '${guard}'`)
      }
    }
  }
  return problems
}

function formatTable(result) {
  const lines = []
  const width = Math.max(...result.rows.map((r) => r.file.length), 4)
  lines.push(
    `${'route'.padEnd(width)}  ${'methods'.padEnd(16)}  ${'guard'.padEnd(24)}  limiter`
  )
  lines.push('-'.repeat(width + 54))
  for (const row of result.rows) {
    lines.push(
      `${row.file.padEnd(width)}  ${row.methods.join(',').padEnd(16)}  ${row.guards
        .join(',')
        .padEnd(24)}  ${row.rateLimited ? 'yes' : 'NO'}`
    )
  }
  lines.push('')
  lines.push(
    `${result.rateLimited} of ${result.total} routes apply the '/api/admin/' rate limiter`
  )
  lines.push(`${result.wrapped} of ${result.total} routes use withAdminGuards`)
  return lines.join('\n')
}

function selftest() {
  const fixtures = {
    'fixture/wrapped.ts':
      "export const GET = withAdminGuards({ guard: 'app-admin' }, async () => NextResponse.json({}))",
    'fixture/guild.ts':
      "export const POST = withAdminGuards({ guard: 'guild-role', minRole: 'officer', reason: 'own guild' }, async () => NextResponse.json({}))",
    'fixture/legacy.ts':
      "export const POST = withErrorHandler(async () => { await requireRoleForApi('leader'); return NextResponse.json({}) })",
    'fixture/bare.ts': 'export const GET = async () => NextResponse.json({})',
    'fixture/commented.ts':
      "// export const GET = withAdminGuards({ guard: 'app-admin' }, handler)\nexport const POST = async () => NextResponse.json({})",
    'fixture/stringified.ts':
      'export const GET = async () => NextResponse.json({ hint: "withAdminGuards({ guard: \'app-admin\' })" })',
    'fixture/template.ts':
      "export const GET = async () => NextResponse.json({ hint: `withAdminGuards({ guard: 'app-admin' })` })",
    'fixture/wrapped-with-string.ts':
      'const HINT = "call withAdminGuards({ guard: \'app-admin\' }) first"\n' +
      "export const GET = withAdminGuards({ guard: 'app-admin' }, async () => NextResponse.json({ HINT }))"
  }
  const read = (p) => fixtures[p]
  const checks = [
    [
      'wrapped route detected',
      () =>
        analyseRoute('fixture/wrapped.ts', read).handlers[0].guard ===
        'app-admin'
    ],
    [
      'wrapped route counts as rate limited',
      () => analyseRoute('fixture/wrapped.ts', read).handlers[0].rateLimited
    ],
    [
      'guild-role guard keeps its role',
      () =>
        analyseRoute('fixture/guild.ts', read).handlers[0].guard ===
        'guild-role:officer'
    ],
    [
      'legacy guild-role guard detected',
      () =>
        analyseRoute('fixture/legacy.ts', read).handlers[0].guard ===
        'guild-role:leader'
    ],
    [
      'legacy route is NOT rate limited',
      () =>
        analyseRoute('fixture/legacy.ts', read).handlers[0].rateLimited ===
        false
    ],
    [
      'unguarded route reports none',
      () => analyseRoute('fixture/bare.ts', read).handlers[0].guard === 'none'
    ],
    [
      'commented-out wrapper does not count',
      () =>
        analyseRoute('fixture/commented.ts', read).handlers[0].wrapped === false
    ],
    [
      'a string literal quoting the wrapper does NOT count as wrapped',
      () =>
        analyseRoute('fixture/stringified.ts', read).handlers[0].wrapped ===
        false
    ],
    [
      'a string literal quoting the wrapper leaves the guard at none',
      () =>
        analyseRoute('fixture/stringified.ts', read).handlers[0].guard ===
        'none'
    ],
    [
      'a string literal quoting the wrapper is NOT counted as rate limited',
      () =>
        analyseRoute('fixture/stringified.ts', read).handlers[0].rateLimited ===
        false
    ],
    [
      'a template literal quoting the wrapper does NOT count as wrapped',
      () =>
        analyseRoute('fixture/template.ts', read).handlers[0].wrapped === false
    ],
    [
      'a real wrapper still resolves when the file also quotes it in a string',
      () =>
        analyseRoute('fixture/wrapped-with-string.ts', read).handlers[0]
          .guard === 'app-admin'
    ],
    [
      'violations flags an unwrapped route',
      () =>
        violations({
          rows: [
            {
              file: 'f',
              methods: ['GET'],
              guards: ['none'],
              wrapped: false,
              rateLimited: false
            }
          ]
        }).length === 1
    ],
    [
      'violations accepts a wrapped route',
      () =>
        violations({
          rows: [
            {
              file: 'f',
              methods: ['GET'],
              guards: ['app-admin'],
              wrapped: true,
              rateLimited: true
            }
          ]
        }).length === 0
    ]
  ]

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
      'usage: check-admin-route-guards.mjs [--census] [--scan] [--selftest]'
    )
    process.exit(2)
  }

  if (wantSelftest && !selftest()) {
    process.exit(1)
  }

  if (wantCensus || wantScan) {
    const result = census()
    if (wantCensus) console.log(formatTable(result))
    if (wantScan) {
      const problems = violations(result)
      if (problems.length > 0) {
        console.error('\napp/api/admin route guard violations:')
        for (const problem of problems) console.error(`  - ${problem}`)
        console.error(
          '\nEvery app/api/admin/**/route.ts handler must be wrapped in withAdminGuards ' +
            '(app/api/admin/_lib/with-admin-guards.ts).'
        )
        process.exit(1)
      }
      console.log(
        `admin route guards OK: ${result.wrapped}/${result.total} routes wrapped, ` +
          `${result.rateLimited}/${result.total} rate limited`
      )
    }
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
