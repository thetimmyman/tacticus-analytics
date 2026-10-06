#!/usr/bin/env node
/**
 * Gate for authenticated-write-census.json (authenticated write grants and
 * their revoke/keep decisions) against callers, migration and pgTAP. Usage: --selftest | --scan | --writers
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const CENSUS_PATH = path.join(HERE, 'authenticated-write-census.json')
// Every migration that revokes census tables; together they name the 'revoke' set.
const MIGRATION_PATHS = [
  'supabase/migrations/20260925080000_ps218_revoke_authenticated_write_grants.sql',
  'supabase/migrations/20261006120000_revoke_discord_dispatch_write_grants.sql',
  'supabase/migrations/20261006130000_revoke_guild_war_import_write_grants.sql'
].map((rel) => path.join(REPO_ROOT, rel))
const PGTAP_PATH = path.join(
  REPO_ROOT,
  'supabase/tests/pgtap/authenticated_write_grants.sql'
)

// `db()` is the cookie-bound (authenticated) client and `serviceDb()` the
// service-role client; a write is classified by which one its receiver came from.
const SERVICE_RHS =
  /serviceDb\s*\(|createServiceClient\s*\(|SUPABASE_SERVICE_ROLE_KEY|getServiceClient\s*\(|createSupabaseClient\s*\(/
const REQUEST_RHS =
  /\bawait\s+db\s*\(\s*\)|\bdbClient\s*\(\s*\)|createBrowserClient\s*\(|createAuthenticatedDataClient\s*\(|storageClient\s*\(|await\s+createClient\s*\(\s*\)/
const WRITE_VERB = /\.(insert|upsert|update|delete)\s*[(<]/

// The Discord interactions dispatcher hands every command handler the client
// that route.ts builds; PROVENANCE_RULES re-checks that it is serviceDb().
const DISCORD_DISPATCH_DIR = 'app/api/discord/interactions/command-handlers/'
const DISCORD_DISPATCH_ROUTE = 'app/api/discord/interactions/route.ts'

// The guild-war ingestor's exported entry point is reached by exactly one
// non-test route, which builds its client with serviceDb(); PROVENANCE_RULES
// re-checks that premise. The module also writes guild_war_battles,
// guild_war_lineups and guild_war_participation under the same proof, but
// this rule stays scoped to the tables this census sweep actually judges --
// widening it to the module's other tables is a separate decision.
const GUILD_WAR_INGESTOR_MODULE = 'app/lib/war/guild-war-ingestor.ts'
const GUILD_WAR_IMPORT_ROUTE = 'app/api/guild-war/import/route.ts'
const GUILD_WAR_IMPORT_TABLES = new Set([
  'guild_war_zones',
  'guild_war_matches',
  'guild_war_player_attempts'
])

/** Claims behind the name-only attribution rules; --scan re-verifies each. */
const PROVENANCE_RULES = [
  {
    kind: 'SERVICE(edge)',
    claim:
      'supabase/functions/** only ever builds a client from _shared/supabase-client.ts, which uses SUPABASE_SERVICE_ROLE_KEY; no ANON_KEY appears anywhere under supabase/functions/.',
    verify: () =>
      grepAbsent(/ANON_KEY/, (f) => f.startsWith('supabase/functions/'))
  },
  {
    kind: 'SERVICE(param-type)',
    claim:
      "a receiver declared `x: ServiceSupabaseClient` is service-role ONLY when no file casts a value to that type and reaches the receiver's module: the alias is plain TypedSupabaseClient, so the annotation proves nothing on its own. The sync worker chain that uses it enters at app/api/sync/worker/route.ts, which builds its client with serviceDb(). A module reachable from a file containing `as ... ServiceSupabaseClient` through modules that declare a ServiceSupabaseClient parameter is cast-tainted, and its param-type writes stay UNKNOWN.",
    verify: () =>
      /serviceDb\s*\(/.test(readIfPresent('app/api/sync/worker/route.ts'))
  },
  {
    kind: 'SERVICE(test-admin)',
    claim:
      'a receiver declared `x: MinimalClient` under tests/integration/helpers/ is service-role: both callers (tests/integration/rls/rls.test.ts, tests/integration/gdpr/gdpr.test.ts) construct it from SUPABASE_SERVICE_ROLE_KEY.',
    verify: () =>
      /SUPABASE_SERVICE_ROLE_KEY/.test(
        readIfPresent('tests/integration/rls/rls.test.ts')
      ) &&
      /SUPABASE_SERVICE_ROLE_KEY/.test(
        readIfPresent('tests/integration/gdpr/gdpr.test.ts')
      )
  },
  {
    kind: 'SERVICE(discord-dispatch)',
    claim: `a receiver declared \`x: Supabase\` in a non-test module under ${DISCORD_DISPATCH_DIR} is service-role: ${DISCORD_DISPATCH_ROUTE} builds the client the dispatcher passes down with serviceDb(), and no non-test module that reaches a command handler through value imports (the handlers themselves, the route, and every direct or transitive importer such as the Discord chart routes) builds a request client.`,
    verify: () => discordDispatchIsServiceOnly(trackedFiles(), readIfPresent)
  },
  {
    kind: 'SERVICE(guild-war-import)',
    claim: `a receiver declared \`x: TypedSupabaseClient\` in ${GUILD_WAR_INGESTOR_MODULE}, writing one of {${[...GUILD_WAR_IMPORT_TABLES].join(', ')}}, is service-role: the only non-test module that imports ${GUILD_WAR_INGESTOR_MODULE} through value imports is ${GUILD_WAR_IMPORT_ROUTE}, which builds its client with serviceDb() and passes it to ingestGuildWar(...), and no non-test module that reaches the ingestor through value imports (that route and every direct or transitive importer) builds a request client.`,
    verify: () => guildWarIngestorIsServiceOnly(trackedFiles(), readIfPresent)
  }
]

function readIfPresent(rel) {
  const abs = path.join(REPO_ROOT, rel)
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : ''
}

function grepAbsent(pattern, filter) {
  for (const rel of trackedFiles()) {
    if (!filter(rel)) continue
    if (pattern.test(readIfPresent(rel))) return false
  }
  return true
}

let TRACKED = null
function trackedFiles() {
  if (TRACKED) return TRACKED
  TRACKED = execFileSync(
    'git',
    ['-C', REPO_ROOT, 'ls-files', '*.ts', '*.tsx', '*.js', '*.mjs'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
    .split('\n')
    .filter(Boolean)
    // Its --selftest fixtures are not call sites.
    .filter(
      (rel) => rel !== 'scripts/security/check-authenticated-write-census.mjs'
    )
  return TRACKED
}

function scanSource(rel, text, ctx = {}) {
  const out = []
  const lines = text.split('\n')
  const castTainted = ctx.castTainted ?? new Set()
  for (let i = 0; i < lines.length; i++) {
    const sites = [
      ...lines[i].matchAll(
        /\.from\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\)/g
      )
    ]
    if (sites.length === 0) continue
    const withRecv = [
      ...lines[i].matchAll(
        /([A-Za-z0-9_$.\][]+)\s*\.from\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\)/g
      )
    ]
    for (const site of sites) {
      const table = site[1]
      const window = lines.slice(i, i + 7).join('\n')
      let after = window.slice(window.indexOf(site[0]) + site[0].length)
      // Stop at the next `.from(` so a later chain's write is not attributed here.
      const nextFrom = after.indexOf('.from(')
      if (nextFrom !== -1) after = after.slice(0, nextFrom)
      const verb = after.match(WRITE_VERB)
      if (!verb) {
        // Follow a stored query builder alias until the name is re-bound.
        const alias = lines[i].match(
          /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:await\s+)?([A-Za-z0-9_$.\][]+)\s*\.from\(/
        )
        if (!alias) continue
        const aliasRecv = alias[2]
        const name = escapeRegExp(alias[1])
        const rest = lines.slice(i + 1).join('\n')
        const rebind = rest.search(
          new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`)
        )
        const scope = rebind === -1 ? rest : rest.slice(0, rebind)
        const use = new RegExp(
          `\\b${name}\\s*\\.\\s*(insert|upsert|update|delete)\\s*[(<]`,
          'g'
        )
        for (const m of scope.matchAll(use)) {
          const useLine = i + 2 + scope.slice(0, m.index).split('\n').length - 1
          out.push({
            table,
            file: rel,
            line: useLine,
            verb: m[1],
            client: classify(rel, text, lines, i, aliasRecv, castTainted, table)
          })
        }
        continue
      }

      let recv = withRecv.find((x) => x[2] === table)?.[1] ?? null
      if (!recv) {
        for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
          const tail = lines[j].match(/([A-Za-z0-9_$]+)\s*$/)
          if (tail) {
            recv = tail[1]
            break
          }
        }
      }

      out.push({
        table,
        file: rel,
        line: i + 1,
        verb: verb[1],
        client: classify(rel, text, lines, i, recv, castTainted, table)
      })
    }
  }
  return out
}

function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

function classify(
  rel,
  text,
  lines,
  lineIndex,
  recv,
  castTainted = new Set(),
  table = null
) {
  if (rel.startsWith('supabase/functions/')) return 'SERVICE(edge)'
  if (!recv) return 'UNKNOWN'
  const base = escapeRegExp(recv.split('.')[0])

  // Nearest preceding binding wins: a file may reuse a name for both clients.
  for (let j = lineIndex; j >= 0; j--) {
    const assign = lines[j].match(
      new RegExp(`\\b(?:const|let|var)\\s+${base}\\b[^=]*=\\s*(.*)$`)
    )
    if (!assign) continue
    const rhs = assign[1] + '\n' + lines.slice(j + 1, j + 3).join('\n')
    if (SERVICE_RHS.test(rhs)) return 'SERVICE'
    if (REQUEST_RHS.test(rhs)) return 'REQUEST'
    return 'UNKNOWN'
  }

  // Injected clients: only the two parameter types in PROVENANCE_RULES decide;
  // anything else stays UNKNOWN and keeps its grant.
  if (new RegExp(`\\b${base}\\s*:\\s*ServiceSupabaseClient\\b`).test(text)) {
    // If any caller casts to this alias, the annotation proves nothing.
    return castTainted.has(rel)
      ? 'UNKNOWN(param-type-cast)'
      : 'SERVICE(param-type)'
  }
  if (
    rel.startsWith('tests/integration/helpers/') &&
    new RegExp(`\\b${base}\\s*:\\s*MinimalClient\\b`).test(text)
  ) {
    return 'SERVICE(test-admin)'
  }
  if (
    rel.startsWith(DISCORD_DISPATCH_DIR) &&
    !isTestFile(rel) &&
    new RegExp(`\\b${base}\\s*:\\s*Supabase\\b`).test(text)
  ) {
    return 'SERVICE(discord-dispatch)'
  }
  if (
    rel === GUILD_WAR_INGESTOR_MODULE &&
    table !== null &&
    GUILD_WAR_IMPORT_TABLES.has(table) &&
    new RegExp(`\\b${base}\\s*:\\s*TypedSupabaseClient\\b`).test(text)
  ) {
    return 'SERVICE(guild-war-import)'
  }

  const service = SERVICE_RHS.test(text)
  const request = REQUEST_RHS.test(text)
  if (service && !request) return 'SERVICE(file)'
  if (request && !service) return 'REQUEST(file)'
  return 'UNKNOWN'
}

/** The suite's census_swept array and the `-- census_kept_policy` / `-- census_kept_undecided` arrays. */
function pgtapLists(sql) {
  const out = {}
  const grab = (key, re) => {
    const m = sql.match(re)
    if (!m) return
    out[key] = new Set(
      [...m[1].matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)].map((x) => x[1])
    )
  }
  grab(
    'census_swept',
    /INSERT INTO census_swept \(relname\) SELECT unnest\(ARRAY\[([\s\S]*?)\]::text\[\]\)/
  )
  grab('census_kept_policy', /-- census_kept_policy\n([\s\S]*?)\]::text\[\]/)
  grab(
    'census_kept_undecided',
    /-- census_kept_undecided\n([\s\S]*?)\]::text\[\]/
  )
  return out
}

function isServiceClient(client) {
  return client.startsWith('SERVICE')
}

const SERVICE_CAST = /\bas\s+(?:unknown\s+as\s+)?ServiceSupabaseClient\b/

function resolveImport(fromRel, spec, tracked) {
  let base
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('.'))
    base = path.posix.normalize(
      path.posix.join(path.posix.dirname(fromRel), spec)
    )
  else return null
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`
  ]) {
    if (tracked.has(cand)) return cand
  }
  return null
}

function valueImports(rel, text, tracked) {
  const out = []
  const re =
    /^\s*import\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]|^\s*export\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm
  for (const m of text.matchAll(re)) {
    const hit = resolveImport(rel, m[1] ?? m[2], tracked)
    if (hit) out.push(hit)
  }
  return out
}

const SERVICE_PARAM = /\b[A-Za-z_$][A-Za-z0-9_$]*\s*:\s*ServiceSupabaseClient\b/

function isTestFile(rel) {
  return /^tests\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)
}

/** The SERVICE(discord-dispatch) premise: the dispatcher's client is serviceDb() and no request client reaches it. */
function discordDispatchIsServiceOnly(files, read) {
  if (!/serviceDb\s*\(/.test(read(DISCORD_DISPATCH_ROUTE))) return false
  const tracked = new Set(files)
  const importers = new Map()
  for (const rel of files) {
    if (isTestFile(rel)) continue
    for (const dep of valueImports(rel, read(rel), tracked)) {
      if (!importers.has(dep)) importers.set(dep, [])
      importers.get(dep).push(rel)
    }
  }
  // Every non-test module that reaches a command handler, directly or through
  // other modules, could hand it a client; none of them may build a request one.
  const seen = new Set()
  const queue = files.filter(
    (rel) => rel.startsWith(DISCORD_DISPATCH_DIR) && !isTestFile(rel)
  )
  queue.push(DISCORD_DISPATCH_ROUTE)
  while (queue.length > 0) {
    const rel = queue.pop()
    if (seen.has(rel)) continue
    seen.add(rel)
    if (REQUEST_RHS.test(read(rel))) return false
    queue.push(...(importers.get(rel) ?? []))
  }
  return true
}

/** Position of the char matching the '(' at `openIndex`, skipping quoted strings; -1 if unmatched. */
function balancedParensEnd(text, openIndex) {
  let depth = 0
  let quote = null
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Position of the char matching the '{' at `openIndex`, skipping quoted strings; -1 if unmatched. */
function balancedBraceEnd(text, openIndex) {
  let depth = 0
  let quote = null
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * The function body's opening '{' after a parameter list's closing ')',
 * skipping an optional `: ReturnType` annotation -- which may itself hold
 * braces and generics, e.g. `): Promise<{ a: string }> {` -- by tracking
 * paren/bracket/brace/angle depth until a '{' at depth 0.
 */
function findBodyOpenBrace(text, fromIndex) {
  let depth = 0
  for (let i = fromIndex; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{' && depth === 0) return i
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === '>' && depth > 0) depth--
  }
  return -1
}

/** Splits a parameter or argument list on its top-level commas (depth- and quote-aware). */
function splitTopLevelArgs(text) {
  const out = []
  let depth = 0
  let current = ''
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      current += ch
      if (ch === quote && text[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    if (ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim() !== '' || out.length > 0) out.push(current)
  return out
}

/** Every named `function` declaration's name, parameter text and body span. */
function parseFunctionRanges(text) {
  const ranges = []
  const fnRe =
    /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g
  for (const m of text.matchAll(fnRe)) {
    const openParen = text.indexOf('(', m.index)
    const closeParen = balancedParensEnd(text, openParen)
    if (closeParen === -1) continue
    const bodyStart = findBodyOpenBrace(text, closeParen + 1)
    if (bodyStart === -1) continue
    const bodyEnd = balancedBraceEnd(text, bodyStart)
    if (bodyEnd === -1) continue
    ranges.push({
      name: m[1],
      paramsText: text.slice(openParen + 1, closeParen),
      bodyStart,
      bodyEnd
    })
  }
  return ranges
}

/** The innermost parsed function range whose body contains `index`, or null at module scope. */
function enclosingFunctionRange(ranges, index) {
  let best = null
  for (const r of ranges) {
    if (index < r.bodyStart || index > r.bodyEnd) continue
    if (!best || r.bodyEnd - r.bodyStart < best.bodyEnd - best.bodyStart) {
      best = r
    }
  }
  return best
}

/** Every call to `fnName(...)` in `text` (its own declaration header excluded), with split args. */
function calleeCallSites(text, fnName) {
  const nameEsc = escapeRegExp(fnName)
  const callRe = new RegExp(`\\b${nameEsc}\\s*\\(`, 'g')
  const sites = []
  for (const m of text.matchAll(callRe)) {
    const before = text.slice(Math.max(0, m.index - 20), m.index)
    if (/\bfunction\s+$/.test(before)) continue
    const openIdx = m.index + m[0].length - 1
    const closeIdx = balancedParensEnd(text, openIdx)
    if (closeIdx === -1) continue
    sites.push({
      index: m.index,
      args: splitTopLevelArgs(text.slice(openIdx + 1, closeIdx))
    })
  }
  return sites
}

/**
 * True when the value bound to `id` at `beforeIndex` is provably serviceDb():
 * either a direct `const|let <id> = serviceDb()` in the same enclosing
 * function body (module scope if none), or -- when `id` is instead that
 * function's own parameter -- every call to the function passes serviceDb()
 * (inline, or by this same proof recursively) in the matching argument
 * position. Anything it cannot resolve this way fails closed (false).
 */
function identifierTracesToServiceDb(text, ranges, id, beforeIndex, visited) {
  const idEsc = escapeRegExp(id)
  const fn = enclosingFunctionRange(ranges, beforeIndex)
  const scopeStart = fn ? fn.bodyStart : 0
  const bindRe = new RegExp(
    `\\b(?:const|let|var)\\s+${idEsc}\\b[^=]*=\\s*([^\\n;]*)`,
    'g'
  )
  let lastBind = null
  for (const m of text.slice(scopeStart, beforeIndex).matchAll(bindRe)) {
    lastBind = m
  }
  if (lastBind) return /serviceDb\s*\(\s*\)/.test(lastBind[1])
  if (fn) {
    const params = splitTopLevelArgs(fn.paramsText)
    const paramIndex = params.findIndex((p) =>
      new RegExp(`^\\s*${idEsc}\\b`).test(p)
    )
    if (paramIndex !== -1) {
      return callSitesPassServiceDb(text, ranges, fn.name, paramIndex, visited)
    }
  }
  return false
}

/** Every call to `fnName(...)` passes serviceDb() (inline or traced) at `argIndex`; none found fails closed. */
function callSitesPassServiceDb(text, ranges, fnName, argIndex, visited) {
  const key = `${fnName}#${argIndex}`
  if (visited.has(key)) return false
  visited.add(key)
  const sites = calleeCallSites(text, fnName)
  if (sites.length === 0) return false
  for (const site of sites) {
    const arg = (site.args[argIndex] ?? '').trim()
    if (/^serviceDb\s*\(\s*\)$/.test(arg)) continue
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(arg)) return false
    if (!identifierTracesToServiceDb(text, ranges, arg, site.index, visited)) {
      return false
    }
  }
  return true
}

/**
 * True when every `ingestGuildWar(...)` call in `text` passes, as its first
 * argument, a value `identifierTracesToServiceDb` can trace to serviceDb().
 * No call site at all, or any call it cannot trace, fails closed (false) --
 * a route that builds serviceDb() for an unrelated purpose while handing the
 * ingestor a client from an unrecognized helper no longer passes.
 */
function ingestGuildWarCallsAreServiceOnly(text) {
  const ranges = parseFunctionRanges(text)
  const sites = calleeCallSites(text, 'ingestGuildWar')
  if (sites.length === 0) return false
  for (const site of sites) {
    const arg = (site.args[0] ?? '').trim()
    if (/^serviceDb\s*\(\s*\)$/.test(arg)) continue
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(arg)) return false
    if (
      !identifierTracesToServiceDb(text, ranges, arg, site.index, new Set())
    ) {
      return false
    }
  }
  return true
}

/** The SERVICE(guild-war-import) premise: every ingestGuildWar(...) call in the route is provably fed serviceDb(), and no non-test module that reaches it through value imports builds a request client. */
function guildWarIngestorIsServiceOnly(files, read) {
  if (!ingestGuildWarCallsAreServiceOnly(read(GUILD_WAR_IMPORT_ROUTE))) {
    return false
  }
  const tracked = new Set(files)
  const importers = new Map()
  for (const rel of files) {
    if (isTestFile(rel)) continue
    for (const dep of valueImports(rel, read(rel), tracked)) {
      if (!importers.has(dep)) importers.set(dep, [])
      importers.get(dep).push(rel)
    }
  }
  // Every non-test module that reaches the ingestor, directly or through
  // other modules, could hand it a client; none of them may build a request one.
  // The route is seeded directly (like the module itself) so a fixture or a
  // future caller that imports nothing still gets checked.
  const seen = new Set()
  const queue = [GUILD_WAR_INGESTOR_MODULE, GUILD_WAR_IMPORT_ROUTE]
  while (queue.length > 0) {
    const rel = queue.pop()
    if (seen.has(rel)) continue
    seen.add(rel)
    if (REQUEST_RHS.test(read(rel))) return false
    queue.push(...(importers.get(rel) ?? []))
  }
  return true
}

/** Modules a ServiceSupabaseClient cast reaches via typed params; annotation proves nothing there. */
function castTaintedModules(files, read) {
  const tracked = new Set(files)
  const seen = new Set()
  const queue = []
  for (const rel of files) {
    if (isTestFile(rel)) continue
    const text = read(rel)
    if (!SERVICE_CAST.test(text)) continue
    queue.push(...valueImports(rel, text, tracked))
  }
  while (queue.length > 0) {
    const rel = queue.pop()
    if (seen.has(rel)) continue
    const text = read(rel)
    if (!SERVICE_PARAM.test(text)) continue
    seen.add(rel)
    queue.push(...valueImports(rel, text, tracked))
  }
  return seen
}

function scanTree() {
  const byTable = new Map()
  const castTainted = castTaintedModules(trackedFiles(), readIfPresent)
  for (const rel of trackedFiles()) {
    for (const hit of scanSource(rel, readIfPresent(rel), { castTainted })) {
      if (!byTable.has(hit.table)) byTable.set(hit.table, [])
      byTable.get(hit.table).push(hit)
    }
  }
  return byTable
}

function scan() {
  const census = JSON.parse(fs.readFileSync(CENSUS_PATH, 'utf8'))
  const errors = []
  const writers = scanTree()

  for (const rule of PROVENANCE_RULES) {
    if (!rule.verify()) {
      errors.push(
        `the provenance claim behind the ${rule.kind} attribution rule no longer holds: ${rule.claim}`
      )
    }
  }

  const revoke = []
  const keepUndecided = []
  const keepPolicy = []
  for (const [table, row] of Object.entries(census.tables)) {
    if (row.decision === 'revoke') revoke.push(table)
    else if (row.decision === 'keep-undecided') keepUndecided.push(table)
    else if (row.decision === 'keep-policy-governed') keepPolicy.push(table)
    else errors.push(`${table}: unknown decision '${row.decision}'`)
  }

  for (const table of revoke) {
    const live = (writers.get(table) ?? []).filter(
      (h) => !isServiceClient(h.client)
    )
    for (const h of live) {
      errors.push(
        `${table} was swept by the authenticated-write revoke (authenticated holds no INSERT/UPDATE/DELETE on it) but ` +
          `${h.file}:${h.line} now writes it (.${h.verb}) on a client this scan cannot prove is ` +
          `service-role (${h.client}). That write will fail with "permission denied", not silently ` +
          `affect zero rows. Move it to serviceDb(), or re-judge the table and update ` +
          `scripts/security/authenticated-write-census.json and the revoke migration together.`
      )
    }
  }

  for (const table of keepUndecided) {
    const live = (writers.get(table) ?? []).filter(
      (h) => !isServiceClient(h.client)
    )
    if (live.length === 0) {
      errors.push(
        `${table} is recorded as 'keep-undecided' -- its grant was left alone only because a ` +
          `committed write site could not be proved service-role -- but no such site exists any ` +
          `more. Re-judge it: either sweep it (move it to 'revoke' and add it to the revoke ` +
          `migration and pgTAP suite) or record why it stays.`
      )
    }
  }

  const named = new Set()
  for (const abs of MIGRATION_PATHS) {
    const rel = path.relative(REPO_ROOT, abs)
    const migration = readIfPresent(rel)
    if (!migration) {
      errors.push(`migration not found: ${rel}`)
      continue
    }
    for (const m of migration.matchAll(
      /^\s*'([a-zA-Z_][a-zA-Z0-9_]*)',?\s*(?:--.*)?$/gm
    )) {
      if (named.has(m[1]))
        errors.push(`${m[1]} is named by more than one revoke migration`)
      named.add(m[1])
    }
  }
  for (const t of revoke) {
    if (!named.has(t))
      errors.push(
        `${t} is 'revoke' in the census but no revoke migration names it`
      )
  }
  for (const t of named) {
    if (!revoke.includes(t))
      errors.push(
        `a revoke migration names ${t}, which the census does not mark 'revoke'`
      )
  }

  const pgtap = readIfPresent(path.relative(REPO_ROOT, PGTAP_PATH))
  if (!pgtap) {
    errors.push(
      `pgTAP suite not found: ${path.relative(REPO_ROOT, PGTAP_PATH)}`
    )
  } else {
    const lists = pgtapLists(pgtap)
    const expected = {
      census_swept: revoke,
      census_kept_policy: keepPolicy,
      census_kept_undecided: keepUndecided
    }
    for (const [list, want] of Object.entries(expected)) {
      const got = lists[list]
      if (!got) {
        errors.push(`the authenticated-write pgTAP suite has no ${list} list`)
        continue
      }
      for (const t of want)
        if (!got.has(t))
          errors.push(
            `${t} is in the census set for ${list} but the authenticated-write pgTAP suite does not list it there`
          )
      for (const t of got)
        if (!want.includes(t))
          errors.push(
            `the authenticated-write pgTAP suite lists ${t} in ${list}, which the census does not`
          )
    }
  }

  if (errors.length > 0) {
    console.error('authenticated-write census: FAIL')
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  console.log(
    `authenticated-write census: OK -- ${revoke.length} swept, ` +
      `${keepUndecided.length} left undecided, ${keepPolicy.length} policy-governed ` +
      `(${revoke.length + keepUndecided.length + keepPolicy.length} tables carried the grant at ` +
      `migration head ${census.acl_snapshot.migration_head}).`
  )
  console.log(
    '  this lane judges the source tree only; the ACL half is judged by ' +
      'supabase/tests/pgtap/authenticated_write_grants.sql against a replayed schema, ' +
      'and neither lane can see production ACLs.'
  )
}

const FIXTURES = [
  {
    name: 'service-role write is attributed to service_role',
    rel: 'app/lib/x.ts',
    src: `const supabase = serviceDb()\nawait supabase.from('census_fixture_table').insert({ a: 1 })\n`,
    expect: (h) => h.length === 1 && h[0].client === 'SERVICE'
  },
  {
    name: 'request-client write is attributed to authenticated',
    rel: 'app/lib/x.ts',
    src: `const supabase = await db()\nawait supabase.from('census_fixture_table').upsert({ a: 1 })\n`,
    expect: (h) => h.length === 1 && h[0].client === 'REQUEST'
  },
  {
    name: 'the nearest binding wins when one file reuses the name',
    rel: 'app/lib/x.ts',
    src:
      `const supabase = await db()\nawait supabase.from('a').select()\n` +
      `const supabase2 = serviceDb()\nawait supabase2.from('census_fixture_table').delete()\n`,
    expect: (h) => h.length === 1 && h[0].client === 'SERVICE'
  },
  {
    name: 'an injected client of unknown provenance stays UNKNOWN',
    rel: 'app/lib/x.ts',
    src: `export async function f(supabase: TypedSupabaseClient) {\n  await supabase.from('census_fixture_table').update({ a: 1 })\n}\n`,
    expect: (h) => h.length === 1 && h[0].client === 'UNKNOWN'
  },
  {
    name: 'a ServiceSupabaseClient parameter is service-role',
    rel: 'app/lib/x.ts',
    src: `export async function f(supabase: ServiceSupabaseClient) {\n  await supabase.from('census_fixture_table').update({ a: 1 })\n}\n`,
    expect: (h) => h.length === 1 && h[0].client === 'SERVICE(param-type)'
  },
  {
    name: 'a Supabase parameter in a Discord command handler is service-role',
    rel: 'app/api/discord/interactions/command-handlers/handlers/x.ts',
    src: `export async function f(supabase: Supabase) {\n  await supabase.from('census_fixture_table').delete()\n}\n`,
    expect: (h) => h.length === 1 && h[0].client === 'SERVICE(discord-dispatch)'
  },
  {
    name: 'a Supabase parameter outside the Discord dispatcher stays UNKNOWN',
    rel: 'app/lib/x.ts',
    src: `export async function f(supabase: Supabase) {\n  await supabase.from('census_fixture_table').delete()\n}\n`,
    expect: (h) => h.length === 1 && h[0].client === 'UNKNOWN'
  },
  {
    name: 'a SupabaseClient parameter in a Discord command handler stays UNKNOWN',
    rel: 'app/api/discord/interactions/command-handlers/handlers/x.ts',
    src: `export async function f(supabase: SupabaseClient) {\n  await supabase.from('census_fixture_table').delete()\n}\n`,
    expect: (h) => h.length === 1 && h[0].client === 'UNKNOWN'
  },
  {
    name: 'a TypedSupabaseClient parameter in the guild-war ingestor, writing a swept table, is service-role',
    rel: GUILD_WAR_INGESTOR_MODULE,
    src: `async function ingestWar(supabase: TypedSupabaseClient) {\n  await supabase.from('guild_war_zones').upsert({ a: 1 })\n}\n`,
    expect: (h) => h.length === 1 && h[0].client === 'SERVICE(guild-war-import)'
  },
  {
    name: 'a TypedSupabaseClient parameter in the guild-war ingestor, writing a table outside this rule, stays UNKNOWN',
    rel: GUILD_WAR_INGESTOR_MODULE,
    src: `async function ingestWar(supabase: TypedSupabaseClient) {\n  await supabase.from('guild_war_battles').upsert({ a: 1 })\n}\n`,
    expect: (h) => h.length === 1 && h[0].client === 'UNKNOWN'
  },
  {
    name: 'a TypedSupabaseClient parameter outside the guild-war ingestor stays UNKNOWN even for a swept table',
    rel: 'app/lib/x.ts',
    src: `export async function f(supabase: TypedSupabaseClient) {\n  await supabase.from('guild_war_zones').upsert({ a: 1 })\n}\n`,
    expect: (h) => h.length === 1 && h[0].client === 'UNKNOWN'
  },
  {
    name: 'an edge function write is service-role',
    rel: 'supabase/functions/f/index.ts',
    src: `await supabase.from('census_fixture_table').insert({ a: 1 })\n`,
    expect: (h) => h.length === 1 && h[0].client === 'SERVICE(edge)'
  },
  {
    name: 'a read is not a write',
    rel: 'app/lib/x.ts',
    src: `const supabase = await db()\nawait supabase.from('census_fixture_table').select('*')\n`,
    expect: (h) => h.length === 0
  },
  {
    name: 'a write split across lines is still found',
    rel: 'app/lib/x.ts',
    src: `const supabase = await db()\nawait supabase\n  .from('census_fixture_table')\n  .insert({ a: 1 })\n`,
    expect: (h) => h.length === 1 && h[0].client === 'REQUEST'
  },
  {
    name: 'a write through a stored query builder is found',
    rel: 'app/lib/x.ts',
    src:
      `const supabase = await db()\nconst tbl = supabase.from('census_fixture_table')\n` +
      `const { data } = await tbl.select('id')\n\n\n\n\n\n\n\n` +
      `await tbl\n  .update({ a: 1 })\n  .eq('id', 1)\n`,
    expect: (h) =>
      h.length === 1 &&
      h[0].client === 'REQUEST' &&
      h[0].verb === 'update' &&
      h[0].line === 11
  },
  {
    name: 'a query-builder alias stops at its re-binding',
    rel: 'app/lib/x.ts',
    src:
      `const supabase = await db()\nconst tbl = supabase.from('census_fixture_table')\n` +
      `await tbl.select('id')\n}\nfunction g() {\nconst tbl = other.from('unrelated')\nawait tbl.delete()\n`,
    expect: (h) =>
      h.every((x) => x.table !== 'census_fixture_table') &&
      h.some((x) => x.table === 'unrelated' && x.verb === 'delete')
  },
  {
    name: 'a ServiceSupabaseClient parameter in a cast-tainted module is UNKNOWN',
    rel: 'app/lib/x.ts',
    ctx: { castTainted: new Set(['app/lib/x.ts']) },
    src: `export async function f(supabase: ServiceSupabaseClient) {\n  await supabase.from('census_fixture_table').insert({ a: 1 })\n}\n`,
    expect: (h) => h.length === 1 && h[0].client === 'UNKNOWN(param-type-cast)'
  }
]

const TAINT_FIXTURES = [
  {
    name: 'a db() client cast to ServiceSupabaseClient taints the module it is passed into',
    files: {
      'app/api/r/route.ts': `import { db } from '@/app/lib/db'\nimport { f } from '@/app/lib/w'\nconst s = await db()\nawait f(s as unknown as ServiceSupabaseClient)\n`,
      'app/lib/w.ts': `export async function f(supabase: ServiceSupabaseClient) {}\n`,
      'app/lib/db.ts': `export const db = 1\n`
    },
    expect: (t) => t.has('app/lib/w.ts') && !t.has('app/lib/db.ts')
  },
  {
    name: 'taint follows ServiceSupabaseClient-typed helpers transitively',
    files: {
      'app/api/r/route.ts': `import { f } from '../../lib/w'\nf(x as ServiceSupabaseClient)\n`,
      'app/lib/w.ts': `import { g } from './v'\nexport async function f(supabase: ServiceSupabaseClient) { await g(supabase) }\n`,
      'app/lib/v.ts': `export async function g(client: ServiceSupabaseClient) {}\n`
    },
    expect: (t) => t.has('app/lib/w.ts') && t.has('app/lib/v.ts')
  },
  {
    name: 'a unit test casting a mock does not taint anything',
    files: {
      'tests/unit/w.test.ts': `import { f } from '@/app/lib/w'\nf(mock as unknown as ServiceSupabaseClient)\n`,
      'app/lib/w.ts': `export async function f(supabase: ServiceSupabaseClient) {}\n`
    },
    expect: (t) => t.size === 0
  },
  {
    name: 'no cast anywhere taints nothing',
    files: {
      'app/api/r/route.ts': `import { f } from '@/app/lib/w'\nf(serviceDb())\n`,
      'app/lib/w.ts': `export async function f(supabase: ServiceSupabaseClient) {}\n`
    },
    expect: (t) => t.size === 0
  }
]

const DISPATCH_FIXTURES = [
  {
    name: 'the Discord dispatcher on serviceDb() is service-only',
    files: {
      'app/api/discord/interactions/route.ts': `import { serviceDb } from '@/app/lib/db'\nimport { h } from './command-handlers/index'\nconst supabase = serviceDb()\n`,
      'app/api/discord/interactions/command-handlers/index.ts': `export { h } from './handlers/x'\n`,
      'tests/unit/x.test.ts': `import { h } from '@/app/api/discord/interactions/command-handlers/index'\nconst s = await db()\n`
    },
    expect: (ok) => ok === true
  },
  {
    name: 'a request client in the dispatcher route voids the premise',
    files: {
      'app/api/discord/interactions/route.ts': `const supabase = serviceDb()\nconst other = await db()\n`
    },
    expect: (ok) => ok === false
  },
  {
    name: 'a transitive command-handlers importer with a request client voids the dispatcher premise',
    files: {
      'app/api/discord/interactions/route.ts': `const supabase = serviceDb()\n`,
      'app/api/discord/interactions/command-handlers/handlers/x.ts': `export async function h(supabase: Supabase) {}\n`,
      'app/lib/y.ts': `export { h } from '@/app/api/discord/interactions/command-handlers/handlers/x'\n`,
      'app/api/z/route.ts': `import { h } from '@/app/lib/y'\nconst s = await db()\nawait h(s)\n`
    },
    expect: (ok) => ok === false
  },
  {
    name: 'a request client in an unrelated Discord route does not void the dispatcher premise',
    files: {
      'app/api/discord/interactions/route.ts': `const supabase = serviceDb()\n`,
      'app/api/discord/verified/route.ts': `const callerDb = await db()\n`
    },
    expect: (ok) => ok === true
  },
  {
    name: 'a dispatcher route without serviceDb() voids the premise',
    files: {
      'app/api/discord/interactions/route.ts': `const supabase = makeClient()\n`
    },
    expect: (ok) => ok === false
  }
]

const GUILD_WAR_IMPORT_FIXTURES = [
  {
    name: 'the guild-war import route on serviceDb() is service-only',
    files: {
      [GUILD_WAR_IMPORT_ROUTE]: `import { serviceDb } from '@/app/lib/db'\nimport { ingestGuildWar } from '@/app/lib/war/guild-war-ingestor'\nconst supabase = serviceDb()\nawait ingestGuildWar(supabase, [], [], ctx)\n`,
      [GUILD_WAR_INGESTOR_MODULE]: `export async function ingestGuildWar(supabase) {}\n`,
      'app/lib/war/guild-war-ingestor.test.ts': `import { ingestGuildWar } from './guild-war-ingestor'\nconst s = await db()\n`
    },
    expect: (ok) => ok === true
  },
  {
    name: 'a request client in the import route voids the premise',
    files: {
      [GUILD_WAR_IMPORT_ROUTE]: `const supabase = serviceDb()\nconst other = await db()\n`
    },
    expect: (ok) => ok === false
  },
  {
    name: 'a transitive importer of the ingestor with a request client voids the premise',
    files: {
      [GUILD_WAR_IMPORT_ROUTE]: `const supabase = serviceDb()\nawait ingestGuildWar(supabase, [], [], ctx)\n`,
      [GUILD_WAR_INGESTOR_MODULE]: `export async function ingestGuildWar(supabase) {}\n`,
      'app/lib/y.ts': `export { ingestGuildWar } from '@/app/lib/war/guild-war-ingestor'\n`,
      'app/api/z/route.ts': `import { ingestGuildWar } from '@/app/lib/y'\nconst s = await db()\nawait ingestGuildWar(s)\n`
    },
    expect: (ok) => ok === false
  },
  {
    name: 'a request client in an unrelated guild-war route does not void the premise',
    files: {
      [GUILD_WAR_IMPORT_ROUTE]: `const supabase = serviceDb()\nawait ingestGuildWar(supabase, [], [], ctx)\n`,
      'app/api/guild-war/status/route.ts': `const callerDb = await db()\n`
    },
    expect: (ok) => ok === true
  },
  {
    name: 'an import route without serviceDb() voids the premise',
    files: {
      [GUILD_WAR_IMPORT_ROUTE]: `const supabase = makeClient()\nawait ingestGuildWar(supabase, [], [], ctx)\n`
    },
    expect: (ok) => ok === false
  },
  {
    name: 'an unrelated serviceDb() call elsewhere in the route does not prove the ingestor receives it',
    files: {
      [GUILD_WAR_IMPORT_ROUTE]: `const supabase = serviceDb()\nasync function doImport() {\n  const client = buildClient()\n  await ingestGuildWar(client, [], [], ctx)\n}\n`
    },
    expect: (ok) => ok === false
  },
  {
    name: 'the client passed inline as serviceDb() proves the premise',
    files: {
      [GUILD_WAR_IMPORT_ROUTE]: `await ingestGuildWar(serviceDb(), [], [], ctx)\n`
    },
    expect: (ok) => ok === true
  },
  {
    name: 'the real shape -- a helper parameter fed by serviceDb() at its only call site -- proves the premise',
    files: {
      [GUILD_WAR_IMPORT_ROUTE]: `async function handleRawLokiImport(supabase: TypedSupabaseClient, guildCode: string) {\n  const result = await ingestGuildWar(supabase, [], [], ctx)\n}\n\nexport const POST = withErrorHandler(async (request) => {\n  const result = await handleRawLokiImport(serviceDb(), guildCode)\n})\n`
    },
    expect: (ok) => ok === true
  }
]

function selftest() {
  let failed = 0
  for (const f of FIXTURES) {
    const hits = scanSource(f.rel, f.src, f.ctx)
    if (f.expect(hits)) {
      console.log(`  ok   ${f.name}`)
    } else {
      failed += 1
      console.error(
        `  FAIL ${f.name} -- got ${JSON.stringify(hits.map((h) => [h.client, h.verb, h.line]))}`
      )
    }
  }
  {
    // Prove the parser tells the three lists apart and reads each completely.
    const lists = pgtapLists(
      `INSERT INTO census_swept (relname) SELECT unnest(ARRAY[\n    'a',\n    'b'\n  ]::text[]);\n` +
        `SELECT relname, 'keep-policy-governed' FROM unnest(ARRAY[ -- census_kept_policy\n    'c'\n  ]::text[]) AS relname;\n` +
        `SELECT relname, 'keep-undecided' FROM unnest(ARRAY[ -- census_kept_undecided\n    'd',\n    'e'\n  ]::text[]) AS relname;\n`
    )
    const ok =
      [...lists.census_swept].join() === 'a,b' &&
      [...lists.census_kept_policy].join() === 'c' &&
      [...lists.census_kept_undecided].join() === 'd,e'
    if (ok) console.log('  ok   the pgTAP suite lists are parsed apart')
    else {
      failed += 1
      console.error('  FAIL the pgTAP suite lists are parsed apart')
    }
  }
  for (const f of TAINT_FIXTURES) {
    const tainted = castTaintedModules(
      Object.keys(f.files),
      (rel) => f.files[rel] ?? ''
    )
    if (f.expect(tainted)) {
      console.log(`  ok   ${f.name}`)
    } else {
      failed += 1
      console.error(`  FAIL ${f.name} -- got ${JSON.stringify([...tainted])}`)
    }
  }

  for (const f of DISPATCH_FIXTURES) {
    const ok = discordDispatchIsServiceOnly(
      Object.keys(f.files),
      (rel) => f.files[rel] ?? ''
    )
    if (f.expect(ok)) {
      console.log(`  ok   ${f.name}`)
    } else {
      failed += 1
      console.error(`  FAIL ${f.name} -- got ${ok}`)
    }
  }

  for (const f of GUILD_WAR_IMPORT_FIXTURES) {
    const ok = guildWarIngestorIsServiceOnly(
      Object.keys(f.files),
      (rel) => f.files[rel] ?? ''
    )
    if (f.expect(ok)) {
      console.log(`  ok   ${f.name}`)
    } else {
      failed += 1
      console.error(`  FAIL ${f.name} -- got ${ok}`)
    }
  }

  try {
    const census = JSON.parse(fs.readFileSync(CENSUS_PATH, 'utf8'))
    const decisions = new Set(
      Object.values(census.tables).map((r) => r.decision)
    )
    for (const d of decisions) {
      if (!['revoke', 'keep-undecided', 'keep-policy-governed'].includes(d)) {
        failed += 1
        console.error(`  FAIL census carries an unknown decision: ${d}`)
      }
    }
    console.log(
      `  ok   census parses (${Object.keys(census.tables).length} tables)`
    )
  } catch (error) {
    failed += 1
    console.error(`  FAIL census does not parse: ${error.message}`)
  }

  if (failed > 0) {
    console.error(`authenticated-write census selftest: FAIL (${failed})`)
    process.exit(1)
  }
  console.log('authenticated-write census selftest: OK')
}

const mode = process.argv[2]
if (mode === '--selftest') selftest()
else if (mode === '--scan') scan()
else if (mode === '--writers') {
  const byTable = scanTree()
  console.log(JSON.stringify(Object.fromEntries([...byTable].sort()), null, 1))
} else {
  console.error(
    'usage: check-authenticated-write-census.mjs --selftest | --scan | --writers'
  )
  process.exit(2)
}
