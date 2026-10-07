#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const FILENAME_PATTERN = /^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/

// Another tree shares this version clock; from the cutoff this repo's versions
// end in :00 seconds (theirs in :30), so only newer versions are checked.
export const VERSION_SUFFIX_CUTOFF = '20260920000000'

const CHECKS_PERFORMED = [
  'filename shape (YYYYMMDDHHMMSS_snake_case.sql)',
  'version uniqueness and ordering',
  'non-empty contents',
  'no nested migration directories',
  `version suffix (":00" seconds) for versions newer than ${VERSION_SUFFIX_CUTOFF}`,
  'a stated stats-window header on migrations citing zero statistics counters'
]

// Statistics counters (idx_scan, n_tup_ins, n_live_tup) are cumulative, kept
// per node, and restart at the last stats reset or server start. A zero read
// from them proves nothing unless the window it covers is stated, so a
// migration whose comments cite one as evidence must carry exactly one header:
//   -- stats-window: start=<ISO-8601> age=<duration> nodes=<N> minimum=<N>d
// Only comments are read as evidence; a live predicate in SQL (a monitoring
// view's WHERE idx_scan = 0) reports nothing observed. A table is never judged
// empty from these counters, so a DROP TABLE they justify must cite count(*).
export const STATS_WINDOW_MIN_DAYS = 14
const STATS_WINDOW_HEADER_LINES = 40
const ZERO_COUNTER =
  /\b(idx_scan|n_tup_ins|n_live_tup)\b\s*(?:<=?|=|:|\||\bwas\b|\bis\b|\bof\b)?\s*0(?![\d.])/gi
const NEVER_SCANNED = /never[ -]scanned/i
const ROW_COUNTERS = new Set(['n_tup_ins', 'n_live_tup'])
const STATS_WINDOW_LINE = /^\s*--\s*stats-window:/
const STATS_WINDOW_FORM =
  /^\s*--\s*stats-window:\s*start=(\S+)\s+age=(\S+)\s+nodes=(\S+)\s+minimum=(\S+)\s*$/
const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:Z|[+-](\d{2})(?::?(\d{2}))?)$/
const DURATION_UNIT_SECONDS = { d: 86400, h: 3600, m: 60, s: 1 }

// "21d", "20d4h", "1209600s" -> seconds; null when not understood, never 0.
function durationSeconds(raw) {
  if (!/^(\d+[dhms])+$/.test(raw)) return null
  let total = 0
  for (const [, n, unit] of raw.matchAll(/(\d+)([dhms])/g))
    total += Number(n) * DURATION_UNIT_SECONDS[unit]
  return total
}

// The comment text of a migration (line and block comments), and the SQL
// with those comments removed. Quoted strings are not parsed; a "--" inside
// a literal only widens what is read as evidence.
function splitComments(contents) {
  const comments = []
  const code = contents
    .replace(/\/\*[\s\S]*?\*\//g, (block) => {
      comments.push(block)
      return ' '
    })
    .replace(/--[^\n]*/g, (line) => {
      comments.push(line)
      return ''
    })
  return { comments: comments.join('\n'), code }
}

// A real calendar instant with a real zone offset, not just the shape of one.
function isIsoInstant(value) {
  const m = value.match(ISO_WITH_ZONE)
  if (!m) return false
  const [, y, mo, d, h, mi, sec, oh = '0', om = '0'] = m
  const day = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  return (
    day.getUTCFullYear() === Number(y) &&
    day.getUTCMonth() === Number(mo) - 1 &&
    day.getUTCDate() === Number(d) &&
    Number(h) <= 23 &&
    Number(mi) <= 59 &&
    Number(sec) <= 59 &&
    Number(om) <= 59 &&
    Number(oh) * 60 + Number(om) <= 14 * 60
  )
}

