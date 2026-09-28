// The edge tier must resolve the in-cluster override, or LOKI CONNECT rejects the stale default build.
// fetch is stubbed per leg; each leg imports a fresh (cache-busted) module.
import {
  assert,
  assertEquals
} from 'https://deno.land/std@0.168.0/testing/asserts.ts'

const OVERRIDE_ENV = 'LOKI_CONFIG_OVERRIDE_DIR'
const OVERRIDE_BYTES_ENV = 'LOKI_CONFIG_OVERRIDE_GZ_BASE64'
const OVERRIDE_FILENAME = 'GlobalConfig.json.gz'

const OVERRIDE_BUILD = '9.99.1'
const UPSTREAM_BUILD = '9.98.1'
const STALE_DEFAULT = '1.29.21.1056'

const globalConfigFixture = (build: string) => ({
  configVersion: 'a1b2c3d4e5f607182930aabbccddeeff',
  extractedAt: '2026-09-16T10:10:06.415Z',
  general: {
    minRecommendedAppVersions: {
      Apple: build,
      Google: build,
      Windows: build,
      macOS: build
    }
  },
  guildBoss: {
    misc: {
      firstSeasonStart: 1646128800000,
      seasonDuration: 1209600,
      bufferAfterSeasonEnd: 86400
    }
  }
})

