import { strict as assert } from 'node:assert'
import { readFile, writeFile } from 'node:fs/promises'
import { nativeServices } from './native-services.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
assert(config.runtimeGuard, 'The inherited kernel lease must be real')
let services = await nativeServices(config)
try {
  const child = services.launch(
    process.execPath,
    [
      '-e',
      `
      const {spawn}=require('node:child_process');
      spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),2000)'],
        {stdio:['ignore',1,2,'ignore',4]});
      process.exit(0);
    `
    ],
    { PATH: process.env.PATH, LANG: 'C.UTF-8' },
    config.state,
    true,
    'optional'
  )
  await new Promise((accept, reject) => {
    child.once('exit', accept)
    child.once('error', reject)
  })
  const started = performance.now()
  await services.stop()
  assert(
    performance.now() - started >= 1500,
    'Shutdown must wait for the descendant-held pipes and lease'
  )
  services = await nativeServices(config)
  assert.equal(
    (await services.psql('SELECT count(*) FROM public."EOT_GR_data";')).trim(),
    '8'
  )
  const evidence = {
    status: 'passed',
    checks: [
      'synthetic child exits while its descendant retains output pipes and the real kernel lease',
      'shutdown waits for descriptor closure',
      'immediate native restart acquires the same lease and preserves eight raid rows'
    ]
  }
  if (config.evidence)
    await writeFile(
      config.evidence.replace('.json', '-shutdown-close.json'),
      JSON.stringify(evidence, null, 2),
      { mode: 0o600 }
    )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await services.stop()
}
