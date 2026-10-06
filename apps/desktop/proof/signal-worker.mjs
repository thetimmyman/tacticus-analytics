import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './native-services.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const services = await nativeServices({
  ...config,
  state: `${config.state}-signals`
})
await services.psql(
  "INSERT INTO public.guild_config(id,guild_code,display_name) VALUES(99,'SYN-SIGNAL','Synthetic signal control');"
)
void services.psql('SELECT pg_sleep(30);').catch(() => {})
for (;;) {
  if (
    (
      await services.psql(
        "SELECT count(*) FROM pg_stat_activity WHERE query='SELECT pg_sleep(30);' AND state='active';"
      )
    ).trim() === '1'
  )
    break
  await delay(100)
}
await writeFile(`${services.state}/signal-ready`, 'ready', { mode: 0o600 })
// The coordinator's production signal handlers own shutdown and process exit.
await new Promise(() => {})
