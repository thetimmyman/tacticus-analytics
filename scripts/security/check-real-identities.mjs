#!/usr/bin/env node

// Real-identity gate: no real user id or in-game handle may appear anywhere in
// tracked files. The list of real identities lives outside the repo only.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const ALLOW_FILE = 'config/identity-scan-allow.json'
const GAME_DATA_PREFIXES = [
  'data/',
  'app/lib/catalogs/',
  'config/',
  'app/lib/themes/',
  'app/lib/config/'
]
const MIN_NAME_LENGTH = 5
// A handle in more tracked files than this is a common word, not a leak.
const MAX_NAME_FILES = 4
const MIN_OPAQUE_ID_LENGTH = 8
const MIN_PREFIX_LENGTH = 8

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu
const HEX_TOKEN_RE = /\b[0-9a-f]{8,}\b/giu
const SNOWFLAKE_RE = /^\d{15,21}$/u
const DIGIT_RUN_RE = /(?<!\d)\d{15,21}(?!\d)/gu
const WORD = '[\\p{L}\\p{N}_]'
const HYPHEN_PREFIX_RE = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){1,3}\b/giu

export function sha256Name(name) {
  return createHash('sha256').update(name.trim().toLowerCase()).digest('hex')
}

export function mask(value) {
  return `${value.slice(0, 2)}******`
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

const compact = (id) => id.toLowerCase().replace(/-/gu, '')
const hasDigitAndLetter = (s) => /\d/u.test(s) && /[a-f]/iu.test(s)

function knownFilePath() {
  return (
    process.env.TA_KNOWN_IDENTITIES_FILE ||
    path.join(os.homedir(), '.cache', 'ta-known-identities.txt')
  )
}

export function parseKnown(text) {
  const ids = new Set()
  const names = new Set()
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('id:')) {
      const id = line.slice(3).trim()
      if (id) ids.add(id.toLowerCase())
    } else if (line.startsWith('name:')) {
      const name = line.slice(5).trim()
      if (name) names.add(name)
    }
  }
  return { ids, names }
}

function loadKnown(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  try {
    // The list is itself PII; refuse one other local users could read.
    if (process.platform !== 'win32' && (fs.fstatSync(fd).mode & 0o077) !== 0) {
      console.error(
        `known-identities file is group/world accessible; run: chmod 600 ${file}`
      )
      process.exit(2)
    }
    return parseKnown(fs.readFileSync(fd, 'utf8'))
  } finally {
    fs.closeSync(fd)
  }
}

export function parseAllow(text) {
  const entries = JSON.parse(text)
  if (!Array.isArray(entries)) throw new Error(`${ALLOW_FILE} must be an array`)
  const hashes = new Set()
  for (const entry of entries) {
    if (
      !entry ||
      !/^[0-9a-f]{64}$/u.test(entry.sha256 ?? '') ||
      typeof entry.why !== 'string' ||
      !entry.why.trim() ||
      entry.why.includes('\n')
    ) {
      throw new Error(
        `${ALLOW_FILE}: every entry needs a sha256 hex digest and a one-line "why"`
      )
    }
    hashes.add(entry.sha256)
  }
  return hashes
}

const WORD_RUN = /[\p{L}\p{N}_]+/gu
const isWordRun = (s) => /^[\p{L}\p{N}_]+$/u.test(s)

function wholeWordRe(values, flags) {
  const body = values
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|')
  return new RegExp(`(?<!${WORD})(?:${body})(?!${WORD})`, flags)
}

/**
 * Names match whole-word and case-sensitively; a name found as a whole word in `gameCorpus`
 * (lowercased game-data text) is a game term, not a leak.
 */
