import { readFile, writeFile, stat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { strict as assert } from 'node:assert'
import { nativeServices } from './native-services.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const services = await nativeServices({
  ...config,
  state: `${config.state}-owner-death`
})
const lease = await stat(`${services.state}/runtime.lease`)
for (const child of services.children) {
  const fd = await stat(`/proc/${child.pid}/fd/4`)
  assert.equal(fd.ino, lease.ino)
  assert.equal(fd.dev, lease.dev)
}
await services.psql(
  "INSERT INTO public.guild_config(id,guild_code,display_name) VALUES(99,'SYN-DURABLE','Synthetic durability control');"
)
void services
  .psql(
    "BEGIN; INSERT INTO public.guild_config(id,guild_code,display_name) VALUES(100,'SYN-INTERRUPTED','Synthetic interruption control'); SELECT pg_sleep(60); COMMIT;"
  )
  .catch(() => {})
while (
  (
    await services.psql(
      "SELECT count(*) FROM pg_stat_activity WHERE query='SELECT pg_sleep(60);' AND state='active';"
    )
  ).trim() !== '1'
)
  await delay(100)
await writeFile(
  `${services.state}/owner-death-ready.json`,
  JSON.stringify({ ports: services.ports }),
  { mode: 0o600 }
)
process.on('message', () => {
  // Kill the actual owned ChildProcess, never a recorded PID.
  services.supervisor.kill('SIGKILL')
  process.send({ killed: true })
})
await new Promise(() => {})