const gzipJson = async (value: unknown): Promise<Uint8Array> => {
  const compressed = new Blob([JSON.stringify(value)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(compressed).arrayBuffer())
}

interface LokiBuildVersionModule {
  getRecommendedLokiBuildString(platform?: string): Promise<string>
  getLokiSeasonTimingConstants(): Promise<{
    firstSeasonStartMs: number
    seasonCycleSeconds: number
    seasonGapSeconds: number
    source: string
  }>
}

let legCounter = 0
const freshModule = async (): Promise<LokiBuildVersionModule> =>
  (await import(
    `./loki-build-version.ts?leg=${++legCounter}`
  )) as unknown as LokiBuildVersionModule

interface Harness {
  mod: LokiBuildVersionModule
  fetchCalls: string[]
  warnings: unknown[][]
  restore: () => void
}

/** Per leg: override dir (or none), a recording fetch stub, a console.warn spy. */
const harness = async (opts: {
  /** null means no override at all. */
  overrideBytes: Uint8Array | null
  overrideEnvPayload?: string
  upstream: 'ok' | '404'
}): Promise<Harness> => {
  const realFetch = globalThis.fetch
  const realWarn = console.warn
  const realInfo = console.info
  const previousDir = Deno.env.get(OVERRIDE_ENV)
  const previousPayload = Deno.env.get(OVERRIDE_BYTES_ENV)

  if (opts.overrideBytes) {
    const dir = await Deno.makeTempDir()
    await Deno.writeFile(`${dir}/${OVERRIDE_FILENAME}`, opts.overrideBytes)
    Deno.env.set(OVERRIDE_ENV, dir)
  } else {
    Deno.env.delete(OVERRIDE_ENV)
  }
  if (opts.overrideEnvPayload !== undefined) {
    Deno.env.set(OVERRIDE_BYTES_ENV, opts.overrideEnvPayload)
  } else {
    Deno.env.delete(OVERRIDE_BYTES_ENV)
  }

  const fetchCalls: string[] = []
  globalThis.fetch = ((input: string | URL | Request) => {
    fetchCalls.push(String(input))
    if (opts.upstream === '404') {
      return Promise.resolve(new Response('not found', { status: 404 }))
    }
    return Promise.resolve(
      new Response(JSON.stringify(globalConfigFixture(UPSTREAM_BUILD)), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
  }) as typeof globalThis.fetch

  const warnings: unknown[][] = []
  console.warn = (...args: unknown[]) => {
    warnings.push(args)
  }
  console.info = () => {}

  return {
    mod: await freshModule(),
    fetchCalls,
    warnings,
    restore: () => {
      globalThis.fetch = realFetch
      console.warn = realWarn
      console.info = realInfo
      if (previousDir === undefined) Deno.env.delete(OVERRIDE_ENV)
      else Deno.env.set(OVERRIDE_ENV, previousDir)
      if (previousPayload === undefined) Deno.env.delete(OVERRIDE_BYTES_ENV)
      else Deno.env.set(OVERRIDE_BYTES_ENV, previousPayload)
    }
  }
}

Deno.test(
  'override present: its build string is used and no network call is made',
  async () => {
    const h = await harness({
      overrideBytes: await gzipJson(globalConfigFixture(OVERRIDE_BUILD)),
      // A healthy but different upstream answer reveals which source was used.
      upstream: 'ok'
    })
    try {
      const value = await h.mod.getRecommendedLokiBuildString('Windows')
      assertEquals(value, OVERRIDE_BUILD)
      assert(
        value !== STALE_DEFAULT,
        'must not return the hardcoded stale default when an override is present'
      )
      assertEquals(
        h.fetchCalls,
        [],
        `the override must short-circuit the network fetch; saw ${JSON.stringify(h.fetchCalls)}`
      )

      // Season timing resolves from the same override, also without a fetch.
      const timing = await h.mod.getLokiSeasonTimingConstants()
      assertEquals(timing.source, 'loki-globalconfig')
      assertEquals(timing.seasonCycleSeconds, 1209600)
      assertEquals(timing.seasonGapSeconds, 86400)
      assertEquals(h.fetchCalls, [])
    } finally {
      h.restore()
    }
  }
)

Deno.test(
  'override absent: existing behaviour is unchanged (upstream is used)',
  async () => {
    const h = await harness({ overrideBytes: null, upstream: 'ok' })
    try {
      const value = await h.mod.getRecommendedLokiBuildString('Windows')
      assertEquals(value, UPSTREAM_BUILD)
      assertEquals(h.fetchCalls.length, 1, 'upstream must still be fetched')
      assert(
        h.fetchCalls[0].includes('/globalConfig'),
        `unexpected fetch target: ${h.fetchCalls[0]}`
      )
    } finally {
      h.restore()
    }
  }
)

Deno.test(
  'override absent and upstream 404: still the pre-existing hardcoded default',
  async () => {
    const h = await harness({ overrideBytes: null, upstream: '404' })
    try {
      assertEquals(
        await h.mod.getRecommendedLokiBuildString('Windows'),
        STALE_DEFAULT
      )
      assertEquals(h.fetchCalls.length, 1)
    } finally {
      h.restore()
    }
  }
)

Deno.test(
  'override gzip corrupt: falls through to upstream with a logged warning',
  async () => {
    const h = await harness({
      // Not gzip: DecompressionStream rejects, which is the corrupt-payload path.
      overrideBytes: new TextEncoder().encode('this is not gzip'),
      upstream: 'ok'
    })
    try {
      const value = await h.mod.getRecommendedLokiBuildString('Windows')
      assertEquals(
        value,
        UPSTREAM_BUILD,
        'a corrupt override must degrade to upstream, not throw and not win'
      )
      assertEquals(h.fetchCalls.length, 1, 'upstream must be reached')

      const warned = h.warnings.find(
        (args) =>
          typeof args[0] === 'string' &&
          args[0].includes('[loki-build-version]') &&
          args[0].includes('override unreadable')
      )
      assert(
        warned !== undefined,
        `expected a '[loki-build-version] override unreadable' warning; saw ${JSON.stringify(h.warnings)}`
      )
      // Same structured-context shape as the app tier's warning.
      const context = warned[1] as Record<string, unknown>
      assert(
        typeof context?.overrideDir === 'string' &&
          context.overrideDir.length > 0,
        'warning context must carry overrideDir'
      )
      assert(
        typeof context?.error === 'string',
        'warning context must carry the error MESSAGE, not the Error object'
      )
    } finally {
      h.restore()
    }
  }
)

Deno.test(
  'override handed over by the main service in an env var is used when the mount is unreadable',
  async () => {
    const gzip = await gzipJson(globalConfigFixture(OVERRIDE_BUILD))
    let binary = ''
    for (let i = 0; i < gzip.length; i += 0x8000) {
      binary += String.fromCharCode(...gzip.subarray(i, i + 0x8000))
    }
    const h = await harness({
      overrideBytes: null,
      overrideEnvPayload: btoa(binary),
      upstream: 'ok'
    })
    const missingDir = await Deno.makeTempDir()
    Deno.env.set(OVERRIDE_ENV, `${missingDir}/missing`)
    try {
      assertEquals(await h.mod.getRecommendedLokiBuildString(), OVERRIDE_BUILD)
      assertEquals(h.fetchCalls, [])
      assertEquals(
        (await h.mod.getLokiSeasonTimingConstants()).source,
        'loki-globalconfig'
      )
      assertEquals(h.fetchCalls, [])
    } finally {
      h.restore()
    }
  }
)

Deno.test(
  'corrupt env override falls through to upstream with a warning',
  async () => {
    const h = await harness({
      overrideBytes: null,
      overrideEnvPayload: btoa('not gzip'),
      upstream: 'ok'
    })
    try {
      assertEquals(await h.mod.getRecommendedLokiBuildString(), UPSTREAM_BUILD)
      assertEquals(h.fetchCalls.length, 1)
      assert(
        h.warnings.some((args) =>
          String(args[0]).includes('override unreadable')
        )
      )
    } finally {
      h.restore()
    }
  }
)

Deno.test('platform key resolution is case-tolerant', async () => {
  const h = await harness({
    overrideBytes: await gzipJson(globalConfigFixture(OVERRIDE_BUILD)),
    upstream: 'ok'
  })
  try {
    assertEquals(
      await h.mod.getRecommendedLokiBuildString('windows'),
      OVERRIDE_BUILD
    )
    assertEquals(h.fetchCalls, [])
  } finally {
    h.restore()
  }
})
