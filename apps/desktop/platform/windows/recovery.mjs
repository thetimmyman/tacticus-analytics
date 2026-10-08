import assert from 'node:assert/strict'
import { cp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { nativeServices } from './services.mjs'

// Installed synthetic qualification uses the actual bundled database/Auth/REST components.
export async function recoveryJourney(initial, config, evidencePath) {
  let services = initial
  const checks = []
  const snapshot = async () =>
    (
      await services.psql(
        'SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public."EOT_GR_data" d;'
      )
    ).trim()
  const before = await snapshot()
  assert.equal(JSON.parse(before).length, 8)
  assert.ok(
    JSON.parse(before).every((row) =>
      [
        'synthetic-player-a',
        'synthetic-player-b',
        'synthetic-player-c',
        'synthetic-player-d'
      ].includes(row.userId)
    )
  )
  try {
    await assert.rejects(
      services.psql(
        'BEGIN; CREATE TABLE public.desktop_windows_failure_control(id integer); INSERT INTO public.desktop_windows_failure_control VALUES(1); SELECT 1/0; COMMIT;'
      )
    )
    assert.equal(
      (
        await services.psql(
          "SELECT to_regclass('public.desktop_windows_failure_control') IS NULL;"
        )
      ).trim(),
      't'
    )
    checks.push('failed-sql-transaction-retains-canonical-data')
    const exited = new Promise((accept) =>
      services.children[1].once('exit', accept)
    )
    services.children[1].kill()
    await exited
    await services.stop()
    assert.ok(services.fault)
    services = await nativeServices(config)
    assert.equal(await snapshot(), before)
    checks.push('actual-auth-crash-stops-stack-and-restart-retains-rows')
    await services.stop()
    const schemaPath = join(config.state, 'schema-version')
    const schema = await readFile(schemaPath, 'utf8')
    await writeFile(schemaPath, 'incompatible')
    try {
      await assert.rejects(nativeServices(config), /Incompatible local schema/)
    } finally {
      await writeFile(schemaPath, schema)
    }
    checks.push('incompatible-schema-refused-before-service-start')
    // A crash between the schema transaction and its marker file must not re-run the bootstrap.
    await rm(schemaPath)
    services = await nativeServices(config)
    assert.equal(await snapshot(), before)
    await services.stop()
    assert.equal(await readFile(schemaPath, 'utf8'), schema)
    checks.push('lost-schema-marker-restored-without-rebootstrap')
    const checkpoint = join(config.state, '.checkpoints', 'native-proof')
    await mkdir(checkpoint, { recursive: true })
    await cp(join(config.state, 'pgdata'), join(checkpoint, 'pgdata'), {
      recursive: true,
      force: false,
      errorOnExist: true
    })
    // Restore only the stopped database, retaining this installation's native vault binding.
    await rm(join(config.state, 'pgdata'), { recursive: true })
    await cp(join(checkpoint, 'pgdata'), join(config.state, 'pgdata'), {
      recursive: true,
      force: false,
      errorOnExist: true
    })
    services = await nativeServices(config)
    assert.equal(await snapshot(), before)
    checks.push('stopped-database-checkpoint-and-same-workspace-restore')
    await writeFile(
      evidencePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          platform: 'win-x64',
          native: true,
          synthetic: true,
          checks,
          identity: 'same-installation-vault-binding',
          freshInstallationIdentityTransfer: false
        },
        null,
        2
      )
    )
  } finally {
    await services.stop()
  }
}