// Returns the reason a migration's stats-window evidence is unacceptable, or
// null when it cites no counter or states an adequate window.
function statsWindowViolation(contents) {
  const { comments, code } = splitComments(contents)
  const cited = [...comments.matchAll(ZERO_COUNTER)].map((m) =>
    m[1].toLowerCase()
  )
  if (cited.length === 0 && !NEVER_SCANNED.test(comments)) return null

  const lines = contents.split('\n')
  const declared = lines
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => STATS_WINDOW_LINE.test(text))
  if (declared.length === 0)
    return "cites a zero statistics counter as evidence but has no '-- stats-window:' header"
  if (declared.length > 1)
    return `${declared.length} 'stats-window:' lines; exactly one is required`
  const [{ text, line }] = declared
  if (line > STATS_WINDOW_HEADER_LINES)
    return `'stats-window:' is at line ${line}; it must be in the first ${STATS_WINDOW_HEADER_LINES} lines`

  const form = text.match(STATS_WINDOW_FORM)
  if (!form)
    return "expected exactly '-- stats-window: start=<ISO-8601> age=<duration> nodes=<N> minimum=<N>d'"
  const [, start, age, nodes, minimum] = form
  if (!isIsoInstant(start))
    return `start='${start}' is not an ISO-8601 timestamp with a zone`
  const ageSeconds = durationSeconds(age)
  if (ageSeconds === null) return `age='${age}' is not a duration (21d, 20d4h)`
  const minimumSeconds = durationSeconds(minimum)
  if (minimumSeconds === null)
    return `minimum='${minimum}' is not a duration (${STATS_WINDOW_MIN_DAYS}d)`
  if (!/^\d+$/.test(nodes) || Number(nodes) < 1)
    return `nodes='${nodes}' must be the number of nodes actually read (>= 1)`
  if (minimumSeconds < STATS_WINDOW_MIN_DAYS * 86400)
    return `minimum=${minimum} is below the ${STATS_WINDOW_MIN_DAYS}d floor`
  if (ageSeconds < minimumSeconds)
    return `age=${age} is shorter than the stated minimum=${minimum}`
  if (
    cited.some((counter) => ROW_COUNTERS.has(counter)) &&
    /\bdrop\s+table\b/i.test(code) &&
    !/count\s*\(\s*\*\s*\)/i.test(comments)
  )
    return 'drops a table on n_live_tup / n_tup_ins evidence; whether a table is empty must come from count(*), cited in a comment'
  return null
}

// Lints source files only; never connects to a database.
export function checkMigrations({ directory } = {}) {
  const resolvedDirectory = path.resolve(directory ?? 'supabase/migrations')
  const entries = readdirSync(resolvedDirectory, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort()
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const versions = new Map()
  const errors = []

  if (directories.length > 0)
    errors.push(
      `nested migration directories are not allowed: ${directories.join(', ')}`
    )
  if (files.length === 0) errors.push('no migrations found')

  for (const file of files) {
    const match = file.match(FILENAME_PATTERN)
    if (!match) {
      errors.push(`${file}: expected YYYYMMDDHHMMSS_snake_case.sql`)
      continue
    }

    const duplicates = versions.get(match[1]) ?? []
    duplicates.push(file)
    versions.set(match[1], duplicates)

    if (match[1] > VERSION_SUFFIX_CUTOFF && !match[1].endsWith('00')) {
      errors.push(
        `${file}: version ${match[1]} must end in "00" (this repository's allocation for migrations newer than ${VERSION_SUFFIX_CUTOFF} — see supabase/README.md)`
      )
    }

    const contents = readFileSync(path.join(resolvedDirectory, file), 'utf8')
    if (contents.trim().length === 0) {
      errors.push(`${file}: migration is empty`)
    }

    const statsWindow = statsWindowViolation(contents)
    if (statsWindow) errors.push(`${file}: ${statsWindow}`)
  }

  for (const [version, matches] of versions) {
    if (matches.length > 1)
      errors.push(
        `${version}: duplicate migration version (${matches.join(', ')})`
      )
  }

  return { errors, fileCount: files.length, directory: resolvedDirectory }
}

function main() {
  const { errors, fileCount } = checkMigrations()

  if (errors.length > 0) {
    errors.forEach((error) => console.error(`migration-lint: ${error}`))
    process.exit(1)
  }

  console.log(
    `migration-lint: ${fileCount} migration source file(s) checked — ${CHECKS_PERFORMED.join(', ')}. Database applied state NOT checked; verifying which migrations are actually applied requires a separate, environment-specific reconciliation check against a live database.`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