export function buildScanner({ ids, names }, { allowHashes, gameCorpus }) {
  const fullIds = new Set()
  const snowflakes = new Set()
  const opaqueIds = new Set()
  const prefixes = new Set()
  for (const id of ids) {
    // Public ids (e.g. the support server) are allowlisted by hash like names.
    if (allowHashes.has(sha256Name(id))) continue
    const c = compact(id)
    if (/^[0-9a-f]{32}$/u.test(c)) {
      fullIds.add(c)
      for (let n = MIN_PREFIX_LENGTH; n < c.length; n += 1) {
        prefixes.add(c.slice(0, n))
      }
      const parts = id.split('-')
      for (let n = 2; n < parts.length; n += 1) {
        prefixes.add(parts.slice(0, n).join('-'))
      }
    } else if (SNOWFLAKE_RE.test(id)) {
      // Discord ids: matched by tokenising digit runs, not per-id substring search.
      snowflakes.add(id)
    } else if (id.length >= MIN_OPAQUE_ID_LENGTH) {
      opaqueIds.add(id)
    }
  }

  // Game-term check is lazy and memoised: it only runs for names that hit.
  let corpusWords = null
  const gameTerm = new Map()
  const isGameTerm = (name) => {
    if (!gameTerm.has(name)) {
      const lower = name.toLowerCase()
      corpusWords ??= new Set(gameCorpus.match(WORD_RUN) ?? [])
      gameTerm.set(
        name,
        isWordRun(lower)
          ? corpusWords.has(lower)
          : gameCorpus.includes(lower) &&
              wholeWordRe([lower], 'u').test(gameCorpus)
      )
    }
    return gameTerm.get(name)
  }
  const simpleNames = new Set()
  const complexNames = []
  for (const name of names) {
    if (name.length < MIN_NAME_LENGTH || /^Player#/iu.test(name)) continue
    if (allowHashes.has(sha256Name(name))) continue
    if (isWordRun(name)) simpleNames.add(name)
    else complexNames.push(name)
  }
  const complexIds = [...opaqueIds]

  const matchIds = (line, hits) => {
    let rest = line
    for (const m of line.matchAll(UUID_RE)) {
      if (fullIds.has(compact(m[0]))) hits.push({ kind: 'id', value: m[0] })
      rest = rest.replace(m[0], ' '.repeat(m[0].length))
    }
    for (const m of rest.matchAll(HYPHEN_PREFIX_RE)) {
      if (prefixes.has(m[0].toLowerCase())) {
        hits.push({ kind: 'id-prefix', value: m[0] })
        rest = rest.replace(m[0], ' '.repeat(m[0].length))
      }
    }
    for (const m of rest.matchAll(DIGIT_RUN_RE)) {
      if (snowflakes.has(m[0])) {
        hits.push({ kind: 'id', value: m[0] })
        rest = rest.replace(m[0], ' '.repeat(m[0].length))
      }
    }
    for (const m of rest.matchAll(HEX_TOKEN_RE)) {
      const token = m[0].toLowerCase()
      if (fullIds.has(token)) hits.push({ kind: 'id', value: m[0] })
      else if (hasDigitAndLetter(token) && prefixes.has(token)) {
        hits.push({ kind: 'id-prefix', value: m[0] })
      }
    }
  }

  return function scanText(text) {
    const lower = text.toLowerCase()
    const names = complexNames.filter((n) => text.includes(n))
    const opaque = complexIds.filter((id) => lower.includes(id))
    const nameRe = names.length ? wholeWordRe(names, 'gu') : null
    const opaqueRe = opaque.length
      ? new RegExp(
          `(?<![\\p{L}\\p{N}_-])(?:${opaque.map(escapeRe).join('|')})(?![\\p{L}\\p{N}_-])`,
          'giu'
        )
      : null
    const out = []
    text.split('\n').forEach((line, i) => {
      const hits = []
      matchIds(line, hits)
      if (opaqueRe) {
        for (const m of line.matchAll(opaqueRe)) {
          hits.push({ kind: 'id', value: m[0] })
        }
      }
      if (simpleNames.size) {
        for (const m of line.matchAll(WORD_RUN)) {
          if (simpleNames.has(m[0])) {
            hits.push({ kind: 'name', value: m[0] })
          }
        }
      }
      if (nameRe) {
        for (const m of line.matchAll(nameRe)) {
          hits.push({ kind: 'name', value: m[0] })
        }
      }
      for (const hit of hits) {
        if (hit.kind === 'name' && isGameTerm(hit.value)) continue
        out.push({ line: i + 1, ...hit })
      }
    })
    return out
  }
}

export function scanTexts(texts, scanText) {
  const out = []
  for (const [file, text] of Object.entries(texts)) {
    if (text === null) continue
    for (const hit of scanText(text)) out.push({ file, ...hit })
  }
  return out
}

/** Number of texts containing each name, whole-word and case-sensitive. */
export function nameDocFrequency(names, texts) {
  const freq = new Map([...names].map((n) => [n, 0]))
  const simple = [...names].filter(isWordRun)
  const complex = [...names].filter((n) => !isWordRun(n))
  for (const text of texts) {
    if (!text) continue
    const present = simple.filter((n) => text.includes(n))
    if (present.length) {
      const words = new Set(text.match(WORD_RUN))
      for (const n of present) if (words.has(n)) freq.set(n, freq.get(n) + 1)
    }
    for (const n of complex) {
      if (text.includes(n) && wholeWordRe([n], 'u').test(text)) {
        freq.set(n, freq.get(n) + 1)
      }
    }
  }
  return freq
}

export function dropCommonNames(hits, freq) {
  return hits.filter(
    (h) => h.kind !== 'name' || (freq.get(h.value) ?? 0) <= MAX_NAME_FILES
  )
}

const formatHit = (h) => `${h.file}:${h.line}: ${h.kind} ${mask(h.value)}`

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
    .split('\0')
    .filter(Boolean)
}

