#!/usr/bin/env node
// Tripwire for two migration invariants: (1) auth guards must be null-safe,
// since auth.role() is NULL without a JWT and PL/pgSQL skips a NULL IF; (2) any
// file granting or creating a destructive definer must revoke PUBLIC.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const SQL_ROOTS = ['supabase']

const AUTH_HELPERS = ['role', 'uid', 'jwt']

// Deliberately under-claims coverage.
const SCOPE_NOTE =
  'SQL comparison/negation/single-statement-assignment adjacency lanes only — ' +
  'multi-hop dataflow and TypeScript guards out of scope, see header'

function formatScanSuccess(fileCount) {
  return `NULL-skippable auth guards passed (${fileCount} SQL file(s) scanned; ${SCOPE_NOTE})`
}

// Grants to anon/authenticated are deliberate; PUBLIC must stay revoked.
const PUBLIC_CORRIDOR_FUNCTIONS = [
  'clear_season_assignments',
  'refresh_votlw_winners'
]

// Blank comments and literals (fix migrations carry vulnerable text as data),
// keeping newlines. Dollar-quoted bodies must NOT be blanked: the guards live there.
function stripNonCode(sql) {
  const out = []
  const blankTo = (from, to) => {
    for (let k = from; k < to; k += 1) if (sql[k] === '\n') out.push('\n')
  }

  const dollarTags = []
  const DOLLAR_TAG = /^\$[a-zA-Z_][a-zA-Z0-9_]*\$|^\$\$/

  let i = 0
  while (i < sql.length) {
    const two = sql.slice(i, i + 2)

    if (two === '--') {
      const nl = sql.indexOf('\n', i)
      const stop = nl === -1 ? sql.length : nl
      blankTo(i, stop)
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
        } else if (sql.slice(j, j + 2) === '*/') {
          depth -= 1
          j += 2
          if (depth === 0) break
        } else {
          j += 1
        }
      }
      blankTo(i, j)
      i = j
      continue
    }

    if (sql[i] === '$') {
      const tag = (DOLLAR_TAG.exec(sql.slice(i)) ?? [])[0]
      if (tag) {
        if (dollarTags[dollarTags.length - 1] === tag) dollarTags.pop()
        else dollarTags.push(tag)
        out.push(' '.repeat(tag.length))
        i += tag.length
        continue
      }
    }

    // Consumed so an inner apostrophe is not read as a literal delimiter.
    if (sql[i] === '"') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2
        else if (sql[j] === '"') {
          j += 1
          break
        } else j += 1
      }
      out.push(sql.slice(i, j))
      i = j
      continue
    }

    if (sql[i] === "'") {
      const escaped =
        /[Ee]/.test(sql.slice(Math.max(0, i - 1), i)) &&
        !/[A-Za-z0-9_]/.test(sql.slice(Math.max(0, i - 2), Math.max(0, i - 1)))
      let j = i + 1
      let closed = false
      while (j < sql.length) {
        // Literals never span lines, so a stray apostrophe cannot blank later guards.
        if (sql[j] === '\n') break
        if (escaped && sql[j] === '\\') {
          j += 2
          continue
        }
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2
          continue
        }
        if (sql[j] === "'") {
          j += 1
          closed = true
          break
        }
        j += 1
      }

      const tag = dollarTags[dollarTags.length - 1]
      const terminator = tag ? sql.indexOf(tag, i + 1) : -1
      if (!closed || (terminator !== -1 && terminator < j)) {
        out.push("'")
        i += 1
        continue
      }

      // Executable literals (EXECUTE operands) stay visible, or a migration could reopen a corridor unseen.
      const beforeLit = sql.slice(Math.max(0, i - 48), i)
      const isExecuted = /\bEXECUTE\s+(?:format\s*\(\s*)?$/i.test(beforeLit)
      if (isExecuted) {
        out.push(sql.slice(i, j))
        i = j
        continue
      }

      out.push("'")
      blankTo(i + 1, j - 1)
      out.push("'")
      i = j
      continue
    }

    out.push(sql[i])
    i += 1
  }

  return out.join('')
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

// Lane 1a: `auth.x()` then a NULL-propagating comparison; a COALESCE-wrapped
// call cannot match because the next character is `,`.
const WRAP = String.raw`(?:\s|\)|::\s*[a-zA-Z_][a-zA-Z0-9_ ]*)*`
const NULL_SKIPPABLE = new RegExp(
  String.raw`\bauth\.(${AUTH_HELPERS.join('|')})\s*\(\s*\)${WRAP}(<>|!=|(?:NOT\s+IN)\b)`,
  'gi'
)

