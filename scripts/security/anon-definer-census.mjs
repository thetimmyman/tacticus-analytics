#!/usr/bin/env node
// Census and ratchet of anon EXECUTE on SECURITY DEFINER functions (reachable
// unauthenticated via /rpc/), replayed from migrations; fails when the set grows.
// Usage: --census | --json | --check (default) | --update | --selftest

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()
const MIGRATIONS_DIR = 'supabase/migrations'
const ALLOWLIST_PATH = 'config/anon-definer-allowlist.json'

// Blank everything but executable DDL (comments, literals, dollar bodies): grants in bodies are data,
// and commented-out rollback GRANTs must not re-open revoked functions.
export function stripNonCode(sql) {
  let out = ''
  let i = 0
  const keepNewlines = (from, to) => {
    for (let k = from; k < to; k += 1) out += sql[k] === '\n' ? '\n' : ' '
  }

  while (i < sql.length) {
    const two = sql.slice(i, i + 2)

    if (two === '--') {
      const nl = sql.indexOf('\n', i)
      const stop = nl === -1 ? sql.length : nl
      keepNewlines(i, stop)
      i = stop
      continue
    }

    if (two === '/*') {
      let depth = 0
      let j = i
      while (j < sql.length) {
        if (sql.slice(j, j + 2) === '/*') {
          depth += 1
          j += 2
          continue
        }
        if (sql.slice(j, j + 2) === '*/') {
          depth -= 1
          j += 2
          if (depth === 0) break
          continue
        }
        j += 1
      }
      keepNewlines(i, j)
      i = j
      continue
    }

    if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2
          continue
        }
        if (sql[j] === "'") {
          j += 1
          break
        }
        j += 1
      }
      // Keep an empty literal so COMMENT ON ... IS '...' still parses.
      out += "''"
      keepNewlines(i + 2, j)
      i = j
      continue
    }

    const dollar = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i))
    if (dollar) {
      const tag = dollar[0]
      const end = sql.indexOf(tag, i + tag.length)
      const stop = end === -1 ? sql.length : end + tag.length
      // Delimiters survive so CREATE FUNCTION stays one statement.
      out += tag
      keepNewlines(i + tag.length, stop - tag.length)
      out += tag
      i = stop
      continue
    }

    out += sql[i]
    i += 1
  }

  return out
}

function splitStatements(code) {
  return code
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

// Baseline, ACL line and hand migrations spell a signature three ways; all must collapse to one key.

// Only used to tell a parameter name from the start of a type.
const TYPE_FIRST_WORDS = new Set([
  'anyarray',
  'anycompatible',
  'anyelement',
  'anyenum',
  'anynonarray',
  'anyrange',
  'bigint',
  'bit',
  'bool',
  'boolean',
  'box',
  'bytea',
  'char',
  'character',
  'cidr',
  'circle',
  'citext',
  'date',
  'daterange',
  'decimal',
  'double',
  'float4',
  'float8',
  'inet',
  'int',
  'int2',
  'int4',
  'int8',
  'integer',
  'internal',
  'interval',
  'json',
  'jsonb',
  'line',
  'lseg',
  'macaddr',
  'money',
  'name',
  'numeric',
  'numrange',
  'oid',
  'path',
  'point',
  'polygon',
  'real',
  'record',
  'regclass',
  'regproc',
  'regprocedure',
  'regtype',
  'serial',
  'smallint',
  'text',
  'time',
  'timestamp',
  'timestamptz',
  'timetz',
  'tsquery',
  'tsrange',
  'tstzrange',
  'tsvector',
  'uuid',
  'varchar',
  'void',
  'xml'
])

const TYPE_ALIASES = new Map([
  ['bool', 'boolean'],
  ['decimal', 'numeric'],
  ['float4', 'real'],
  ['float8', 'double precision'],
  ['int', 'integer'],
  ['int2', 'smallint'],
  ['int4', 'integer'],
  ['int8', 'bigint'],
  ['timestamptz', 'timestamp with time zone'],
  ['timetz', 'time with time zone'],
  ['varchar', 'character varying'],
  ['timestamp', 'timestamp without time zone'],
  ['time', 'time without time zone']
])

// Split on top-level commas so `numeric(10,2)` survives.
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth += 1
    if (ch === ')' || ch === ']') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim().length > 0) parts.push(current)
  return parts.map((part) => part.trim()).filter((part) => part.length > 0)
}

