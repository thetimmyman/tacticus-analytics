import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

async function command(file, args, environment) {
  const child = spawn(file, args, {
    env: environment,
    stdio: ['ignore', 'ignore', 'ignore']
  })
  await new Promise((accept, reject) => {
    child.once('error', () =>
      reject(new Error('Packaged recovery tool unavailable'))
    )
    child.once('exit', (code) =>
      code === 0
        ? accept()
        : reject(new Error('Packaged recovery operation failed'))
    )
  })
}

// Developer qualification exercises the exact bundled dump/restore tools against
// an owned disposable database. It never overwrites the active database.
export async function qualifyRecovery({ services, postgres, state }) {
  const credentials = JSON.parse(
    await readFile(join(state, 'credentials.json'), 'utf8')
  )
  const environment = { PATH: '/usr/bin:/bin', PGPASSWORD: credentials.owner }
  const connection = [
    '-h',
    '127.0.0.1',
    '-p',
    String(services.ports.db),
    '-U',
    'desktop_owner'
  ]
  const backup = join(state, 'qualification.backup')
  await command(
    join(postgres, 'bin/pg_dump'),
    [
      ...connection,
      '-d',
      'postgres',
      '--format=custom',
      '--compress=none',
      '--no-owner',
      '--file',
      backup
    ],
    environment
  )
  const bytes = await readFile(backup)
  const digest = createHash('sha256').update(bytes).digest('hex')
  await writeFile(
    join(state, 'qualification.backup.json'),
    JSON.stringify({
      version: 1,
      sha256: digest,
      format: 'postgres-custom',
      vault: 'excluded'
    }),
    { mode: 0o600 }
  )
  await services.psql('CREATE DATABASE desktop_macos_restore;')
  try {
    await command(
      join(postgres, 'bin/pg_restore'),
      [
        ...connection,
        '-d',
        'desktop_macos_restore',
        '--no-owner',
        '--no-acl',
        backup
      ],
      environment
    )
    const probe = join(state, 'recovery-probe.sql')
    await writeFile(
      probe,
      `DO $$ BEGIN IF (SELECT count(*) FROM public."EOT_GR_data") <> 8 OR (SELECT count(*) FROM auth.users) <> 1 THEN RAISE EXCEPTION 'Restored fixture differs'; END IF; END $$;`,
      { mode: 0o600 }
    )
    await command(
      join(postgres, 'bin/psql'),
      [
        ...connection,
        '-d',
        'desktop_macos_restore',
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        probe
      ],
      environment
    )
  } finally {
    await services.psql('DROP DATABASE desktop_macos_restore WITH (FORCE);')
  }
  return {
    sha256: digest,
    vault: 'excluded',
    restoredRows: 8,
    restoredAccounts: 1
  }
}