function readText(file) {
  const abs = path.resolve(ROOT, file)
  let fd
  try {
    fd = fs.openSync(abs, 'r')
  } catch {
    return null
  }
  try {
    // Stat and read the same descriptor so the file cannot change in between.
    if (!fs.fstatSync(fd).isFile()) return null
    const bytes = fs.readFileSync(fd)
    if (bytes.includes(0)) return null
    return bytes.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function gameCorpus() {
  return trackedFiles()
    .filter((f) => GAME_DATA_PREFIXES.some((p) => f.startsWith(p)))
    .filter((f) => f !== ALLOW_FILE)
    .map((f) => readText(f) ?? '')
    .join('\n')
    .toLowerCase()
}

function loadAllow() {
  const text = readText(ALLOW_FILE)
  return text === null ? new Set() : parseAllow(text)
}

function run(files, { optional }) {
  const known = knownFilePath()
  const knownEntries = loadKnown(known)
  if (knownEntries === null) {
    if (optional) {
      console.log('real-identity scan skipped: known-identities file not found')
      process.exit(0)
    }
    console.error(
      'known-identities file not found (set TA_KNOWN_IDENTITIES_FILE or run scripts/security/refresh-known-identities.sh)'
    )
    process.exit(2)
  }
  const scanText = buildScanner(knownEntries, {
    allowHashes: loadAllow(),
    gameCorpus: gameCorpus()
  })
  const texts = {}
  for (const file of files) {
    const rel = path
      .relative(ROOT, path.resolve(ROOT, file))
      .split(path.sep)
      .join('/')
    if (rel.split('/').includes('node_modules')) continue
    texts[rel] = readText(rel)
  }
  let hits = scanTexts(texts, scanText)
  const candidates = new Set(
    hits.filter((h) => h.kind === 'name').map((h) => h.value)
  )
  if (candidates.size) {
    // Frequency is over the whole tracked tree, even in --files mode.
    const tree = trackedFiles().map((f) =>
      f in texts ? texts[f] : readText(f)
    )
    hits = dropCommonNames(hits, nameDocFrequency(candidates, tree))
  }
  if (hits.length) {
    for (const hit of hits) console.error(formatHit(hit))
    const nameFiles = new Map()
    for (const h of hits.filter((x) => x.kind === 'name')) {
      nameFiles.set(h.value, (nameFiles.get(h.value) ?? new Set()).add(h.file))
    }
    for (const [name, inFiles] of nameFiles) {
      console.error(`name ${mask(name)} in ${inFiles.size} file(s)`)
    }
    console.error(
      `Real-identity scan FAILED: ${hits.length} hit(s). Replace with synthetic data; allowlist a name only via --allow-hash.`
    )
    process.exit(1)
  }
  console.log(`Real-identity scan passed (${Object.keys(texts).length} files)`)
}

function selfTest() {
  const id = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0'
  const opaque = 'gld_q7w8e9r0t1'
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-identity-selftest-'))
  const knownPath = path.join(dir, 'known.txt')
  try {
    fs.writeFileSync(
      knownPath,
      [
        `id:${id}`,
        `id:${opaque}`,
        'id:987654321098765432',
        'id:876543210987654321',
        'name:Zyxwvutor',
        'name:Quolbrand',
        'name:Calgar',
        'name:Abc',
        'name:Player#1234',
        ''
      ].join('\n'),
      { mode: 0o600 }
    )
    const scanText = buildScanner(loadKnown(knownPath), {
      allowHashes: new Set([
        sha256Name('Quolbrand'),
        sha256Name('876543210987654321')
      ]),
      gameCorpus: 'marneus calgar leads the ultramarines'
    })
    const cases = [
      ['full id', `const u = '${id}'`, ['id']],
      ['upper id', id.toUpperCase(), ['id']],
      ['compact id', compact(id), ['id']],
      ['id prefix', 'user 0f1e2d3c4b5a logged in', ['id-prefix']],
      ['short prefix', 'see 0f1e2d3c', ['id-prefix']],
      ['hyphen prefix', 'user 0f1e2d3c-4b5a', ['id-prefix']],
      ['opaque id', `guild ${opaque} synced`, ['id']],
      ['name', 'hello Zyxwvutor!', ['name']],
      ['name other case', 'zyxwvutor said', []],
      ['name joined by underscore', 'Zyxwvutor_team', []],
      ['name inside word', 'NotZyxwvutorX', []],
      ['allowlisted name', 'Quolbrand', []],
      ['game term', 'Calgar', []],
      ['short name', 'Abc', []],
      ['player placeholder', 'Player#1234', []],
      ['other uuid', '11111111-2222-4333-8444-555555555555', []],
      ['letters-only prefix', 'deadbeef', []],
      ['discord id', 'channels/987654321098765432/1', ['id']],
      ['other digit run', '100000000000000001', []],
      ['allowlisted id', 'channels/876543210987654321/1', []],
      ['longer digit run', '9876543210987654321', []]
    ]
    for (const [label, line, expected] of cases) {
      const got = scanText(line).map((h) => h.kind)
      if (JSON.stringify(got) !== JSON.stringify(expected)) {
        throw new Error(
          `selftest '${label}': expected [${expected}] got [${got}]`
        )
      }
    }
    const common = 'Vrellingham'
    const tree = {
      'a.ts': `x ${id} Zyxwvutor ${opaque}\n`,
      'b.ts': `${common} ${common}\n`,
      'c.ts': `${common}\n`,
      'd.ts': `${common}\n`,
      'e.ts': `${common}\n`,
      'f.ts': `${common}!\n`,
      'g.ts': `vrellingham ${common}_x\n`
    }
    const commonScan = buildScanner(
      { ids: new Set(), names: new Set(['Zyxwvutor', common]) },
      { allowHashes: new Set(), gameCorpus: '' }
    )
    const raw = scanTexts(tree, commonScan)
    const freq = nameDocFrequency(
      new Set(raw.map((h) => h.value)),
      Object.values(tree)
    )
    const kept = dropCommonNames(raw, freq)
    if (
      freq.get(common) !== 5 ||
      freq.get('Zyxwvutor') !== 1 ||
      kept.length !== 1 ||
      kept[0].file !== 'a.ts'
    ) {
      throw new Error(
        `selftest: document-frequency rule wrong (${kept.length} kept)`
      )
    }
    const output = scanTexts({ 'a.ts': tree['a.ts'] }, scanText)
      .map(formatHit)
      .join('\n')
    for (const secret of [
      id,
      compact(id),
      'Zyxwvutor',
      opaque,
      id.slice(0, 8)
    ]) {
      if (output.includes(secret)) {
        throw new Error('selftest: output leaked an unmasked identity')
      }
    }
    if (!output.includes('a.ts:1: id 0f******')) {
      throw new Error(`selftest: unexpected output format: ${output}`)
    }
    fs.chmodSync(knownPath, 0o644)
    const loose = execFileSync(
      process.execPath,
      [new URL(import.meta.url).pathname, '--scan'],
      {
        cwd: ROOT,
        env: { ...process.env, TA_KNOWN_IDENTITIES_FILE: knownPath },
        encoding: 'utf8',
        stdio: 'pipe'
      }
    ).toString()
    throw new Error(`selftest: a mode-644 known file was accepted: ${loose}`)
  } catch (err) {
    if (err.status !== 2) throw err
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  try {
    parseAllow('[{"sha256":"abc","why":"x"}]')
    throw new Error('selftest: malformed allowlist entry accepted')
  } catch (err) {
    if (!/sha256 hex digest/u.test(err.message)) throw err
  }
  console.log('real-identity positive and negative controls passed')
}

function allowHash() {
  const name = fs.readFileSync(0, 'utf8').split(/\r?\n/u)[0].trim()
  if (!name) {
    console.error(
      'usage: printf "%s" "<name>" | check-real-identities.mjs --allow-hash'
    )
    process.exit(2)
  }
  console.log(
    JSON.stringify({
      sha256: sha256Name(name),
      why: 'REPLACE: public credit | game term'
    })
  )
}

const args = process.argv.slice(2)
const optional = args.includes('--optional')
const rest = args.filter((a) => a !== '--optional')
const [command, ...paths] = rest
if (command === '--selftest') selfTest()
else if (command === '--scan' || command === undefined) {
  run(trackedFiles(), { optional })
} else if (command === '--files') run(paths, { optional })
else if (command === '--allow-hash') allowHash()
else {
  console.error(
    'usage: check-real-identities.mjs [--optional] [--selftest|--scan|--files <paths...>|--allow-hash]'
  )
  process.exit(2)
}
