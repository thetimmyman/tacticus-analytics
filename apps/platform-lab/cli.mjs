import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { generateFixture } from './fixtures.mjs'
import { validateEvidence, validateFixture } from './contracts/validate.mjs'
import { inventoryLocal } from './inventory.mjs'
import { readPlan, runPlan } from './runner.mjs'
import { resetWorkspace } from './workspace.mjs'

const [command, path, extra] = process.argv.slice(2)
if (extra || !path)
  throw new Error(
    'Usage: cli.mjs fixture|inventory|run|reset|validate <absolute private path>'
  )
if (resolve(path) !== path) throw new Error('Absolute private path required')
if (command === 'fixture' || command === 'inventory') {
  const value =
    command === 'fixture' ? generateFixture() : await inventoryLocal()
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx'
  })
  console.log(`${command} written to the requested private file.`)
} else if (command === 'run') {
  const result = await runPlan(await readPlan(path))
  console.log(
    JSON.stringify(
      {
        workspace: result.workspace,
        results: result.records.map((record) => ({
          scenario: record.scenario.id,
          status: record.outcome.status
        }))
      },
      null,
      2
    )
  )
  if (result.records.some((record) => record.outcome.status !== 'pass'))
    process.exitCode = 1
} else if (command === 'reset') {
  await resetWorkspace(path)
  console.log('Disposable fixture state reset; evidence retained.')
} else if (command === 'validate') {
  const value = JSON.parse(await readFile(path, 'utf8'))
  if (value.schemaVersion === 'platform-fixture/v1') validateFixture(value)
  else validateEvidence(value)
  console.log('Contract validation passed.')
} else throw new Error('Unknown lab command')
