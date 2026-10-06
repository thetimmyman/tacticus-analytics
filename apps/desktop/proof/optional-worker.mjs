import { writeFile } from 'node:fs/promises'
await writeFile(process.argv[2], JSON.stringify({ phase: 'running' }), {
  mode: 0o600
})
setInterval(() => {}, 1000)
