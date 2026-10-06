import { strict as assert } from 'node:assert'
import { cp, readFile, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './native-services.mjs'
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const evidence = {
  status: 'passed',
  results: [],
  scope:
    'Native synthetic migration controls; cancellation before COMMIT and marker-write failure after COMMIT'
}
const base = await nativeServices(config)
try {
  assert.equal(
    (await base.psql('SELECT count(*) FROM public."EOT_GR_data";')).trim(),
    '8'
  )
} finally {
  await base.stop()
}
const source = config.state
async function run(mode) {
  const state = `${config.state}-migration-${mode}-${randomUUID()}`,
    schemaDirectory = state + '-schema'
  await cp(source, state, { recursive: true, errorOnExist: true, force: false })
  await cp(config.schemaDirectory, schemaDirectory, {
    recursive: true,
    errorOnExist: true,
    force: false
  })
  const old = await readFile(join(state, 'schema-version'), 'utf8')
  const canonical = await readFile(
    join(schemaDirectory, 'canonical-objects.sql'),
    'utf8'
  )
  const authority = await readFile(
    join(schemaDirectory, 'authority.sql'),
    'utf8'
  )
  // Match the runtime's hash order: canonical then authority.
  const suffix = `\n-- Synthetic interruption control ${mode}\n`
  await writeFile(
    join(schemaDirectory, 'canonical-objects.sql'),
    canonical + suffix
  )
  const target = createHash('sha256')
    .update(canonical + suffix)
    .update(authority)
    .digest('hex')
  const sql = `INSERT INTO public.guild_config(id,guild_code,display_name) VALUES(801,'SYN-MIGRATION-ONCE','Synthetic interruption');\nSELECT pg_sleep(15);\nGRANT SELECT ON public.feature_releases TO authenticated,desktop_rpc_reader;\n`
  const sha256 = createHash('sha256').update(sql).digest('hex')
  await writeFile(
    join(schemaDirectory, 'migrations/001-feature-catalog-read.sql'),
    sql
  )
  await writeFile(
    join(schemaDirectory, 'migrations.json'),
    JSON.stringify([
      { from: old, to: target, file: '001-feature-catalog-read.sql', sha256 }
    ])
  )
  const updated = { ...config, state, schemaDirectory }
  const controller = new AbortController()
  const activation = nativeServices(updated, { signal: controller.signal })
  let activationError
  let activationResult
  // Attach immediately: a startup failure must not become an unhandled rejection.
  const settled = activation.then(
    (value) => (activationResult = { value }),
    (error) => (activationResult = { error })
  )
  async function query(sql) {
    const lines = (
      await readFile(join(state, 'pgdata/postmaster.pid'), 'utf8')
    ).split('\n')
    const port = Number(lines[3])
    assert(Number.isInteger(port) && port > 0 && port < 65536)
    const credentials = JSON.parse(
      await readFile(join(state, 'credentials.json'), 'utf8')
    )
    return await new Promise((resolve, reject) => {
      const child = spawn(
        config.binaries.psql,
        [
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-h',
          '127.0.0.1',
          '-p',
          String(port),
          '-U',
          'desktop_owner',
          '-d',
          'postgres',
          '-At'
        ],
        {
          env: {
            PATH: process.env.PATH,
            LANG: 'C.UTF-8',
            LD_LIBRARY_PATH: config.libraryPath,
            PGPASSWORD: credentials.owner,
            PGCONNECT_TIMEOUT: '2'
          },
          stdio: ['pipe', 'pipe', 'ignore']
        }
      )
      let out = ''
      child.stdout.on('data', (bytes) => (out += bytes))
      child.once('error', reject)
      child.stdin.once('error', reject)
      child.once('close', (code) =>
        code === 0
          ? resolve(out.trim())
          : reject(new Error('Control SQL failed'))
      )
      child.stdin.end(sql)
    })
  }
  try {
    // Checkpoint fsync precedes database startup and may exceed the pause budget.
    // Start that budget only after a real control connection succeeds.
    const startupDeadline = Date.now() + 90000
    let pauseDeadline
    let sleeping = false
    while (Date.now() < (pauseDeadline ?? startupDeadline)) {
      if (activationResult?.error) throw activationResult.error
      if (activationResult?.value) break
      try {
        const count = await query(
          "SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep';"
        )
        pauseDeadline ??= Date.now() + 30000
        sleeping = count === '1'
      } catch {}
      if (sleeping) break
      await delay(100)
    }
    assert(sleeping, 'migration did not reach its transaction pause')
    if (mode === 'before-commit') controller.abort()
    else await chmod(state, 0o500)
    const result = await settled
    activationError = result.error
    if (result.value) await result.value.stop()
    assert(activationError, 'interruption must reject startup')
    if (mode === 'before-commit')
      assert.equal(activationError.name, 'AbortError')
    else assert.equal(activationError.code, 'EACCES')
  } catch (error) {
    controller.abort()
    const result = await settled
    if (result.value) await result.value.stop()
    throw error
  } finally {
    await chmod(state, 0o700)
  }
  const pending = JSON.parse(
    await readFile(join(state, 'schema-version'), 'utf8')
  )
  assert.equal(pending.to, target)
  await assert.rejects(
    nativeServices({ ...config, state }),
    /Incompatible local schema/
  )
  const recovered = await nativeServices(updated)
  try {
    assert.equal(
      (
        await recovered.psql(
          "SELECT count(*) FROM public.guild_config WHERE guild_code='SYN-MIGRATION-ONCE';"
        )
      ).trim(),
      '1'
    )
    assert.equal(
      (
        await recovered.psql('SELECT count(*) FROM public."EOT_GR_data";')
      ).trim(),
      '8'
    )

    assert.equal(await readFile(join(state, 'schema-version'), 'utf8'), target)
    assert.equal(
      (
        await recovered.psql(
          'SELECT count(*) FROM public.desktop_runtime_schema;'
        )
      ).trim(),
      '1'
    )
  } finally {
    await recovered.stop()
  }
  return {
    mode,
    status: 'passed',
    checks: [
      'pending activation blocks old application',
      'retry preserves prior rows',
      'migration row committed exactly once',
      'database receipt and filesystem marker converge'
    ],
    state
  }
}
for (const mode of ['before-commit', 'after-commit'])
  evidence.results.push(await run(mode))
if (config.evidence)
  await writeFile(
    config.evidence.replace(/\.json$/, '-schema-interruption.json'),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 }
  )
console.log(JSON.stringify(evidence, null, 2))