// Lane 1b: reversed operands (`x != auth.uid()`).
const NULL_SKIPPABLE_REVERSED = new RegExp(
  String.raw`(<>|!=|(?:NOT\s+IN)\b)\s*\(*\s*(?:SELECT\s+)?auth\.(${AUTH_HELPERS.join('|')})\s*\(\s*\)`,
  'gi'
)

// Lane 1c: `NOT (... auth.x() ...)`; NOT NULL is NULL. Only a bare auth call
// counts: COALESCE or IS [NOT] NULL/DISTINCT FROM make it safe.
const AUTH_CALL = new RegExp(
  String.raw`\bauth\.(${AUTH_HELPERS.join('|')})\s*\(\s*\)`,
  'gi'
)

// NULLIF must not appear here: it can only add a NULL.
const NULL_NEUTRALISING_WRAPPER = /\bCOALESCE\s*\(\s*$/i
const NULL_SAFE_ON_THE_LEFT =
  /\bIS\s+(?:NOT\s+)?DISTINCT\s+FROM\s*\(*\s*(?:SELECT\s+)?$/i
const NULL_SAFE_ON_THE_RIGHT =
  /^\s*(?:::\s*[a-zA-Z_][a-zA-Z0-9_ ]*)?\s*IS\s+(?:NOT\s+)?(?:NULL\b|DISTINCT\s+FROM\b)/i

function bareAuthCalls(region) {
  const hits = []
  AUTH_CALL.lastIndex = 0
  for (const match of region.matchAll(AUTH_CALL)) {
    const before = region.slice(0, match.index)
    const after = region.slice(match.index + match[0].length)
    if (NULL_NEUTRALISING_WRAPPER.test(before)) continue
    if (NULL_SAFE_ON_THE_LEFT.test(before)) continue
    if (NULL_SAFE_ON_THE_RIGHT.test(after)) continue
    hits.push({ index: match.index, helper: match[1] })
  }
  return hits
}

// Negated predicates as [start, end), parenthesised or not (`=` binds tighter
// than NOT). `IS NOT` and `NOT IN/NULL/EXISTS/...` are not predicate negations.
const NEG_SKIP_AFTER = /^(?:IN|NULL|DISTINCT|EXISTS|LIKE|SIMILAR|BETWEEN)\b/i
const NEG_BOUNDARY = /^(?:AND|OR|THEN|LOOP|ELSE|ELSIF|END|WHEN|RETURN)\b/i

function notGroups(sql) {
  const groups = []
  for (const match of sql.matchAll(/\bNOT\b/gi)) {
    const start = match.index
    if (/\bIS\s+$/i.test(sql.slice(Math.max(0, start - 4), start))) continue
    let k = start + 3
    while (k < sql.length && /\s/.test(sql[k])) k += 1
    if (NEG_SKIP_AFTER.test(sql.slice(k))) continue

    if (sql[k] === '(') {
      let depth = 0
      let j = k
      for (; j < sql.length; j += 1) {
        if (sql[j] === '(') depth += 1
        else if (sql[j] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      if (depth === 0 && j < sql.length) groups.push([k + 1, j])
      continue
    }

    let depth = 0
    let j = k
    for (; j < sql.length; j += 1) {
      const c = sql[j]
      if (c === '(') depth += 1
      else if (c === ')') {
        if (depth === 0) break
        depth -= 1
      } else if (c === ';') break
      else if (
        depth === 0 &&
        /[A-Za-z]/.test(c) &&
        !/[A-Za-z0-9_]/.test(sql[j - 1] ?? ' ') &&
        NEG_BOUNDARY.test(sql.slice(j))
      ) {
        break
      }
    }
    if (j > k) groups.push([k, j])
  }
  return groups
}

// Safe when the group has a positive `auth.X() IS NOT NULL` and no top-level OR
// (`FALSE OR NULL` is NULL). Only suppresses, so it can only miss a finding.
const AUTH_IS_NOT_NULL =
  /\bauth\.(?:role|uid|jwt)\s*\(\s*\)\s*IS\s+NOT\s+NULL\b/i

// Lane 4: `v := x = auth.uid(); IF NOT v` treats NULL as false and skips the deny path. Flag the
// assignment itself; a positively-used boolean is a false positive whose fix is still correct.
const NULL_SKIPPABLE_ASSIGNMENT = new RegExp(
  String.raw`:=\s*([^;]*?\bauth\.(${AUTH_HELPERS.join('|')})\s*\(\s*\)[^;]*?)\s*;`,
  'gis'
)

const ASSIGNED_COMPARISON = /(?:<>|!=|=)/

const ASSIGNMENT_NULL_GUARDED =
  /\bIS\s+(?:NOT\s+)?DISTINCT\s+FROM\b|\bCOALESCE\s*\(|\bIS\s+NULL\b/i

// An aggregate subquery cannot yield NULL, and its inner `= auth.uid()` is fail-closed.
const ASSIGNED_SUBQUERY = /\bSELECT\b/i

function isNullAbsorbing(groupText) {
  if (!AUTH_IS_NOT_NULL.test(groupText)) return false
  let depth = 0
  for (const m of groupText.matchAll(/[()]|\bOR\b/gi)) {
    const tok = m[0]
    if (tok === '(') depth += 1
    else if (tok === ')') depth -= 1
    else if (depth === 0) return false // top-level OR — not absorbing
  }
  return true
}

const GRANT_TO_CLIENT_ROLE = (fn) =>
  new RegExp(
    String.raw`\bGRANT\b[^;]*?\bON\s+FUNCTION\s+(?:public\.)?${fn}\b[^;]*?\bTO\b[^;]*?\b(anon|authenticated)\b`,
    'is'
  )

const CREATES_FUNCTION = (fn) =>
  new RegExp(
    String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?${fn}\b`,
    'is'
  )

const REVOKES_PUBLIC = (fn) =>
  new RegExp(
    String.raw`\bREVOKE\b[^;]*?\bON\s+FUNCTION\s+(?:public\.)?${fn}\b[^;]*?\bFROM\b[^;]*?\bPUBLIC\b`,
    'is'
  )

// Only auth.role() returns text, so only it gets the COALESCE hint.
function coalesceHint(helper, operator, insideNegation = false) {
  if (helper !== 'role') return ''
  return insideNegation
    ? `, or wrap it as \`COALESCE(auth.role(), '') <> ...\` inside the negation`
    : ` or \`COALESCE(auth.role(), '') ${operator} ...\``
}

export function findViolations(files) {
  const violations = []

  for (const [file, rawSql] of Object.entries(files)) {
    const sql = stripNonCode(rawSql)
    const reported = new Set()

    NULL_SKIPPABLE.lastIndex = 0
    for (const match of sql.matchAll(NULL_SKIPPABLE)) {
      const operator = match[2].replace(/\s+/g, ' ').toUpperCase()
      reported.add(match.index + match[0].toLowerCase().indexOf('auth.'))
      violations.push(
        `${file}:${lineOf(sql, match.index)}: auth.${match[1]}() ${operator} ... ` +
          `is NULL-skippable on a direct connection — use ` +
          `\`auth.${match[1]}() IS DISTINCT FROM ...\`` +
          coalesceHint(match[1], operator)
      )
    }

    NULL_SKIPPABLE_REVERSED.lastIndex = 0
    for (const match of sql.matchAll(NULL_SKIPPABLE_REVERSED)) {
      const operator = match[1].replace(/\s+/g, ' ').toUpperCase()
      reported.add(match.index + match[0].toLowerCase().indexOf('auth.'))
      violations.push(
        `${file}:${lineOf(sql, match.index)}: ... ${operator} auth.${match[2]}() ` +
          `is NULL-skippable on a direct connection — NULL on the RIGHT operand ` +
          `propagates identically. Use ` +
          `\`x IS NULL OR x IS DISTINCT FROM auth.${match[2]}()\`. ` +
          `KEEP the \`x IS NULL\` disjunct: it guards only the LEFT operand, so ` +
          `it does not make this safe on its own, but dropping it makes two ` +
          `NULLs compare EQUAL and authorises an unauthenticated caller against ` +
          `an unowned row`
      )
    }

    NULL_SKIPPABLE_ASSIGNMENT.lastIndex = 0
    for (const match of sql.matchAll(NULL_SKIPPABLE_ASSIGNMENT)) {
      const rhs = match[1]
      if (!ASSIGNED_COMPARISON.test(rhs)) continue
      if (ASSIGNMENT_NULL_GUARDED.test(rhs)) continue
      if (ASSIGNED_SUBQUERY.test(rhs)) continue
      const at = match.index + match[0].toLowerCase().indexOf('auth.')
      if (reported.has(at)) continue
      reported.add(at)
      violations.push(
        `${file}:${lineOf(sql, match.index)}: a comparison against auth.${match[2]}() ` +
          `is ASSIGNED to a variable without a null guard — the assigned boolean is ` +
          `NULL when either side is NULL, and a later \`IF NOT <var>\` treats that ` +
          `NULL as false, SKIPPING the deny branch rather than failing it. This is ` +
          `not caught by the operator lanes because \`=\` is fail-closed in a ` +
          `predicate but not in an assignment (PS-381 shipped exactly this). Use ` +
          `\`x IS NULL OR x IS DISTINCT FROM auth.${match[2]}()\`, or COALESCE the ` +
          `nullable side before comparing`
      )
    }

    for (const [from, to] of notGroups(sql)) {
      const groupText = sql.slice(from, to)
      if (isNullAbsorbing(groupText)) continue
      for (const hit of bareAuthCalls(groupText)) {
        if (reported.has(from + hit.index)) continue
        reported.add(from + hit.index)
        violations.push(
          `${file}:${lineOf(sql, from + hit.index)}: ` +
            `NOT ( ... auth.${hit.helper}() ... ) is NULL-skippable on a direct ` +
            `connection — a bare auth.${hit.helper}() inside a negated predicate ` +
            `(e.g. \`NOT (auth.role() = ANY (ARRAY[...]))\`) yields NULL, and ` +
            `\`NOT NULL\` is NULL, which PL/pgSQL's IF treats as FALSE. It ` +
            `contains none of \`<>\`, \`!=\` or \`NOT IN\`, which is why the ` +
            `operator lanes miss it. Restate it with ` +
            `\`IS DISTINCT FROM\`${coalesceHint(hit.helper, null, true)}`
        )
      }
    }

    for (const fn of PUBLIC_CORRIDOR_FUNCTIONS) {
      const grants = GRANT_TO_CLIENT_ROLE(fn).test(sql)
      const creates = CREATES_FUNCTION(fn).test(sql)
      if ((grants || creates) && !REVOKES_PUBLIC(fn).test(sql)) {
        const how = creates
          ? `(re)creates public.${fn} — CREATE FUNCTION's default ACL hands PUBLIC EXECUTE —`
          : `grants public.${fn} to a client role`
        violations.push(
          `${file}: ${how} without ` +
            `\`REVOKE EXECUTE ON FUNCTION public.${fn}(...) FROM PUBLIC\` in the ` +
            `same file (POS-SEC-10)`
        )
      }
    }
  }

  return violations
}

function walkSql(relativePath) {
  const absolutePath = path.join(ROOT, relativePath)
  if (!fs.existsSync(absolutePath)) return []
  const stat = fs.statSync(absolutePath)
  if (stat.isFile()) return relativePath.endsWith('.sql') ? [relativePath] : []
  return fs
    .readdirSync(absolutePath, { withFileTypes: true })
    .flatMap((entry) => walkSql(path.join(relativePath, entry.name)))
}

function selfTest() {
  const bareGuards = findViolations({
    'supabase/migrations/x.sql': [
      "IF auth.role() <> 'service_role' THEN",
      "  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Auth required'; END IF;",
      'END IF;'
    ].join('\n')
  })
  if (bareGuards.length !== 1) {
    throw new Error(
      `positive control failed: bare \`<>\` guard not detected (${bareGuards.length} finding(s))`
    )
  }

  const otherOperators = findViolations({
    'supabase/migrations/y.sql':
      "IF auth.role() != 'service_role' THEN NULL; END IF;\n" +
      "IF auth.role() NOT IN ('service_role', 'supabase_admin') THEN NULL; END IF;"
  })
  if (otherOperators.length !== 2) {
    throw new Error(
      `positive control failed: \`!=\` / \`NOT IN\` not detected (${otherOperators.length} finding(s))`
    )
  }

  const wrappedAndReversed = findViolations({
    'supabase/migrations/y2.sql':
      "IF (auth.role()) <> 'service_role' THEN NULL; END IF;\n" +
      'IF auth.uid()::text != p_user_id THEN NULL; END IF;\n' +
      'IF v_rec.applicant_user_id IS NULL OR v_rec.applicant_user_id != auth.uid() THEN NULL; END IF;\n' +
      "IF 'service_role' <> auth.role() THEN NULL; END IF;\n" +
      'IF v_thread.user_id <> (SELECT auth.uid()) THEN NULL; END IF;'
  })
  if (wrappedAndReversed.length !== 5) {
    throw new Error(
      `positive control failed: wrapped/cast/reversed spellings — expected 5, got ${wrappedAndReversed.length}:\n${wrappedAndReversed.join('\n')}`
    )
  }

  // Keep this real-world shape verbatim.
  const assignedEquality = findViolations({
    'supabase/migrations/y3.sql':
      'v_is_applicant := v_app_record.applicant_user_id = auth.uid();\n' +
      'v_is_guild_officer := EXISTS (SELECT 1 FROM player_mapping pm WHERE pm.user_id = auth.uid());\n' +
      'IF NOT v_is_applicant AND NOT v_is_guild_officer THEN RETURN NULL; END IF;'
  })
  if (assignedEquality.length !== 1) {
    throw new Error(
      `positive control failed: assigned \`= auth.uid()\` (the PS-381 shape) — expected 1, got ${assignedEquality.length}:\n${assignedEquality.join('\n')}`
    )
  }

  const safeAssignments = findViolations({
    'supabase/migrations/y4.sql':
      'v_user_id := auth.uid();\n' +
      'v_auth_uid uuid := auth.uid();\n' +
      'v_is_applicant := v_rec.applicant_user_id IS NOT DISTINCT FROM auth.uid();\n' +
      "v_is_service := COALESCE(auth.role(), '') = 'service_role';\n" +
      'v_count := (SELECT count(*) FROM player_mapping pm WHERE pm.user_id = auth.uid());'
  })
  if (safeAssignments.length !== 0) {
    throw new Error(
      `negative control failed: assignment lane fired on null-safe or non-boolean assignments — expected 0, got ${safeAssignments.length}:\n${safeAssignments.join('\n')}`
    )
  }

  const openCorridor = findViolations({
    'supabase/migrations/z.sql':
      'GRANT ALL ON FUNCTION public.refresh_votlw_winners() TO anon;\n' +
      'GRANT ALL ON FUNCTION public.refresh_votlw_winners() TO authenticated;'
  })
  if (openCorridor.length !== 1) {
    throw new Error(
      `positive control failed: re-opened PUBLIC corridor not detected (${openCorridor.length} finding(s))`
    )
  }

  const bareCreate = findViolations({
    'supabase/migrations/z2.sql':
      'CREATE OR REPLACE FUNCTION public.clear_season_assignments(p_guild text)\n' +
      'RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END $$;'
  })
  if (bareCreate.length !== 1) {
    throw new Error(
      `positive control failed: bare CREATE of a corridor function not detected (${bareCreate.length} finding(s))`
    )
  }

  // Anti-blinding control: dollar-quoted bodies must not be blanked.
  const insideDollarQuotedBody = findViolations({
    'supabase/migrations/d1.sql':
      'CREATE OR REPLACE FUNCTION public.f() RETURNS void\n' +
      'LANGUAGE plpgsql SECURITY DEFINER AS $$\n' +
      'BEGIN\n' +
      "  IF auth.role() <> 'service_role' THEN\n" +
      '    RAISE EXCEPTION $msg$not allowed$msg$;\n' +
      '  END IF;\n' +
      'END;\n' +
      '$$;'
  })
  if (insideDollarQuotedBody.length !== 1) {
    throw new Error(
      'positive control failed: a vulnerable guard inside a $$ ... $$ body was ' +
        `NOT detected (${insideDollarQuotedBody.length} finding(s)) — the ` +
        'dollar-quoted body is being stripped, which blinds the gate on every ' +
        'PL/pgSQL function in the repository'
    )
  }

  const taggedBody = findViolations({
    'supabase/migrations/d2.sql':
      'CREATE FUNCTION public.g() RETURNS void AS $body$\n' +
      'BEGIN\n' +
      '  IF v_rec.owner_id IS NULL OR v_rec.owner_id != auth.uid() THEN\n' +
      '    RAISE EXCEPTION $q$denied$q$;\n' +
      '  END IF;\n' +
      'END;\n' +
      '$body$ LANGUAGE plpgsql;'
  })
  if (taggedBody.length !== 1) {
    throw new Error(
      'positive control failed: reversed guard inside a $body$ ... $body$ body ' +
        `not detected (${taggedBody.length} finding(s))`
    )
  }

  const negationWrapped = findViolations({
    'supabase/migrations/n1.sql':
      "IF NOT (auth.role() = ANY (ARRAY['service_role', 'supabase_admin'])) THEN NULL; END IF;\n" +
      'IF NOT (auth.uid() = v_rec.owner_id) THEN NULL; END IF;'
  })
  if (negationWrapped.length !== 2) {
    throw new Error(
      'positive control failed: `NOT (auth.x() = ...)` not detected — expected ' +
        `2, got ${negationWrapped.length}:\n${negationWrapped.join('\n')}`
    )
  }

  const manyFiles = findViolations({
    'supabase/migrations/m1.sql':
      "IF auth.role() <> 'service_role' THEN NULL; END IF;",
    'supabase/migrations/m2.sql': 'IF v.owner != auth.uid() THEN NULL; END IF;',
    'supabase/migrations/m3.sql':
      "IF NOT (auth.role() = ANY (ARRAY['x'])) THEN NULL; END IF;"
  })
  const filesReported = new Set(manyFiles.map((v) => v.split(':')[0]))
  if (filesReported.size !== 3) {
    throw new Error(
      'positive control failed: enumeration stopped early — expected findings ' +
        `in 3 files, got ${filesReported.size} ([${[...filesReported].join(', ')}])`
    )
  }

  // The fix migration's quoted vulnerable text is data, not a finding.
  const fixMigrationShape = findViolations({
    'supabase/migrations/f1.sql':
      'DO $do$\n' +
      'DECLARE\n' +
      "  v_old text := 'auth.role() <> ''service_role''';\n" +
      "  v_new text := 'auth.role() IS DISTINCT FROM ''service_role''';\n" +
      "  v_alt text := 'p_user_id <> auth.uid()';\n" +
      "  v_any text := 'NOT (auth.role() = ANY (ARRAY[''service_role'']))';\n" +
      'BEGIN\n' +
      '  EXECUTE replace(v_def, v_old, v_new);\n' +
      'END\n' +
      '$do$;'
  })
  if (fixMigrationShape.length !== 0) {
    throw new Error(
      'negative control failed: the POS-SEC-10 FIX migration is rejected by the ' +
        `POS-SEC-10 gate — vulnerable text quoted as data must not be a finding:\n${fixMigrationShape.join('\n')}`
    )
  }

  // The rewind must use the innermost open dollar tag.
  const nestedDollarTags = findViolations({
    'supabase/migrations/n2.sql':
      "DO $outer$ SELECT $m$don't$m$; IF auth.role() <> 'svc' THEN NULL; END IF; $outer$;"
  })
  if (nestedDollarTags.length !== 1) {
    throw new Error(
      'positive control failed: a guard after a NESTED dollar-quoted span was ' +
        `not detected (${nestedDollarTags.length} finding(s)) — the rewind ` +
        'guard must consult the INNERMOST open tag, not the outermost'
    )
  }

  // Caught by both lane 1a and the negation lane by design; keep it though no single mutation kills it.
  const doublyCoveredShape = findViolations({
    'supabase/migrations/r1.sql':
      "IF NOT (auth.role() <> 'service_role') THEN NULL; END IF;"
  })
  if (doublyCoveredShape.length !== 1) {
    throw new Error(
      'positive control failed: a doubly-covered negated guard reported ' +
        `${doublyCoveredShape.length} finding(s), expected 1 — if this is 0, ` +
        'BOTH lane 1a and the negation lane have regressed; if it is 2, the ' +
        'per-offset dedup between them has broken'
    )
  }

  const strayApostrophe = findViolations({
    'supabase/migrations/s1.sql':
      "SELECT 'oops;\n" + "IF auth.role() <> 'service_role' THEN NULL; END IF;"
  })
  if (strayApostrophe.length !== 1) {
    throw new Error(
      'positive control failed: a stray apostrophe swallowed the guard on a ' +
        `later line (${strayApostrophe.length} finding(s)) — a malformed ` +
        'literal must not blind the whole file'
    )
  }

  const dollarApostropheSameLine = findViolations({
    'supabase/migrations/s2.sql':
      "SELECT $m$don't$m$; IF auth.role() <> 'service_role' THEN RETURN; END IF;"
  })
  if (dollarApostropheSameLine.length !== 1) {
    throw new Error(
      'positive control failed: an apostrophe in dollar-quoted text swallowed ' +
        `a guard later on the same line (${dollarApostropheSameLine.length} finding(s))`
    )
  }

  const apostropheInProse = findViolations({
    'supabase/migrations/f2.sql':
      "DO $notes$ it's the operator that matters, not the prose $notes$;\n" +
      "IF auth.role() <> 'service_role' THEN NULL; END IF;"
  })
  if (apostropheInProse.length !== 1) {
    throw new Error(
      'negative control failed: an apostrophe in dollar-quoted prose swallowed ' +
        `the guard that follows it (${apostropheInProse.length} finding(s)) — ` +
        'the literal walker lost its place'
    )
  }

  // Null-safe spellings, paired revokes, comment prose and right-hand COALESCE
  // must be silent. Each line pins one exclusion; do not trim.
  const safe = findViolations({
    'supabase/migrations/a.sql':
      "IF auth.role() IS DISTINCT FROM 'service_role' THEN NULL; END IF;\n" +
      "IF COALESCE(auth.role(), '') <> 'service_role' THEN NULL; END IF;\n" +
      "IF COALESCE(auth.role(), '') NOT IN ('service_role') THEN NULL; END IF;\n" +
      'GRANT ALL ON FUNCTION public.refresh_votlw_winners() TO anon;\n' +
      'REVOKE EXECUTE ON FUNCTION public.refresh_votlw_winners()\n' +
      '  FROM PUBLIC, anon, authenticated;\n' +
      "IF 'service_role' <> COALESCE(auth.role(), '') THEN NULL; END IF;\n" +
      'CREATE OR REPLACE FUNCTION public.clear_season_assignments(p_guild text)\n' +
      'RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END $$;\n' +
      'REVOKE EXECUTE ON FUNCTION public.clear_season_assignments(text) FROM PUBLIC;\n' +
      'IF NOT (auth.uid() IS NULL) THEN NULL; END IF;\n' +
      "IF NOT (COALESCE(auth.role(), '') = ANY (ARRAY['service_role'])) THEN NULL; END IF;\n" +
      'IF NOT (v.owner IS DISTINCT FROM auth.uid()) THEN NULL; END IF;\n' +
      "-- prose may say auth.role() <> 'service_role' without tripping the gate\n" +
      "/* old form: auth.role() <> 'service_role'\n   and x != auth.uid() */"
  })
  if (safe.length !== 0) {
    throw new Error(`negative control failed: ${safe.join('; ')}`)
  }

  const nullifNotSafe = findViolations({
    'supabase/migrations/nf.sql':
      "IF NOT (NULLIF(auth.role(), '') = 'service_role') THEN NULL; END IF;"
  })
  if (nullifNotSafe.length !== 1) {
    throw new Error(
      'positive control failed: a NULLIF-wrapped bare auth call inside a NOT ' +
        `group was treated as NULL-safe (${nullifNotSafe.length} finding(s)) — ` +
        'NULLIF is not null-neutralising'
    )
  }

  const unparenthesisedNot = findViolations({
    'supabase/migrations/up.sql':
      "IF NOT auth.role() = ANY (ARRAY['service_role']) THEN NULL; END IF;\n" +
      'IF NOT auth.uid() = v_owner THEN NULL; END IF;'
  })
  if (unparenthesisedNot.length !== 2) {
    throw new Error(
      'positive control failed: an unparenthesised `NOT auth.x() = ...` guard ' +
        `was not detected — expected 2, got ${unparenthesisedNot.length}`
    )
  }
  const notExistsIsSafe = findViolations({
    'supabase/migrations/ne.sql':
      'IF NOT EXISTS (SELECT 1 FROM t WHERE user_id = auth.uid()) THEN\n' +
      "  RAISE EXCEPTION 'x';\nEND IF;"
  })
  if (notExistsIsSafe.length !== 0) {
    throw new Error(
      'negative control failed: `NOT EXISTS (... auth.uid() ...)` was flagged ' +
        `(${notExistsIsSafe.length}) — EXISTS is never NULL, so it is safe`
    )
  }

  const nullAbsorbing = findViolations({
    'supabase/migrations/ab.sql':
      'IF NOT (auth.uid() IS NOT NULL AND auth.uid() = v_owner) THEN\n' +
      "  RAISE EXCEPTION 'x';\nEND IF;"
  })
  if (nullAbsorbing.length !== 0) {
    throw new Error(
      'negative control failed: a NULL-absorbing negated guard was flagged ' +
        `(${nullAbsorbing.length}) — FALSE AND NULL is FALSE, the guard is safe`
    )
  }
  const orBreaksAbsorption = findViolations({
    'supabase/migrations/or.sql':
      'IF NOT (auth.uid() IS NOT NULL OR auth.uid() = v_owner) THEN\n' +
      '  NULL;\nEND IF;'
  })
  if (orBreaksAbsorption.length !== 1) {
    throw new Error(
      'positive control failed: a top-level OR did not break NULL absorption ' +
        `(${orBreaksAbsorption.length} finding(s)) — the OR form IS skippable`
    )
  }

  const uidMsg = findViolations({
    'supabase/migrations/tu.sql': "IF auth.uid() != 'x' THEN NULL; END IF;"
  })
  const roleMsg = findViolations({
    'supabase/migrations/tr.sql': "IF auth.role() <> 'x' THEN NULL; END IF;"
  })
  if (uidMsg.length !== 1 || /COALESCE/i.test(uidMsg[0])) {
    throw new Error(
      'positive control failed: the auth.uid() remediation suggested a ' +
        `type-incorrect COALESCE (uid is uuid, not text): ${uidMsg[0]}`
    )
  }
  if (roleMsg.length !== 1 || !/COALESCE\(auth\.role/.test(roleMsg[0])) {
    throw new Error(
      'positive control failed: the auth.role() remediation dropped its valid ' +
        `COALESCE(auth.role(), '') alternative: ${roleMsg[0]}`
    )
  }

  const executedGrant = findViolations({
    'supabase/migrations/ex.sql':
      "EXECUTE 'GRANT EXECUTE ON FUNCTION public.clear_season_assignments() TO authenticated';"
  })
  if (executedGrant.length !== 1) {
    throw new Error(
      'positive control failed: a corridor GRANT executed via EXECUTE was ' +
        `blanked before lane 2 saw it (${executedGrant.length} finding(s))`
    )
  }

  // Scope: covered patterns fail, supported rewrites pass, unsupported constructs stay silent.

  const ps383CoveredUnsafe = findViolations({
    'supabase/migrations/ps383-a.sql':
      "IF auth.role() <> 'service_role' THEN NULL; END IF;"
  })
  if (ps383CoveredUnsafe.length !== 1) {
    throw new Error(
      'PS-383 regression: a covered unsafe pattern (Lane 1a) stopped being ' +
        `detected (${ps383CoveredUnsafe.length} finding(s))`
    )
  }

  const ps383SupportedSafe = findViolations({
    'supabase/migrations/ps383-b.sql':
      "IF auth.role() IS DISTINCT FROM 'service_role' THEN NULL; END IF;"
  })
  if (ps383SupportedSafe.length !== 0) {
    throw new Error(
      'PS-383 regression: a supported null-safe rewrite was flagged ' +
        `(${ps383SupportedSafe.length} finding(s))`
    )
  }

  const ps383UnsupportedLaunderedThroughFunctionCall = findViolations({
    'supabase/migrations/ps383-c.sql':
      'v_is_applicant := is_owner(auth.uid(), v_app_record.applicant_user_id);\n' +
      'IF NOT v_is_applicant THEN RETURN NULL; END IF;'
  })
  if (ps383UnsupportedLaunderedThroughFunctionCall.length !== 0) {
    throw new Error(
      'PS-383: a function-call-laundered NULL-skip was unexpectedly detected ' +
        `(${ps383UnsupportedLaunderedThroughFunctionCall.length} finding(s)) — ` +
        "if a new lane now covers this, update the header's scope claims " +
        'instead of leaving this assertion stale'
    )
  }
  const ps383ScanSuccessMessage = formatScanSuccess(1)
  if (
    !/out of scope/i.test(ps383ScanSuccessMessage) ||
    !/multi-hop dataflow/i.test(ps383ScanSuccessMessage)
  ) {
    throw new Error(
      'PS-383 regression: the --scan success line no longer names the scope ' +
        `("${ps383ScanSuccessMessage}") — a green scan must not be misread as ` +
        'covering multi-hop dataflow or TypeScript guards'
    )
  }

  console.log('NULL-skippable auth-guard self-test passed')
}

function scan() {
  const paths = SQL_ROOTS.flatMap(walkSql)
  const files = Object.fromEntries(
    paths.map((file) => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')])
  )

  if (paths.length === 0) {
    console.error(
      'NULL-skippable auth guards FAILED: no .sql files found under ' +
        `${SQL_ROOTS.join(', ')} — the scan would pass vacuously`
    )
    process.exit(1)
  }

  const violations = findViolations(files)

  if (violations.length > 0) {
    console.error('NULL-skippable auth guards FAILED:')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }

  console.log(formatScanSuccess(paths.length))
}

const command = process.argv[2] ?? '--scan'
if (command === '--selftest') selfTest()
else if (command === '--scan') scan()
else {
  console.error(
    'usage: check-null-skippable-auth-guards.mjs [--selftest|--scan]'
  )
  process.exit(2)
}
