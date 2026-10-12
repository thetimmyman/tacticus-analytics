import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loopbackGateway } from './loopback-gateway.mjs'
import { ownedNativeServices } from './native-services.mjs'

// Checked-in proof that every listener owned by the desktop runtime (the
// loopback HTTP gateway plus the PostgreSQL / Auth / PostgREST services it
// fronts) binds a loopback address only. The services are exercised through
// ownedNativeServices with synthetic executables that record the bind host the
// runtime instructs each child to use; no real native binaries are required.

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost'])
const wildcardHosts = new Set(['0.0.0.0', '::'])

function assertLoopbackOnly(listener, host) {
  assert.ok(
    loopbackHosts.has(host),
    `${listener} must bind a loopback address, got ${JSON.stringify(host)}`
  )
  assert.ok(
    !wildcardHosts.has(host),
    `${listener} must not bind a wildcard address, got ${JSON.stringify(host)}`
  )
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-loopback-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = join(root, 'state')
  const schema = join(root, 'schema')
  const bin = join(root, 'bin')
  await mkdir(state, { mode: 0o700 })
  await mkdir(schema)
  await mkdir(bin)
  await writeFile(join(schema, 'canonical-objects.sql'), 'SELECT 1;')
  await writeFile(join(schema, 'authority.sql'), 'SELECT 1;')
  const bindPostgres = join(state, 'bind-postgres')
  const bindAuth = join(state, 'bind-auth')
  const bindRest = join(state, 'bind-postgrest')
  const BIND_bindPostgres =
    "require('node:path').join(__dirname,'..','state','bind-postgres')"
  const BIND_bindAuth =
    "require('node:path').join(__dirname,'..','state','bind-auth')"
  const BIND_bindRest =
    "require('node:path').join(__dirname,'..','state','bind-postgrest')"
  const fakes = {
    initdb:
      "const fs=require('node:fs');const p=require('node:path');const d=process.argv[process.argv.indexOf('-D')+1];fs.mkdirSync(d,{recursive:true,mode:0o700});fs.writeFileSync(p.join(d,'PG_VERSION'),'18',{mode:0o600})",
    postgres: `const fs=require('node:fs');const i=process.argv.indexOf('-h');fs.writeFileSync(${BIND_bindPostgres},i<0?'':process.argv[i+1]);for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>process.exit(0));setInterval(()=>{},1000)`,
    psql: "const fs=require('node:fs');const sql=fs.readFileSync(process.argv.at(-1),'utf8');if(sql.includes('pg_roles'))console.log('1');else if(sql.includes('to_regclass'))console.log('f')",
    auth: `const fs=require('node:fs');if(process.argv[2]==='migrate')process.exit(0);const host=process.env['GOTRUE_API_HOST']||'';fs.writeFileSync(${BIND_bindAuth},host);const srv=require('node:http').createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200);res.end('ok')}else{res.writeHead(404);res.end()}});srv.listen(Number(process.env['PORT']),host,()=>fs.writeFileSync(${BIND_bindAuth},srv.address().address))`,
    postgrest: `const fs=require('node:fs');const host=process.env['PGRST_SERVER_HOST']||'';fs.writeFileSync(${BIND_bindRest},host);const srv=require('node:http').createServer((req,res)=>{res.writeHead(200);res.end('{}')});srv.listen(Number(process.env['PGRST_SERVER_PORT']),host,()=>fs.writeFileSync(${BIND_bindRest},srv.address().address))`
  }
  const binaries = { authCwd: root }
  for (const [name, source] of Object.entries(fakes)) {
    binaries[name] = join(bin, name)
    await writeFile(binaries[name], `#!${process.execPath}\n${source}\n`)
    await chmod(binaries[name], 0o700)
  }
  return { state, schema, binaries, bindPostgres, bindAuth, bindRest }
}

test('every desktop-runtime listener binds a loopback address only', async (t) => {
  const f = await fixture(t)
  const services = await ownedNativeServices({
    state: f.state,
    binaries: f.binaries,
    schemaDirectory: f.schema
  })
  t.after(() => services.stop())
  const gateway = await loopbackGateway({
    services: { ports: services.ports, token: { anon: 'anon-token' } },
    transportKey: randomBytes(32).toString('hex'),
    appPort: 1
  })
  t.after(() => gateway.stop())
  // The socket's real bound address, not the advertised URL.
  assertLoopbackOnly('loopback gateway', gateway.address().address)
  assertLoopbackOnly(
    'PostgreSQL',
    (await readFile(f.bindPostgres, 'utf8')).trim()
  )
  assertLoopbackOnly('Auth', (await readFile(f.bindAuth, 'utf8')).trim())
  assertLoopbackOnly('PostgREST', (await readFile(f.bindRest, 'utf8')).trim())
})

test('the standalone application server is launched on loopback only', async () => {
  // The application server is launched by the launcher through the service
  // supervisor; its bind host comes from the launch environment, and the port
  // is reserved on loopback. Inspect both so a wildcard bind cannot slip in.
  const source = await readFile(
    new URL('../launcher/launch.mjs', import.meta.url),
    'utf8'
  )
  const hosts = [...source.matchAll(/HOSTNAME:\s*['"]([^'"]*)['"]/gu)].map(
    (match) => match[1]
  )
  assert.ok(hosts.length >= 1, 'application launch must set HOSTNAME')
  for (const host of hosts) assertLoopbackOnly('application server', host)
  const reservations = [
    ...source.matchAll(/\.listen\(\s*0\s*,\s*['"]([^'"]*)['"]/gu)
  ].map((match) => match[1])
  assert.ok(reservations.length >= 1, 'port reservation must name a host')
  for (const host of reservations)
    assertLoopbackOnly('application port reservation', host)
})
