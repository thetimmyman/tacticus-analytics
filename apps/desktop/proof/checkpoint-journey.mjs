import { strict as assert } from 'node:assert'
import { readFile, writeFile, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { nativeServices } from './native-services.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const evidence = { checks: [] }
let services = await nativeServices(config)
try {
  const rows = (
    await services.psql(
      'SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public."EOT_GR_data" d;'
    )
  ).trim()
  assert.equal(JSON.parse(rows).length, 8)
  // A dependency failure stops the owned stack instead of serving partial data.
  const authExited = new Promise((accept) =>
    services.children[1].once('exit', accept)
  )
  services.children[1].kill('SIGKILL')
  await authExited
  await services.stop()
  assert.ok(services.fault)
  services = await nativeServices(config)
  assert.equal(
    (
      await services.psql(
        'SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public."EOT_GR_data" d;'
      )
    ).trim(),
    rows
  )
  await services.stop()
  const schema = await readFile(join(config.state, 'schema-version'), 'utf8')
  await writeFile(join(config.state, 'schema-version'), 'incompatible', {
    mode: 0o600
  })
  try {
    await assert.rejects(nativeServices(config), /Incompatible local schema/)
  } finally {
    await writeFile(join(config.state, 'schema-version'), schema, {
      mode: 0o600
    })
  }
  // Clean shutdown is the consistent filesystem checkpoint. Recovery restores the
  // same installation identity; fresh-install key rotation is a separate gate.
  const checkpoint = `${config.state}-checkpoint-${process.pid}`
  const restored = `${config.state}-restored-${process.pid}`
  await cp(config.state, checkpoint, {
    recursive: true,
    errorOnExist: true,
    force: false
  })
  await cp(checkpoint, restored, {
    recursive: true,
    errorOnExist: true,
    force: false
  })
  services = await nativeServices({ ...config, state: restored })
  assert.equal(
    (
      await services.psql(
        'SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public."EOT_GR_data" d;'
      )
    ).trim(),
    rows
  )
  evidence.checks = [
    'service crash stops owned stack',
    'restart retains eight canonical rows',
    'incompatible schema activation rejected before services',
    'consistent stopped-state checkpoint',
    'restore into another private directory retains normalized rows'
  ]
  evidence.identity =
    'Recovery of the same installation; not fresh-install identity migration or key rotation'
  evidence.checkpoint = checkpoint
  await writeFile(
    config.evidence.replace('.json', '-checkpoint.json'),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 }
  )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await services.stop()
}
