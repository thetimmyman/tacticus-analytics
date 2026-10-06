import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './native-services.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const services = await nativeServices({
  ...config,
  state: `${config.state}-hard-kill`
})
await services.psql(
  "INSERT INTO public.guild_config(id,guild_code,display_name) VALUES(99,'SYN-COMMITTED','Synthetic committed control');"
)
void services
  .psql(
    "BEGIN; INSERT INTO public.guild_config(id,guild_code,display_name) VALUES(100,'SYN-UNCOMMITTED','Synthetic rollback control'); SELECT pg_sleep(60); COMMIT;"
  )
  .catch(() => {})
for (;;) {
  if (
    (
      await services.psql(
        "SELECT count(*) FROM pg_stat_activity WHERE query='SELECT pg_sleep(60);' AND state='active';"
      )
    ).trim() === '1'
  )
    break
  await delay(100)
}
await writeFile(
  `${services.state}/hard-kill-ready.json`,
  JSON.stringify({ ports: services.ports }),
  { mode: 0o600 }
)
await new Promise(() => {})
