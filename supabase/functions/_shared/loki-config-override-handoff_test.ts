// The main service is the only reader of the ConfigMap mount; workers get its bytes via envVars.
import {
  assert,
  assertEquals
} from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  OVERRIDE_BYTES_ENV,
  OVERRIDE_FILENAME,
  overrideHandoffEnv
} from './loki-config-override-handoff.ts'

Deno.test('handoff encodes large files losslessly', async () => {
  const dir = await Deno.makeTempDir()
  const bytes = new Uint8Array(200 * 1024)
  for (let i = 0; i < bytes.length; i += 0x10000) {
    crypto.getRandomValues(bytes.subarray(i, i + 0x10000))
  }
  await Deno.writeFile(`${dir}/${OVERRIDE_FILENAME}`, bytes)

  const entries = await overrideHandoffEnv(dir)
  assertEquals(entries.length, 1)
  assertEquals(entries[0][0], OVERRIDE_BYTES_ENV)
  const decoded = Uint8Array.from(atob(entries[0][1]), (char) =>
    char.charCodeAt(0)
  )
  assertEquals(decoded, bytes)
})

Deno.test(
  'missing override returns empty and warns once per cache window',
  async () => {
    const dir = `${await Deno.makeTempDir()}/missing`
    const realWarn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      assertEquals(await overrideHandoffEnv(dir), [])
      assertEquals(await overrideHandoffEnv(dir), [])
      assertEquals(warnings.length, 1)
    } finally {
      console.warn = realWarn
    }
  }
)

Deno.test('unset directory returns empty', async () => {
  const previousDir = Deno.env.get('LOKI_CONFIG_OVERRIDE_DIR')
  Deno.env.delete('LOKI_CONFIG_OVERRIDE_DIR')
  try {
    assertEquals(await overrideHandoffEnv(undefined), [])
  } finally {
    if (previousDir !== undefined) {
      Deno.env.set('LOKI_CONFIG_OVERRIDE_DIR', previousDir)
    }
  }
})

Deno.test(
  'main service adds handoff entries to user worker envVars',
  async () => {
    const source = await Deno.readTextFile(
      new URL('../main/index.ts', import.meta.url)
    )
    assert(
      /userWorkers\.create\([\s\S]*?envVars:[\s\S]*?overrideHandoffEnv\(\)/.test(
        source
      )
    )
  }
)
