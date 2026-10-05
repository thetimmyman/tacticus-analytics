import { createHash } from 'node:crypto'
import { mkdir, writeFile, cp } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, isAbsolute } from 'node:path'

const output = process.argv[2],
  arch = process.arch
if (
  process.platform !== 'darwin' ||
  !isAbsolute(output ?? '') ||
  !['arm64', 'x64'].includes(arch)
)
  throw new Error('Native macOS build and absolute empty output required')
await mkdir(output, { recursive: false, mode: 0o700 })
const inputs = []
async function archive(name, url, digest, directory, strip = true) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error('Pinned native input unavailable')
  const chunks = [],
    reader = response.body.getReader()
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 500 * 1024 * 1024) {
      await reader.cancel()
      throw new Error('Native input size limit')
    }
    chunks.push(value)
  }
  const bytes = Buffer.concat(chunks)
  if (createHash('sha256').update(bytes).digest('hex') !== digest)
    throw new Error('Pinned native input digest mismatch')
  const file = join(output, name)
  await writeFile(file, bytes, { mode: 0o600, flag: 'wx' })
  await mkdir(directory, { mode: 0o700 })
  if (name.endsWith('.zip'))
    execFileSync('/usr/bin/ditto', ['-x', '-k', file, directory])
  else
    execFileSync('/usr/bin/tar', [
      '-xf',
      file,
      '-C',
      directory,
      ...(strip ? ['--strip-components=1'] : [])
    ])
  inputs.push({ name, url, sha256: digest })
}
const node = join(output, 'node'),
  postgresSource = join(output, 'postgres-source'),
  postgres = join(output, 'postgres')
await archive(
  'node.tar.gz',
  `https://nodejs.org/dist/v22.23.3/node-v22.23.3-darwin-${arch}.tar.gz`,
  arch === 'arm64'
    ? '23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53'
    : '8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8',
  node
)
await archive(
  'postgres.tar.bz2',
  'https://ftp.postgresql.org/pub/source/v18.6/postgresql-18.6.tar.bz2',
  '555610c24d53e4316da5b7d3fc25c279d96856d5e0e23ee308c328c5fa881d9f',
  postgresSource
)
execFileSync(
  join(postgresSource, 'configure'),
  [
    `--prefix=${postgres}`,
    '--without-readline',
    '--without-zlib',
    '--without-icu',
    '--without-ssl',
    '--disable-rpath'
  ],
  { cwd: postgresSource, stdio: 'inherit' }
)
execFileSync('/usr/bin/make', ['-j4'], {
  cwd: postgresSource,
  stdio: 'inherit'
})
execFileSync('/usr/bin/make', ['install'], {
  cwd: postgresSource,
  stdio: 'inherit'
})
const auth = join(output, 'auth')
if (arch === 'arm64') {
  await archive(
    'auth.tar.gz',
    'https://github.com/supabase/auth/releases/download/v2.197.0/auth-v2.197.0-darwin-arm64.tar.gz',
    '3fb7998e7061e2c14f3f9555b1d94d447358c965395728e0d81eac82e0e5868b',
    auth,
    false
  )
} else {
  const source = join(output, 'auth-source')
  await archive(
    'auth-source.tar.gz',
    'https://codeload.github.com/supabase/auth/tar.gz/4eee58f296d9698a1c2c0ae14d7a0b379c7622d3',
    'dd5168b9f0bb294fa1e1d343c23b6bb5f68376f271d97dea897339b28fbd4b8d',
    source
  )
  await mkdir(auth)
  execFileSync('go', ['mod', 'download'], { cwd: source, stdio: 'inherit' })
  execFileSync('go', ['mod', 'verify'], { cwd: source, stdio: 'inherit' })
  execFileSync(
    'go',
    [
      'build',
      '-buildvcs=false',
      '-ldflags',
      '-X github.com/supabase/auth/internal/utilities.Version=v2.197.0',
      '-o',
      join(auth, 'auth'),
      '.'
    ],
    {
      cwd: source,
      stdio: 'inherit',
      env: { ...process.env, CGO_ENABLED: '0', GOOS: 'darwin', GOARCH: 'amd64' }
    }
  )
  await cp(join(source, 'migrations'), join(auth, 'migrations'), {
    recursive: true
  })
}
const postgrest = join(output, 'postgrest'),
  electron = join(output, 'electron')
await archive(
  'postgrest.tar.xz',
  `https://github.com/PostgREST/postgrest/releases/download/v16.4/postgrest-v16.4-macos-${arch === 'arm64' ? 'aarch64' : 'x86-64'}.tar.xz`,
  arch === 'arm64'
    ? '5720fbde4a19ade9fb189791615c84beb9f0e58201b1b6d17fe3b698faf60776'
    : '9c50547cddf94ede6abf42dacc586caa18e17db4557aee386c6e45e6806aaed2',
  postgrest,
  false
)
await archive(
  'electron.zip',
  `https://github.com/electron/electron/releases/download/v44.5.1/electron-v44.5.1-darwin-${arch}.zip`,
  arch === 'arm64'
    ? '1d75703019bb16461ae65f3081d7e6f5c0b11e901d0ccb5c343bcf7bcdd6435c'
    : 'e567d13833d0e161d7749727355b98643461df3395b537cfa7bdddf8a8bfedff',
  electron,
  false
)
await writeFile(
  join(output, 'inputs.json'),
  JSON.stringify(
    {
      platform: 'macos',
      architecture: arch,
      versions: {
        node: '22.23.3',
        postgres: '18.6',
        auth: '2.197.0',
        postgrest: '16.4',
        electron: '44.5.1'
      },
      inputs,
      rights: 'review-required'
    },
    null,
    2
  )
)
console.log(
  JSON.stringify({
    nativeInputs: inputs.length,
    architecture: arch,
    rights: 'review-required'
  })
)
