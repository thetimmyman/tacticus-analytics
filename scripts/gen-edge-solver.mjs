#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const SOURCE = 'packages/solver-core/src/solver.ts'
const TARGET = 'supabase/functions/boss-assignment-solver/solver.ts'
const BANNER =
  [
    `// GENERATED FILE — do not edit. Source: ${SOURCE}.`,
    '// Regenerate: npm run gen:edge-solver.',
    "// The edge runtime can't resolve workspace packages, so this is a vendored copy."
  ].join('\n') + '\n\n'
const CONTEXT = 3

function generate() {
  return BANNER + readFileSync(path.resolve(SOURCE), 'utf8')
}

function diffLines(expected, actual) {
  const a = actual.split('\n')
  const b = expected.split('\n')
  const cols = b.length + 1
  const lcs = new Int32Array((a.length + 1) * cols)

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * cols + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * cols + j + 1] + 1
          : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1])
    }
  }

  const lines = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push(` ${a[i]}`)
      i += 1
      j += 1
    } else if (lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1]) {
      lines.push(`-${a[i]}`)
      i += 1
    } else {
      lines.push(`+${b[j]}`)
      j += 1
    }
  }
  while (i < a.length) {
    lines.push(`-${a[i]}`)
    i += 1
  }
  while (j < b.length) {
    lines.push(`+${b[j]}`)
    j += 1
  }

  return lines
}

function toHunks(lines) {
  const kept = new Set()
  lines.forEach((line, index) => {
    if (line.startsWith(' ')) return
    for (let offset = -CONTEXT; offset <= CONTEXT; offset += 1)
      kept.add(index + offset)
  })

  const hunks = []
  let elided = false
  lines.forEach((line, index) => {
    if (kept.has(index)) {
      hunks.push(line)
      elided = false
    } else if (!elided) {
      hunks.push('@@')
      elided = true
    }
  })

  return hunks
}

const expected = generate()
const targetPath = path.resolve(TARGET)

if (process.argv.slice(2).includes('--check')) {
  const actual = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : ''

  if (actual !== expected) {
    console.error(
      `gen-edge-solver: ${TARGET} is out of date (- on disk, + expected from ${SOURCE}):`
    )
    toHunks(diffLines(expected, actual)).forEach((line) => console.error(line))
    console.error('gen-edge-solver: run `npm run gen:edge-solver` to refresh.')
    process.exit(1)
  }

  console.log(`gen-edge-solver: ${TARGET} matches ${SOURCE}.`)
} else {
  writeFileSync(targetPath, expected)
  console.log(`gen-edge-solver: wrote ${TARGET} from ${SOURCE}.`)
}
