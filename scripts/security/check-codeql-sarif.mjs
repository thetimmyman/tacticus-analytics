#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const roots = process.argv.slice(2)

if (roots.length === 0) {
  console.error('Usage: check-codeql-sarif.mjs <SARIF file or directory> [...]')
  process.exit(2)
}

async function collectSarifFiles(entry) {
  const metadata = await stat(entry)
  if (metadata.isFile()) return entry.endsWith('.sarif') ? [entry] : []

  const children = await readdir(entry)
  const nested = await Promise.all(
    children.map((child) => collectSarifFiles(path.join(entry, child)))
  )
  return nested.flat()
}

const files = (await Promise.all(roots.map(collectSarifFiles))).flat().sort()

if (files.length === 0) {
  console.error(`No SARIF files found beneath: ${roots.join(', ')}`)
  process.exit(2)
}

const findings = []

for (const file of files) {
  const sarif = JSON.parse(await readFile(file, 'utf8'))
  for (const run of sarif.runs ?? []) {
    for (const result of run.results ?? []) {
      if ((result.suppressions ?? []).length > 0) continue

      const location = result.locations?.[0]?.physicalLocation
      const artifact = location?.artifactLocation?.uri ?? '<unknown>'
      const line = location?.region?.startLine ?? 1
      findings.push({
        file,
        rule: result.ruleId ?? '<unknown>',
        level: result.level ?? 'warning',
        message: result.message?.text ?? '<no message>',
        location: `${artifact}:${line}`
      })
    }
  }
}

if (findings.length > 0) {
  console.error(`CodeQL reported ${findings.length} unsuppressed finding(s):`)
  for (const finding of findings) {
    console.error(
      `- [${finding.level}] ${finding.rule} at ${finding.location}: ${finding.message}`
    )
  }
  process.exit(1)
}

console.log(
  `CodeQL SARIF gate passed (${files.length} file${files.length === 1 ? '' : 's'}, 0 findings).`
)
