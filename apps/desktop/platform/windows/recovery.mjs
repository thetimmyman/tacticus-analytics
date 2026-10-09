import assert from 'node:assert/strict'
import { cp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { nativeServices } from './services.mjs'
import { captureRecoveryFailure } from './launch-diagnostic.mjs'

// Installed synthetic qualification uses the actual bundled database/Auth/REST components.
export async function recoveryJourney(initial, config, evidencePath) {
  let services = initial
  const checks = []
  const trace = { step: 'initial-snapshot' }
  const snapshot = async () =>
    (
      await services.psql(
        'SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public."EOT_GR_data" d;'
      )
    ).trim()
  try {
    const before = await snapshot()
    trace.step = 'initial-row-count'
    assert.equal(JSON.parse(before).length, 8)
    trace.step = 'initial-row-identity'
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
      trace.step = 'rollback-transaction-rejection'
      await assert.rejects(
        services.psql(
          'BEGIN; CREATE TABLE public.desktop_windows_failure_control(id integer); INSERT INTO public.desktop_windows_failure_control VALUES(1); SELECT 1/0; COMMIT;'
        )
      )
      trace.step = 'rollback-table-absent'
      assert.equal(
        (
          await services.psql(
            "SELECT to_regclass('public.desktop_windows_failure_control') IS NULL;"
          )
        ).trim(),
        't'
      )
      checks.push('failed-sql-transaction-retains-canonical-data')
      trace.step = 'auth-exit-wait'
      const exited = new Promise((accept) =>
        services.children[1].once('exit', accept)
      )
      services.children[1].kill()
      await exited
      trace.step = 'services-stop-after-auth'
      await services.stop()
      trace.step = 'auth-fault-present'
      assert.ok(services.fault)
      trace.step = 'restart-after-auth'
      services = await nativeServices(config)
      trace.step = 'rows-after-auth'
      assert.equal(await snapshot(), before)
      checks.push('actual-auth-crash-stops-stack-and-restart-retains-rows')
      trace.step = 'services-stop-before-schema'
      await services.stop()
      const schemaPath = join(config.state, 'schema-version')
      trace.step = 'schema-marker-read'
      const schema = await readFile(schemaPath, 'utf8')
      trace.step = 'schema-marker-write-incompatible'
      await writeFile(schemaPath, 'incompatible')
      try {
        trace.step = 'incompatible-schema-refusal'
        await assert.rejects(nativeServices(config), {
          code: 'ESCHEMA',
          message: 'Local schema state is incompatible; activation refused'
        })
      } catch (error) {
        trace.failure ??= { error, step: trace.step }
        throw error
      } finally {
        trace.step = 'schema-marker-restore'
        await writeFile(schemaPath, schema)
      }
      checks.push('incompatible-schema-refused-before-service-start')
      // A crash between the schema transaction and its marker file must not re-run the bootstrap.
      trace.step = 'schema-marker-remove'
      await rm(schemaPath)
      trace.step = 'restart-after-marker-loss'
      services = await nativeServices(config)
      trace.step = 'rows-after-marker-loss'
      assert.equal(await snapshot(), before)
      trace.step = 'services-stop-after-marker-loss'
      await services.stop()
      trace.step = 'schema-marker-restored'
      assert.equal(await readFile(schemaPath, 'utf8'), schema)
      checks.push('lost-schema-marker-restored-without-rebootstrap')
      const checkpoint = join(config.state, '.checkpoints', 'native-proof')
      trace.step = 'checkpoint-directory'
      await mkdir(checkpoint, { recursive: true })
      trace.step = 'checkpoint-copy'
      await cp(join(config.state, 'pgdata'), join(checkpoint, 'pgdata'), {
        recursive: true,
        force: false,
        errorOnExist: true
      })
      // Restore only the stopped database, retaining this installation's native vault binding.
      trace.step = 'checkpoint-remove-live'
      await rm(join(config.state, 'pgdata'), { recursive: true })
      trace.step = 'checkpoint-restore'
      await cp(join(checkpoint, 'pgdata'), join(config.state, 'pgdata'), {
        recursive: true,
        force: false,
        errorOnExist: true
      })
      trace.step = 'restart-after-checkpoint'
      services = await nativeServices(config)
      trace.step = 'rows-after-checkpoint'
      assert.equal(await snapshot(), before)
      checks.push('stopped-database-checkpoint-and-same-workspace-restore')
      trace.step = 'evidence-write'
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
    } catch (error) {
      trace.failure ??= { error, step: trace.step }
      throw error
    } finally {
      trace.step = 'services-stop-final'
      await services.stop()
    }
  } catch (error) {
    captureRecoveryFailure(error, trace)
    throw error
  }
}
