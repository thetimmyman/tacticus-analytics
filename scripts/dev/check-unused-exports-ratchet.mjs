#!/usr/bin/env node
// One-way ratchet over Knip's unused exports: new ones fail unless hand-added to the
// baseline; stale entries fail until `--update` prunes them. Identity has no line numbers.
// Usage: check-unused-exports-ratchet.mjs [--check|--update|--selftest] [--from <knip-json-file>]

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const BASELINE_PATH = path.join(ROOT, 'config', 'unused-exports-baseline.json')

// `classMembers` is listed in case the scan opts in; `duplicates` is handled below.
const EXPORT_CATEGORIES = [
  'exports',
  'types',
  'enumMembers',
  'namespaceMembers',
  'classMembers'
]

function extractIdentities(report) {
  const ids = new Set()
  for (const issue of report.issues ?? []) {
    const file = issue.file
    for (const category of EXPORT_CATEGORIES) {
      for (const finding of issue[category] ?? []) {
        ids.add(`${file} ${category} ${finding.name}`)
      }
    }
    // One identity per member, so a partial cleanup reads as a shrink, not an addition.
    for (const duplicateSet of issue.duplicates ?? []) {
      for (const member of duplicateSet) {
        ids.add(`${file} duplicates ${member.name}`)
      }
    }
  }
  return ids
}

function diffAgainstBaseline(currentIds, baselineIds) {
  const added = [...currentIds].filter((id) => !baselineIds.has(id)).sort()
  const removed = [...baselineIds].filter((id) => !currentIds.has(id)).sort()
  return { added, removed }
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`missing baseline: ${path.relative(ROOT, BASELINE_PATH)}`)
    console.error(
      'generate one with: node scripts/dev/check-unused-exports-ratchet.mjs --update'
    )
    process.exit(1)
  }
  const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  if (!Array.isArray(parsed.entries)) {
    console.error(
      'baseline is malformed: expected an { entries: [...] } object'
    )
    process.exit(1)
  }
  return new Set(parsed.entries)
}