export function normaliseArgType(rawArg) {
  let arg = rawArg.trim()

  arg = arg.replace(/\s+DEFAULT\s+[\s\S]*$/i, '').replace(/\s*=\s*[\s\S]*$/, '')
  arg = arg.replace(/^(?:IN|OUT|INOUT|VARIADIC)\s+/i, '')
  arg = arg.trim()
  if (arg.length === 0) return ''

  const tokens = arg.split(/\s+/)
  const first = tokens[0].toLowerCase()
  // A single token or a qualified first token is always the type.
  if (
    tokens.length > 1 &&
    !TYPE_FIRST_WORDS.has(first.replace(/\(.*$/, '')) &&
    !first.includes('.')
  ) {
    tokens.shift()
  }

  let type = tokens.join(' ').trim()
  type = type.replace(/\(([^()]*)\)/g, '')
  // The migrations write `public.` both ways for the same enum.
  type = type.replace(/\bpublic\./gi, '')
  type = type.replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

  // One dimension at a time: a single lazy regex backtracks exponentially (redos).
  const ARRAY_DIM_RE = /\s*\[\s*\d*\s*\]$/
  let dimensions = 0
  while (ARRAY_DIM_RE.test(type)) {
    type = type.replace(ARRAY_DIM_RE, '')
    dimensions += 1
  }
  type = type.trim()
  const suffix = '[]'.repeat(dimensions)

  return (TYPE_ALIASES.get(type) ?? type) + suffix
}

export function makeKey(name, argText) {
  const args = splitTopLevel(argText ?? '')
    .map(normaliseArgType)
    .filter((arg) => arg.length > 0)
  return `public.${name.toLowerCase()}(${args.join(', ')})`
}

function readSignature(text, start) {
  const nameMatch =
    /^(?:public\s*\.\s*)?("?[A-Za-z_][A-Za-z0-9_$]*"?)\s*\(/.exec(
      text.slice(start)
    )
  if (!nameMatch) return null
  const name = nameMatch[1].replace(/"/g, '')
  let i = start + nameMatch[0].length
  let depth = 1
  const argStart = i
  while (i < text.length && depth > 0) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') depth -= 1
    i += 1
  }
  if (depth !== 0) return null
  return { name, argText: text.slice(argStart, i - 1), end: i }
}

const ROLE_SPLIT = /\s*,\s*/

function parseRoles(list) {
  return list
    .split(ROLE_SPLIT)
    .map((role) => role.trim().replace(/"/g, '').toLowerCase())
    .filter((role) => role.length > 0)
}

// PostgREST cannot call trigger/event_trigger functions or ones taking `internal`.
function isPostgrestReachable(fn) {
  if (/^(?:trigger|event_trigger)$/i.test(fn.returns ?? '')) return false
  if (fn.key.includes('internal')) return false
  return true
}

export function censusFromFiles(files) {
  /** @type {Map<string, {key:string,name:string,definer:boolean,returns:string,anon:boolean,publicExecute:boolean,definedIn:string,aclTouchedIn:string[]}>} */
  const functions = new Map()
  const unmatchedGrants = []
  const unmatchedRevokes = []

  for (const { file, sql } of files) {
    const code = stripNonCode(sql)

    for (const statement of splitStatements(code)) {
      const compact = statement.replace(/\s+/g, ' ').trim()

      const create = /^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+/i.exec(compact)
      if (create) {
        const signature = readSignature(compact, create[0].length)
        if (!signature) continue
        const key = makeKey(signature.name, signature.argText)
        const tail = compact.slice(signature.end)
        const returnsMatch =
          /\bRETURNS\s+(?:SETOF\s+)?(?:public\.)?([A-Za-z_][A-Za-z0-9_]*)/i.exec(
            tail
          )
        const definer = /\bSECURITY\s+DEFINER\b/i.test(tail)
        const existing = functions.get(key)
        if (existing) {
          existing.definer = definer
          if (returnsMatch) existing.returns = returnsMatch[1].trim()
        } else {
          functions.set(key, {
            key,
            name: signature.name.toLowerCase(),
            definer,
            returns: returnsMatch ? returnsMatch[1].trim() : '',
            // Both defaults are live: PUBLIC gets EXECUTE on new functions and the baseline grants it to anon.
            anon: true,
            publicExecute: true,
            definedIn: file,
            aclTouchedIn: []
          })
        }
        continue
      }

      const alter = /^ALTER\s+FUNCTION\s+/i.exec(compact)
      if (alter) {
        const signature = readSignature(compact, alter[0].length)
        if (!signature) continue
        const fn = functions.get(makeKey(signature.name, signature.argText))
        if (!fn) continue
        if (/\bSECURITY\s+INVOKER\b/i.test(compact)) fn.definer = false
        else if (/\bSECURITY\s+DEFINER\b/i.test(compact)) fn.definer = true
        continue
      }

      const drop = /^DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?/i.exec(compact)
      if (drop) {
        const signature = readSignature(compact, drop[0].length)
        if (!signature) continue
        functions.delete(makeKey(signature.name, signature.argText))
        continue
      }

      // A schema-wide grant applies to the functions that exist when it runs.
      const schemaWide =
        /^(GRANT|REVOKE)\s+(GRANT\s+OPTION\s+FOR\s+)?([A-Za-z, ]+?)\s+ON\s+ALL\s+(?:FUNCTIONS|ROUTINES)\s+IN\s+SCHEMA\s+([\s\S]+)$/i.exec(
          compact
        )
      if (schemaWide) {
        const action = schemaWide[1].toUpperCase()
        const grantOptionOnly = Boolean(schemaWide[2])
        const privileges = schemaWide[3].toUpperCase()
        if (!/\bEXECUTE\b/.test(privileges) && !/\bALL\b/.test(privileges))
          continue
        if (action === 'REVOKE' && grantOptionOnly) continue
        const tail = schemaWide[4]
        const roleSplit = (
          action === 'GRANT' ? /\bTO\s+([\s\S]+)$/i : /\bFROM\s+([\s\S]+)$/i
        ).exec(tail)
        if (!roleSplit) continue
        const schemas = parseRoles(tail.slice(0, roleSplit.index))
        if (!schemas.includes('public')) continue
        const roles = parseRoles(
          roleSplit[1].replace(
            /\s+(?:WITH\s+GRANT\s+OPTION|CASCADE|RESTRICT)\s*$/i,
            ''
          )
        )
        const touchesAnon = roles.includes('anon')
        const touchesPublic = roles.includes('public')
        if (!touchesAnon && !touchesPublic) continue
        for (const fn of functions.values()) {
          if (touchesAnon) fn.anon = action === 'GRANT'
          if (touchesPublic) fn.publicExecute = action === 'GRANT'
          fn.aclTouchedIn.push(file)
        }
        continue
      }

      const acl =
        /^(GRANT|REVOKE)\s+(GRANT\s+OPTION\s+FOR\s+)?([A-Za-z, ]+?)\s+ON\s+FUNCTION\s+/i.exec(
          compact
        )
      if (!acl) continue

      const action = acl[1].toUpperCase()
      const grantOptionOnly = Boolean(acl[2])
      const privileges = acl[3].toUpperCase()
      if (!/\bEXECUTE\b/.test(privileges) && !/\bALL\b/.test(privileges))
        continue
      // REVOKE GRANT OPTION FOR leaves EXECUTE in place; a full revoke here would hide a live corridor.
      if (action === 'REVOKE' && grantOptionOnly) continue

      let cursor = acl[0].length
      const targets = []
      for (;;) {
        const signature = readSignature(compact, cursor)
        if (!signature) break
        targets.push(makeKey(signature.name, signature.argText))
        cursor = signature.end
        const comma = /^\s*,\s*/.exec(compact.slice(cursor))
        if (!comma) break
        cursor += comma[0].length
      }

      const rolesMatch = (
        action === 'GRANT' ? /\bTO\s+([\s\S]+)$/i : /\bFROM\s+([\s\S]+)$/i
      ).exec(compact.slice(cursor))
      if (!rolesMatch) continue
      const roles = parseRoles(
        rolesMatch[1].replace(
          /\s+(?:WITH\s+GRANT\s+OPTION|CASCADE|RESTRICT)\s*$/i,
          ''
        )
      )

      const touchesAnon = roles.includes('anon')
      const touchesPublic = roles.includes('public')
      if (!touchesAnon && !touchesPublic) continue

      for (const key of targets) {
        const fn = functions.get(key)
        if (!fn) {
          // Unmatched REVOKEs are expected (pruned baseline); an unmatched GRANT can
          // open an unlisted live function, so commandCheck() errors on it.
          ;(action === 'GRANT' ? unmatchedGrants : unmatchedRevokes).push(
            `${file}: ${action} to ${roles.join(', ')} on unknown function ${key}`
          )
          continue
        }
        if (touchesAnon) fn.anon = action === 'GRANT'
        if (touchesPublic) fn.publicExecute = action === 'GRANT'
        fn.aclTouchedIn.push(file)
      }
    }
  }

  const all = [...functions.values()].sort((a, b) => (a.key < b.key ? -1 : 1))
  const definers = all.filter((fn) => fn.definer)
  const anonExecutable = definers.filter((fn) => fn.anon || fn.publicExecute)
  const corridors = anonExecutable.filter(isPostgrestReachable)

  return {
    functionCount: all.length,
    definerCount: definers.length,
    anonExecutableCount: anonExecutable.length,
    corridors,
    unreachable: anonExecutable.filter((fn) => !isPostgrestReachable(fn)),
    unmatchedGrants,
    unmatchedRevokes
  }
}

// A dynamic GRANT fails when it names anon/PUBLIC or computes its role list; otherwise it is a note.
export function findDynamicAnonymousGrants(files) {
  const hits = []
  for (const { file, sql } of files) {
    sql.split(/\r?\n/).forEach((line, index) => {
      if (/^\s*--/.test(line)) return
      if (!/\bEXECUTE\s+(?:format\s*\(|')/i.test(line)) return
      if (
        !/\bGRANT\b[\s\S]*\bON\s+(?:ALL\s+(?:FUNCTIONS|ROUTINES)\s+IN\s+SCHEMA|FUNCTION)\b/i.test(
          line
        )
      )
        return
      const to = /\bTO\s+([^';]+)/i.exec(line)
      if (!to) return
      const roleText = to[1]
      const computed = /%[A-Za-z]/.test(roleText) || /\|\|/.test(roleText)
      const roles = parseRoles(
        roleText.replace(/\s+(?:WITH\s+GRANT\s+OPTION)\s*$/i, '')
      )
      const anonymous = roles.includes('anon') || roles.includes('public')
      if (!computed && !anonymous) return
      hits.push(
        `${file}:${index + 1}: ${line.trim()}` +
          (computed && !anonymous
            ? ' -- the role list is computed, so the replay cannot prove it is not anon/PUBLIC'
            : '')
      )
    })
  }
  return hits
}

export function findDynamicPrivilegeStatements(files) {
  const hits = []
  for (const { file, sql } of files) {
    sql.split(/\r?\n/).forEach((line, index) => {
      if (/^\s*--/.test(line)) return
      if (!/\bEXECUTE\s+(?:format\s*\(|')/i.test(line)) return
      if (!/(?:GRANT|REVOKE)\b[\s\S]*\bON\s+FUNCTION\b/i.test(line)) return
      hits.push(`${file}:${index + 1}: ${line.trim()}`)
    })
  }
  return hits
}

export function readMigrations(dir = MIGRATIONS_DIR) {
  const abs = path.isAbsolute(dir) ? dir : path.join(ROOT, dir)
  return fs
    .readdirSync(abs)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      file: `${dir}/${name}`,
      sql: fs.readFileSync(path.join(abs, name), 'utf8')
    }))
}

export function readAllowlist(file = ALLOWLIST_PATH) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file)
  const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
  return parsed
}

function runCensus() {
  const files = readMigrations()
  if (files.length === 0) {
    console.error(
      `anon-definer census FAILED: no .sql files under ${MIGRATIONS_DIR} — the census would be vacuously empty`
    )
    process.exit(1)
  }
  return { files, result: censusFromFiles(files) }
}

function commandCensus(asJson) {
  const { files, result } = runCensus()
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          migrations: files.length,
          functions: result.functionCount,
          securityDefiner: result.definerCount,
          anonExecutableDefiner: result.anonExecutableCount,
          postgrestReachable: result.corridors.length,
          corridors: result.corridors.map((fn) => ({
            signature: fn.key,
            via: fn.anon
              ? fn.publicExecute
                ? 'anon+PUBLIC'
                : 'anon'
              : 'PUBLIC',
            definedIn: fn.definedIn
          })),
          notReachableOverHttp: result.unreachable.map((fn) => fn.key),
          unmatchedGrants: result.unmatchedGrants,
          unmatchedRevokes: result.unmatchedRevokes
        },
        null,
        2
      )
    )
    return
  }

  console.log(`migrations replayed          ${files.length}`)
  console.log(`functions in public          ${result.functionCount}`)
  console.log(`  SECURITY DEFINER           ${result.definerCount}`)
  console.log(`  ... anon-executable        ${result.anonExecutableCount}`)
  console.log(`  ... reachable over /rpc/   ${result.corridors.length}`)
  console.log('')
  for (const fn of result.corridors) {
    const via = fn.anon ? (fn.publicExecute ? 'anon+PUBLIC' : 'anon') : 'PUBLIC'
    console.log(`${fn.key}\t${via}`)
  }
  if (result.unreachable.length > 0) {
    console.log('')
    console.log('anon-executable definers NOT reachable over PostgREST:')
    for (const fn of result.unreachable) console.log(`  ${fn.key}`)
  }
  const unmatched = [...result.unmatchedGrants, ...result.unmatchedRevokes]
  if (unmatched.length > 0) {
    console.log('')
    console.log('GRANT/REVOKE statements with no matching function:')
    for (const line of unmatched) console.log(`  ${line}`)
  }
}

// Pure function of (census, allowlist) so tests can drive it on fixtures.
export function ratchetErrors(corridors, allowlist) {
  const errors = []
  const intentional = allowlist.intentionallyPublic ?? []
  const legacy = allowlist.legacy ?? []
  const cutoff = allowlist.legacyCutoff

  const allowed = new Set([
    ...intentional.map((entry) => entry.signature),
    ...legacy
  ])
  if (allowed.size !== intentional.length + legacy.length) {
    errors.push(
      `${ALLOWLIST_PATH}: a signature appears twice — intentionallyPublic and legacy must not overlap`
    )
  }

  // A reason must name the call site; a bare signature proves nothing.
  for (const entry of intentional) {
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 40) {
      errors.push(
        `${ALLOWLIST_PATH}: ${entry.signature} is listed as intentionally public with no usable "reason" — name the logged-out call site`
      )
    }
  }

  const present = new Set(corridors.map((fn) => fn.key))
  const definedIn = new Map(corridors.map((fn) => [fn.key, fn.definedIn ?? '']))

  // `legacy` is shrink-only: functions defined after legacyCutoff cannot be parked there.
  if (typeof cutoff !== 'string' || !/^\d{8,14}$/.test(cutoff)) {
    errors.push(
      `${ALLOWLIST_PATH}: "legacyCutoff" is missing or is not a migration version; without it "legacy" can be padded with new corridors and the ratchet does not turn`
    )
  } else {
    for (const signature of legacy) {
      const file = definedIn.get(signature)
      if (!file) continue
      const version = /(\d{8,14})/.exec(path.basename(file))?.[1]
      if (version && version > cutoff) {
        errors.push(
          `${signature} is listed under "legacy" but is defined in ${file}, after the legacyCutoff ${cutoff}. ` +
            '"legacy" is the measured baseline and only shrinks: revoke anon/PUBLIC EXECUTE in the same migration, or — if a ' +
            `logged-out page really calls it — list it under "intentionallyPublic" in ${ALLOWLIST_PATH} with the call site as the reason.`
        )
      }
    }
  }

  for (const fn of corridors) {
    if (!allowed.has(fn.key)) {
      errors.push(
        `NEW anon-executable SECURITY DEFINER function: ${fn.key} (defined in ${fn.definedIn}). ` +
          'Add `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon;` to the same migration, or — if a ' +
          `logged-out page really calls it — add it to ${ALLOWLIST_PATH} under "intentionallyPublic" ` +
          'with the call site as the reason. Adding it to "legacy" is not an option: that list only shrinks.'
      )
    }
  }

  // Closed corridors must be removed so the slot cannot be reused.
  for (const signature of [...intentional.map((e) => e.signature), ...legacy]) {
    if (!present.has(signature)) {
      errors.push(
        `STALE allowlist entry: ${signature} is no longer an anon-executable SECURITY DEFINER function. ` +
          `Delete it from ${ALLOWLIST_PATH} — the baseline must shrink when a corridor closes.`
      )
    }
  }

  for (const [label, list] of [
    ['intentionallyPublic', intentional.map((entry) => entry.signature)],
    ['legacy', legacy]
  ]) {
    if (list.join('\n') !== [...list].sort().join('\n')) {
      errors.push(
        `${ALLOWLIST_PATH}: "${label}" must be sorted by signature so diffs stay readable`
      )
    }
  }

  return errors
}

function commandCheck() {
  const { files, result } = runCensus()
  const allowlist = readAllowlist()
  const errors = ratchetErrors(result.corridors, allowlist)
  const dynamic = findDynamicPrivilegeStatements(files)

  // A GRANT to anon/PUBLIC on an unseen function may open a live-only definer.
  for (const line of result.unmatchedGrants) {
    errors.push(
      `GRANT to an anonymous role on a function no migration here creates: ${line}. ` +
        'The replay cannot model it, so it cannot be ratcheted: revoke it, name the function in a migration, ' +
        'or split the grant so the anonymous role is not part of it.'
    )
  }

  for (const line of findDynamicAnonymousGrants(files)) {
    errors.push(
      `dynamic GRANT reaching an anonymous role: ${line}. ` +
        'Dynamic privilege SQL is invisible to this ratchet; issue it as ordinary DDL so the replay can see it.'
    )
  }

  if (errors.length > 0) {
    console.error('anon-definer ratchet FAILED:')
    for (const error of errors) console.error(`- ${error}`)
    process.exit(1)
  }

  console.log(
    `anon-definer ratchet passed — ${result.corridors.length} anon-executable SECURITY DEFINER ` +
      `function(s) in public reachable over PostgREST: ` +
      `${allowlist.intentionallyPublic.length} reviewed as intentionally public, ` +
      `${allowlist.legacy.length} accepted legacy (target: 0). ` +
      `${files.length} migration(s) replayed, ${result.definerCount} SECURITY DEFINER function(s) total.`
  )
  if (result.unmatchedRevokes.length > 0) {
    console.log(
      'NOTE — REVOKE statements naming a function no migration in this repository creates. ' +
        'The clean baseline is a PRUNED dump, so these are real functions the repository cannot see. ' +
        'A REVOKE can only close a corridor, so it stays informational; an unmatched GRANT is an error above.'
    )
    for (const line of result.unmatchedRevokes) console.log(`  ${line}`)
  }
  if (dynamic.length > 0) {
    console.log(
      'NOTE — privilege statements issued as dynamic SQL, which the replay cannot evaluate:'
    )
    for (const line of dynamic) console.log(`  ${line}`)
  }
  console.log(
    "SCOPE — derived from this repository's migrations only. Privileges granted outside " +
      'version control are invisible here; a live probe remains the authority on production.'
  )
}

// Only prunes; additions must be reviewed hand edits.
function commandUpdate() {
  const { result } = runCensus()
  const allowlist = readAllowlist()
  const present = new Set(result.corridors.map((fn) => fn.key))
  const beforeLegacy = allowlist.legacy.length
  const beforePublic = allowlist.intentionallyPublic.length

  allowlist.legacy = allowlist.legacy.filter((signature) =>
    present.has(signature)
  )
  allowlist.intentionallyPublic = allowlist.intentionallyPublic.filter(
    (entry) => present.has(entry.signature)
  )

  fs.writeFileSync(
    path.join(ROOT, ALLOWLIST_PATH),
    `${JSON.stringify(allowlist, null, 2)}\n`
  )
  console.log(
    `${ALLOWLIST_PATH}: pruned ${beforeLegacy - allowlist.legacy.length} legacy and ` +
      `${beforePublic - allowlist.intentionallyPublic.length} intentionally-public entr(ies); ` +
      `${allowlist.legacy.length} legacy remain. Entries are never added by this flag.`
  )
}

// Self-test: every rule in both directions on synthetic migrations.

function selfTest() {
  const fail = (message) => {
    throw new Error(message)
  }

  const DEFINER = (name, args = '', extra = 'SECURITY DEFINER') => `
CREATE FUNCTION public.${name}(${args}) RETURNS boolean
    LANGUAGE plpgsql ${extra}
    AS $$ BEGIN RETURN true; END; $$;
`

  // Positive 1: the default privileges alone make a plain CREATE a corridor.
  let census = censusFromFiles([
    { file: 'm/1.sql', sql: DEFINER('silent_corridor') }
  ])
  if (census.corridors.length !== 1)
    fail(
      'positive control 1 failed: a SECURITY DEFINER function with NO explicit ' +
        `GRANT was not counted as a corridor (${census.corridors.length}) — the ` +
        "baseline's ALTER DEFAULT PRIVILEGES makes it anon-executable on creation"
    )

  census = censusFromFiles([
    {
      file: 'm/1.sql',
      sql:
        DEFINER('closed') +
        'REVOKE EXECUTE ON FUNCTION public.closed() FROM PUBLIC, anon;\n'
    }
  ])
  if (census.corridors.length !== 0)
    fail(
      'negative control 1 failed: REVOKE ... FROM PUBLIC, anon did not close the ' +
        `corridor (${census.corridors.length} left)`
    )

  // Negative 2: anon inherits PUBLIC, so revoking only anon leaves it open.
  census = censusFromFiles([
    {
      file: 'm/1.sql',
      sql:
        DEFINER('half_closed') +
        'REVOKE EXECUTE ON FUNCTION public.half_closed() FROM anon;\n'
    }
  ])
  if (census.corridors.length !== 1)
    fail(
      'positive control 2 failed: revoking anon while PUBLIC keeps EXECUTE was ' +
        `treated as closed (${census.corridors.length}) — anon inherits PUBLIC`
    )

  census = censusFromFiles([
    { file: 'm/1.sql', sql: DEFINER('invoker_fn', '', 'SECURITY INVOKER') }
  ])
  if (census.corridors.length !== 0)
    fail(
      'negative control 3 failed: a SECURITY INVOKER function was counted as a ' +
        `corridor (${census.corridors.length}) — RLS still applies to it`
    )

  census = censusFromFiles([
    {
      file: 'm/1.sql',
      sql:
        DEFINER('rolled_back') +
        'REVOKE EXECUTE ON FUNCTION public.rolled_back() FROM PUBLIC, anon;\n' +
        '-- GRANT EXECUTE ON FUNCTION public.rolled_back() TO anon;\n'
    }
  ])
  if (census.corridors.length !== 0)
    fail(
      'negative control 4 failed: a GRANT inside a `--` rollback comment re-opened ' +
        `a revoked corridor (${census.corridors.length})`
    )

  census = censusFromFiles([
    {
      file: 'm/1.sql',
      sql:
        DEFINER('doc_only') +
        'REVOKE EXECUTE ON FUNCTION public.doc_only() FROM PUBLIC, anon;\n' +
        'CREATE FUNCTION public.helper() RETURNS text LANGUAGE plpgsql AS $$\n' +
        'BEGIN RETURN 1; -- GRANT EXECUTE ON FUNCTION public.doc_only() TO anon;\n' +
        'END; $$;\n'
    }
  ])
  if (census.corridors.length !== 0)
    fail(
      'negative control 5 failed: GRANT text inside a dollar-quoted body was read ' +
        `as a grant (${census.corridors.length})`
    )

  // Positive 3: the replay is sequential (file order, then statement order).
  census = censusFromFiles([
    {
      file: 'm/1.sql',
      sql:
        DEFINER('reopened') +
        'REVOKE EXECUTE ON FUNCTION public.reopened() FROM PUBLIC, anon;\n'
    },
    {
      file: 'm/2.sql',
      sql: 'GRANT EXECUTE ON FUNCTION public.reopened() TO anon;\n'
    }
  ])
  if (census.corridors.length !== 1)
    fail(
      'positive control 3 failed: a later GRANT did not re-open a revoked corridor ' +
        `(${census.corridors.length}) — last statement must win`
    )

  // Positive 4: three signature spellings collapse to one key.
  const spellings = [
    'public.f(p_code character varying, p_id uuid)',
    'public.f(character varying, uuid)',
    'public.f(p_code varchar(10), p_id uuid DEFAULT auth.uid())'
  ].map((spelling) => {
    const open = spelling.indexOf('(')
    return makeKey(
      spelling.slice('public.'.length, open),
      spelling.slice(open + 1, spelling.lastIndexOf(')'))
    )
  })
  if (new Set(spellings).size !== 1)
    fail(
      'positive control 4 failed: the pg_dump, ACL-line and hand-written spellings ' +
        `of one signature did not collapse to one key: ${JSON.stringify(spellings)}`
    )

  census = censusFromFiles([
    {
      file: 'm/1.sql',
      sql:
        'CREATE FUNCTION public.f(p_code character varying, p_id uuid DEFAULT auth.uid()) RETURNS boolean\n' +
        '    LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN true; END; $$;\n' +
        'REVOKE EXECUTE ON FUNCTION public.f(character varying, uuid) FROM PUBLIC, anon;\n'
    }
  ])
  if (census.corridors.length !== 0 || census.unmatchedGrants.length !== 0)
    fail(
      'positive control 5 failed: a REVOKE written with bare types did not reach a ' +
        'function declared with parameter names and a DEFAULT ' +
        `(${census.corridors.length} corridor(s), ${census.unmatchedGrants.length} unmatched)`
    )

  // Negative 6: PostgREST will not publish a trigger function.
  census = censusFromFiles([
    {
      file: 'm/1.sql',
      sql:
        'CREATE FUNCTION public.t() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER\n' +
        '    AS $$ BEGIN RETURN NEW; END; $$;\n'
    }
  ])
  if (census.corridors.length !== 0 || census.unreachable.length !== 1)
    fail(
      'negative control 6 failed: a SECURITY DEFINER trigger function was counted as ' +
        `an HTTP-reachable corridor (${census.corridors.length} corridor(s))`
    )

  census = censusFromFiles([
    {
      file: 'm/1.sql',
      sql: DEFINER('gone') + 'DROP FUNCTION IF EXISTS public.gone();\n'
    }
  ])
  if (census.corridors.length !== 0)
    fail(
      `negative control 7 failed: a dropped function stayed in the census (${census.corridors.length})`
    )

  // Positive 6: CREATE OR REPLACE must not restore a revoked ACL.
  census = censusFromFiles([
    {
      file: 'm/1.sql',
      sql:
        DEFINER('replaced') +
        'REVOKE EXECUTE ON FUNCTION public.replaced() FROM PUBLIC, anon;\n'
    },
    {
      file: 'm/2.sql',
      sql:
        'CREATE OR REPLACE FUNCTION public.replaced() RETURNS boolean LANGUAGE plpgsql\n' +
        '    SECURITY DEFINER AS $$ BEGIN RETURN false; END; $$;\n'
    }
  ])
  if (census.corridors.length !== 0)
    fail(
      'positive control 6 failed: CREATE OR REPLACE reset the ACL and re-opened a ' +
        `revoked corridor (${census.corridors.length}) — PostgreSQL preserves it`
    )

  census = censusFromFiles([
    {
      file: 'm/1.sql',
      sql:
        DEFINER('a') +
        DEFINER('b') +
        'REVOKE EXECUTE ON FUNCTION public.a(), public.b() FROM PUBLIC, anon;\n'
    }
  ])
  if (census.corridors.length !== 0)
    fail(
      'positive control 7 failed: a REVOKE naming two functions only reached one ' +
        `(${census.corridors.length} corridor(s) left)`
    )

  census = censusFromFiles([
    {
      file: 'm/1.sql',
      sql:
        DEFINER('svc') +
        'REVOKE EXECUTE ON FUNCTION public.svc() FROM PUBLIC, anon;\n' +
        'GRANT EXECUTE ON FUNCTION public.svc() TO authenticated, service_role;\n'
    }
  ])
  if (census.corridors.length !== 0)
    fail(
      'positive control 8 failed: GRANT to authenticated/service_role was read as an ' +
        `anon grant (${census.corridors.length} corridor(s))`
    )

  census = censusFromFiles([
    {
      file: 'm/1.sql',
      sql:
        DEFINER('downgraded') +
        'ALTER FUNCTION public.downgraded() SECURITY INVOKER;\n'
    }
  ])
  if (census.corridors.length !== 0)
    fail(
      'positive control 9 failed: ALTER FUNCTION ... SECURITY INVOKER left the ' +
        `function in the corridor set (${census.corridors.length})`
    )

  // Positive 10: a GRANT on a function no migration created is reported.
  census = censusFromFiles([
    {
      file: 'm/1.sql',
      sql: 'GRANT EXECUTE ON FUNCTION public.ghost() TO anon;\n'
    }
  ])
  if (census.unmatchedGrants.length !== 1)
    fail(
      'positive control 10 failed: a GRANT on a function this repository never ' +
        `created was silently dropped (${census.unmatchedGrants.length} reported)`
    )

  const dynamic = findDynamicPrivilegeStatements([
    {
      file: 'm/1.sql',
      sql: "  EXECUTE format('REVOKE ALL ON FUNCTION public.x() FROM %I', r);\n"
    },
    {
      file: 'm/2.sql',
      sql: "-- EXECUTE 'GRANT EXECUTE ON FUNCTION public.y() TO anon';\n"
    }
  ])
  if (dynamic.length !== 1)
    fail(
      'positive control 11 failed: dynamic privilege SQL was not reported exactly ' +
        `once (${dynamic.length}) — the commented line must not count`
    )

  console.log('anon-definer census self-test passed (18 controls)')
}

function main() {
  const command = process.argv[2] ?? '--check'
  if (command === '--selftest') selfTest()
  else if (command === '--census') commandCensus(false)
  else if (command === '--json') commandCensus(true)
  else if (command === '--check') commandCheck()
  else if (command === '--update') commandUpdate()
  else {
    console.error(
      'usage: anon-definer-census.mjs [--census|--json|--check|--update|--selftest]'
    )
    process.exit(2)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
