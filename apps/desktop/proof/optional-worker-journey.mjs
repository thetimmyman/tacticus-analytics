import { strict as assert } from 'node:assert'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './native-services.mjs'
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const services = await nativeServices(config)
try {
  const marker = join(services.state, `optional-worker-${randomUUID()}.json`)
  const worker = services.launch(
    process.execPath,
    [new URL('./optional-worker.mjs', import.meta.url).pathname, marker],
    { PATH: process.env.PATH },
    services.state,
    true,
    'optional'
  )
  const exited = new Promise((resolve) => worker.once('exit', resolve))
  const deadline = Date.now() + 15000
  let ready = false
  while (Date.now() < deadline) {
    try {
      ready = JSON.parse(await readFile(marker, 'utf8')).phase === 'running'
    } catch {}
    if (ready) break
    await delay(50)
  }
  assert(ready, 'optional native worker did not start')
  worker.kill('SIGKILL')
  await exited
  assert.equal(services.fault, undefined)
  assert.equal(
    (await services.psql('SELECT count(*) FROM public."EOT_GR_data";')).trim(),
    '8'
  )
  const authExit = new Promise((resolve) =>
    services.children[1].once('exit', resolve)
  )
  services.children[1].kill('SIGKILL')
  await authExit
  await services.stop()
  assert(
    services.fault,
    'core authentication failure must stop the owned stack'
  )
  const evidence = {
    status: 'passed',
    checks: [
      'optional managed worker SIGKILL preserves native database access',
      'core Auth SIGKILL still stops the owned stack'
    ],
    scope:
      'native supervisor failure policy; durable job state is exercised separately'
  }
  if (config.evidence)
    await writeFile(
      config.evidence.replace(/\.json$/, '-optional-worker.json'),
      JSON.stringify(evidence, null, 2),
      { mode: 0o600 }
    )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await services.stop()
}