function writeBaseline(entries) {
  const payload = {
    $comment:
      'Accepted legacy unused exports. check-unused-exports-ratchet.mjs ' +
      'fails CI on any export not listed here and prunes resolved entries via --update; ' +
      'it never adds. Additions are hand edits reviewed in the PR that makes them.',
    entries: [...entries].sort()
  }
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`)
}

function runKnip(fromFile) {
  if (fromFile) return JSON.parse(fs.readFileSync(fromFile, 'utf8'))
  const stdout = execFileSync(
    'npx',
    [
      'knip',
      '--exports',
      '--include-entry-exports',
      '--reporter',
      'json',
      '--no-exit-code'
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  return JSON.parse(stdout)
}

function selfTest() {
  const report = {
    issues: [
      {
        file: 'a.ts',
        exports: [{ name: 'x', line: 1, col: 1, pos: 0 }],
        types: [{ name: 'T', line: 2, col: 1, pos: 10 }],
        enumMembers: [],
        namespaceMembers: [],
        duplicates: [
          [
            { name: 'x', line: 1, col: 1, pos: 0 },
            { name: 'default', line: 9, col: 1, pos: 90 }
          ]
        ]
      }
    ]
  }
  const ids = extractIdentities(report)
  const expected = [
    'a.ts exports x',
    'a.ts types T',
    'a.ts duplicates x',
    'a.ts duplicates default'
  ]
  for (const id of expected) {
    if (!ids.has(id))
      throw new Error(`selftest: expected identity missing: ${id}`)
  }
  if (ids.size !== expected.length) {
    throw new Error(
      `selftest: expected ${expected.length} identities, got ${ids.size}`
    )
  }

  const moved = structuredClone(report)
  moved.issues[0].exports[0].line = 400
  if (
    extractIdentities(moved).size !== ids.size ||
    diffAgainstBaseline(extractIdentities(moved), ids).added.length !== 0
  ) {
    throw new Error('selftest: line movement changed identity')
  }

  const grown = structuredClone(report)
  grown.issues[0].exports.push({ name: 'y', line: 3, col: 1, pos: 20 })
  const growth = diffAgainstBaseline(extractIdentities(grown), ids)
  if (growth.added.join() !== 'a.ts exports y' || growth.removed.length !== 0) {
    throw new Error('selftest: growth was not detected as added')
  }

  const withClassMember = structuredClone(report)
  withClassMember.issues[0].classMembers = [
    { name: 'Widget.unusedMethod', line: 5, col: 3, pos: 40 }
  ]
  const classGrowth = diffAgainstBaseline(
    extractIdentities(withClassMember),
    ids
  )
  if (classGrowth.added.join() !== 'a.ts classMembers Widget.unusedMethod') {
    throw new Error('selftest: classMembers finding was not detected')
  }

  const partialDupCleanup = structuredClone(report)
  partialDupCleanup.issues[0].duplicates = [
    [{ name: 'x', line: 1, col: 1, pos: 0 }]
  ]
  const dupDiff = diffAgainstBaseline(extractIdentities(partialDupCleanup), ids)
  if (
    dupDiff.added.length !== 0 ||
    dupDiff.removed.join() !== 'a.ts duplicates default'
  ) {
    throw new Error(
      'selftest: partial duplicate cleanup did not read as pure shrink'
    )
  }

  const shrunk = structuredClone(report)
  shrunk.issues[0].types = []
  const shrink = diffAgainstBaseline(extractIdentities(shrunk), ids)
  if (shrink.removed.join() !== 'a.ts types T' || shrink.added.length !== 0) {
    throw new Error('selftest: shrink was not detected as removed')
  }

  console.log('unused-exports ratchet selftest OK')
}

function main() {
  const argv = process.argv.slice(2)
  const mode = argv.includes('--update')
    ? 'update'
    : argv.includes('--selftest')
      ? 'selftest'
      : 'check'
  const fromIndex = argv.indexOf('--from')
  const fromFile = fromIndex === -1 ? undefined : argv[fromIndex + 1]

  if (mode === 'selftest') {
    selfTest()
    return
  }

  const currentIds = extractIdentities(runKnip(fromFile))

  if (mode === 'update') {
    if (fs.existsSync(BASELINE_PATH)) {
      const { added } = diffAgainstBaseline(currentIds, readBaseline())
      if (added.length > 0) {
        console.error(
          `--update refuses to grow the baseline; ${added.length} new unused export(s):`
        )
        for (const id of added) console.error(`  + ${id}`)
        console.error(
          'remove the export, use it, or hand-add an entry with rationale in the PR.'
        )
        process.exit(1)
      }
      writeBaseline([...readBaseline()].filter((id) => currentIds.has(id)))
    } else {
      writeBaseline(currentIds)
    }
    console.log(`baseline written: ${path.relative(ROOT, BASELINE_PATH)}`)
    return
  }

  const { added, removed } = diffAgainstBaseline(currentIds, readBaseline())
  if (added.length > 0) {
    console.error(
      `${added.length} unused export(s) not in the accepted baseline:`
    )
    for (const id of added) console.error(`  + ${id}`)
    console.error(
      'remove the export, use it, or hand-add a baseline entry with rationale in this PR.'
    )
  }
  if (removed.length > 0) {
    console.error(
      `${removed.length} baseline entr(y/ies) are resolved — ratchet down:`
    )
    for (const id of removed) console.error(`  - ${id}`)
    console.error(
      'run: node scripts/dev/check-unused-exports-ratchet.mjs --update'
    )
  }
  if (added.length > 0 || removed.length > 0) process.exit(1)
  console.log(
    `unused-exports ratchet OK (${currentIds.size} accepted legacy entries)`
  )
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
