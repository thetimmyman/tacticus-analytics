'use client'

import { useEffect, useRef, useState } from 'react'
import type { SavedTokenPerformance } from '@/app/lib/boss-assignments/saved-token-performance-types'

export interface SavedTokenPerformanceClientProps {
  contextKey: string
  season: string
  seasons: string[]
  canCalculate: boolean
}

const UNAVAILABLE =
  'Saved token performance unavailable. Check the selected saved season and UTC time, then calculate again.'
const MAX_BYTES = 1024 * 1024
const TIERS = {
  officer_target: 'Officer target',
  per_boss: 'Saved boss history',
  rarity_set_guild: 'Saved guild rarity and set history',
  insufficient: 'Insufficient history'
} as const

type ObjectValue = Record<string, unknown>
function invalid(): never {
  throw new Error('Invalid saved performance response')
}
function fields(value: unknown, keys: string[]): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const row = value as ObjectValue
  if (
    Object.keys(row).length !== keys.length ||
    Object.keys(row).some((key) => !keys.includes(key))
  )
    invalid()
  return row
}
function text(value: unknown, max = 1024): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    invalid()
  return value
}
function metric(
  value: unknown,
  max = Number.MAX_SAFE_INTEGER,
  integer = false
) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    invalid()
  return value
}
function nullable(value: unknown, max = Number.MAX_SAFE_INTEGER) {
  return value === null ? null : metric(value, max)
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid()
  return value
}
function tier(value: unknown): keyof typeof TIERS {
  if (typeof value !== 'string' || !Object.hasOwn(TIERS, value)) invalid()
  return value as keyof typeof TIERS
}
function readPerformance(
  value: unknown,
  season: string,
  asOf: string
): SavedTokenPerformance {
  const body = fields(value, [
    'source',
    'season',
    'configId',
    'asOf',
    'timeZone',
    'cohort',
    'rarities',
    'encounters',
    'currentSavedRoster',
    'targets',
    'players',
    'summary'
  ])
  if (
    body.source !== 'saved-local' ||
    body.season !== season ||
    body.asOf !== asOf ||
    body.cohort !== 'own-guild' ||
    body.encounters !== 'main' ||
    body.currentSavedRoster !== true ||
    body.targets !== 'current-saved' ||
    !Array.isArray(body.rarities) ||
    body.rarities.length !== 2 ||
    body.rarities[0] !== 'Legendary' ||
    body.rarities[1] !== 'Mythic'
  )
    invalid()
  text(body.configId, 256)
  new Intl.DateTimeFormat('en', { timeZone: text(body.timeZone, 128) })
  const keys = new Set<string>()
  let loops = 0
  const players = list(body.players, 30)
  for (const value of players) {
    const player = fields(value, [
      'rowKey',
      'name',
      'bossCount',
      'scoredBossCount',
      'tokensSpent',
      'expectedTokens',
      'weightedScore',
      'tierCounts',
      'bosses'
    ])
    const key = text(player.rowKey, 64)
    if (!/^[a-f0-9]{64}$/.test(key) || keys.has(key)) invalid()
    keys.add(key)
    text(player.name)
    const bosses = list(player.bosses, 10)
    metric(player.bossCount, bosses.length, true)
    metric(player.scoredBossCount, player.bossCount as number, true)
    metric(player.tokensSpent, 10000, true)
    metric(player.expectedTokens)
    nullable(player.weightedScore)
    if (
      !player.tierCounts ||
      typeof player.tierCounts !== 'object' ||
      Array.isArray(player.tierCounts)
    )
      invalid()
    let tierTotal = 0
    for (const [name, count] of Object.entries(player.tierCounts)) {
      tier(name)
      tierTotal += metric(count, 10, true)
    }
    if (tierTotal !== player.bossCount) invalid()
    const bossKeys = new Set<string>()
    for (const value of bosses) {
      const boss = fields(value, [
        'bossKey',
        'bossName',
        'rarity',
        'set',
        'encounterId',
        'score',
        'tier',
        'tokensSpent',
        'expectedTokens',
        'actualDamage',
        'expectedDamage',
        'perLoop'
      ])
      const bossName = text(boss.bossName, 200)
      const set = metric(boss.set, 5, true)
      if (
        set < 1 ||
        (boss.rarity !== 'Legendary' && boss.rarity !== 'Mythic') ||
        boss.encounterId !== 0
      )
        invalid()
      const bossKey = text(boss.bossKey, 210)
      if (
        bossKey !==
          `${bossName}_${boss.rarity === 'Mythic' ? 'M' : 'L'}${set}` ||
        bossKeys.has(bossKey)
      )
        invalid()
      bossKeys.add(bossKey)
      tier(boss.tier)
      nullable(boss.score)
      metric(boss.tokensSpent, 10000, true)
      nullable(boss.expectedTokens)
      metric(boss.actualDamage)
      nullable(boss.expectedDamage)
      let prior = -1
      for (const value of list(boss.perLoop, 10000)) {
        if (++loops > 10000) invalid()
        const loop = fields(value, [
          'loopIndex',
          'score',
          'tokensSpent',
          'actualDamage'
        ])
        const index = metric(loop.loopIndex, 10000, true)
        if (index <= prior) invalid()
        prior = index
        nullable(loop.score)
        metric(loop.tokensSpent, 10000, true)
        metric(loop.actualDamage)
      }
    }
  }
  const summary = fields(body.summary, [
    'playerCount',
    'mean',
    'median',
    'pctAtOrAbove'
  ])
  if (metric(summary.playerCount, 30, true) !== players.length) invalid()
  nullable(summary.mean)
  nullable(summary.median)
  nullable(summary.pctAtOrAbove, 100)
  return body as unknown as SavedTokenPerformance
}

/** Interpret this explicitly UTC-labelled input without the browser's local zone. */
function utcInstant(input: string): string | null {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{3})?)?$/.test(input))
    return null
  const full =
    input.length === 16
      ? `${input}:00.000Z`
      : input.length === 19
        ? `${input}.000Z`
        : `${input}Z`
  const ms = Date.parse(full)
  return Number.isFinite(ms) && new Date(ms).toISOString() === full
    ? full
    : null
}

type Operation = {
  controller: AbortController
  stopped: Promise<never>
  timer: ReturnType<typeof setTimeout>
  deadline: number
}
async function responseBody(response: Response, json: boolean, op: Operation) {
  const reader = response.body?.getReader()
  if (!reader) invalid()
  let canceled = false
  const cancel = () => {
    if (!canceled) {
      canceled = true
      void reader.cancel().catch(() => {})
    }
  }
  op.controller.signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (let i = 0; i < 4096; i++) {
      if (op.controller.signal.aborted) invalid()
      const next = await Promise.race([reader.read(), op.stopped])
      if (op.controller.signal.aborted) invalid()
      if (next.done) {
        if (!json) return null
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        return JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        ) as unknown
      }
      size += next.value.byteLength
      if (size > MAX_BYTES) invalid()
      if (json) chunks.push(next.value)
    }
    invalid()
  } catch (error) {
    cancel()
    throw error
  } finally {
    op.controller.signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

export default function SavedTokenPerformanceClient(
  props: SavedTokenPerformanceClientProps
) {
  return (
    <PerformanceForm
      key={JSON.stringify([props.contextKey, props.season, props.canCalculate])}
      {...props}
    />
  )
}
function PerformanceForm({
  season: initialSeason,
  seasons,
  canCalculate
}: SavedTokenPerformanceClientProps) {
  const [season, setSeason] = useState(initialSeason)
  const [input, setInput] = useState('')
  const [data, setData] = useState<SavedTokenPerformance | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const active = useRef<Operation | null>(null)
  const asOf = utcInstant(input)
  function stop() {
    const op = active.current
    active.current = null
    if (op) {
      clearTimeout(op.timer)
      op.controller.abort()
    }
  }
  useEffect(() => () => stop(), [])
  function reset() {
    stop()
    setData(null)
    setError(false)
    setBusy(false)
  }
  async function calculate() {
    if (!canCalculate || !asOf || !seasons.includes(season)) return
    stop()
    const controller = new AbortController()
    const stopped = new Promise<never>((_, reject) =>
      controller.signal.addEventListener(
        'abort',
        () => reject(new Error('Saved performance request stopped')),
        { once: true }
      )
    )
    const op: Operation = {
      controller,
      stopped,
      deadline: performance.now() + 7000,
      timer: setTimeout(() => controller.abort(), 7000)
    }
    active.current = op
    setData(null)
    setError(false)
    setBusy(true)
    try {
      const params = new URLSearchParams({ view: 'saved', season, asOf })
      const response = await Promise.race([
        fetch(`/api/upcoming/token-performance?${params}`, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal
        }).then((response) => {
          // A mocked or late transport can resolve after abort; dispose its body too.
          if (active.current !== op || controller.signal.aborted)
            void response.body?.cancel().catch(() => {})
          return response
        }),
        stopped
      ])
      if (active.current !== op || controller.signal.aborted) return
      const json =
        response.ok &&
        response.headers.get('content-type')?.split(';')[0]?.trim() ===
          'application/json'
      const body = await responseBody(response, !!json, op)
      if (active.current !== op || controller.signal.aborted) return
      if (!json || performance.now() >= op.deadline) invalid()
      const result = readPerformance(body, season, asOf)
      if (performance.now() >= op.deadline) invalid()
      if (active.current === op && !controller.signal.aborted) setData(result)
    } catch {
      if (active.current === op) {
        setData(null)
        setError(true)
      }
    } finally {
      clearTimeout(op.timer)
      if (active.current === op) {
        active.current = null
        setBusy(false)
      }
    }
  }
  return (
    <section aria-label="Saved token performance" className="space-y-4">
      <h1 className="text-2xl font-bold">Saved token performance</h1>
      <p>
        Saved raid history and captured season configuration. No live API
        request.
      </p>
      <p>
        Uses the current saved roster and current saved targets. As-of time
        limits raid history; it does not reconstruct historical membership or
        targets.
      </p>
      <p>
        Own-guild Legendary and Mythic main bosses only. Primes and other
        cohorts are unavailable here.
      </p>
      <label className="block">
        Saved season
        <select
          aria-label="Saved season"
          className="input-wh40k ml-2"
          value={season}
          onChange={(event) => {
            reset()
            setSeason(event.target.value)
            setInput('')
          }}
        >
          {seasons.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      {canCalculate ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void calculate()
          }}
          className="space-y-3"
        >
          <label className="block">
            As-of time (UTC)
            <input
              type="datetime-local"
              step="0.001"
              value={input}
              className="input-wh40k mt-1 block w-full sm:max-w-sm"
              onChange={(event) => {
                reset()
                setInput(event.target.value)
              }}
            />
          </label>
          <button
            type="submit"
            className="btn-wh40k"
            disabled={!asOf || busy || !seasons.includes(season)}
          >
            {busy
              ? 'Calculating saved performance…'
              : data
                ? 'Refresh saved performance'
                : 'Calculate saved performance'}
          </button>
        </form>
      ) : (
        <p>Saved performance calculation requires officer access.</p>
      )}
      {error && <p role="alert">{UNAVAILABLE}</p>}
      {data && <Results data={data} />}
    </section>
  )
}
const format = (value: number) =>
  new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(value)
const score = (value: number | null) =>
  value === null ? 'Not available' : `${value.toFixed(2)}×`
const optional = (value: number | null) =>
  value === null ? 'Not available' : format(value)
function Results({ data }: { data: SavedTokenPerformance }) {
  return (
    <section aria-label="Calculated saved performance" className="space-y-4">
      <p>
        Season {data.season} · As of {data.asOf} · Guild time zone:{' '}
        {data.timeZone} · Captured configuration: {data.configId}
      </p>
      <p>
        Uses the current saved roster and current saved targets · Legendary and
        Mythic main bosses
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt>Players observed</dt>
          <dd>{data.summary.playerCount}</dd>
        </div>
        <div>
          <dt>Mean weighted score</dt>
          <dd>{score(data.summary.mean)}</dd>
        </div>
        <div>
          <dt>Median weighted score</dt>
          <dd>{score(data.summary.median)}</dd>
        </div>
        <div>
          <dt>At or above expected damage</dt>
          <dd>
            {data.summary.pctAtOrAbove === null
              ? 'Not available'
              : `${format(data.summary.pctAtOrAbove)}%`}
          </dd>
        </div>
      </dl>
      <p>
        1.00× means expected damage per token. Player scores weight each scored
        boss by tokens spent. Unavailable denominators remain unscored;
        expected-token totals cover scored bosses only.
      </p>
      {data.players.length === 0 ? (
        <p>No saved main-boss battles match this season and as-of time.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table
              aria-label="Saved player performance"
              className="w-full text-left"
            >
              <thead>
                <tr>
                  <th scope="col">Current player label</th>
                  <th scope="col">Weighted score</th>
                  <th scope="col">Tokens spent</th>
                  <th scope="col">Expected tokens (scored bosses)</th>
                  <th scope="col">Scored bosses / observed</th>
                </tr>
              </thead>
              <tbody>
                {data.players.map((player) => (
                  <tr key={player.rowKey}>
                    <th scope="row">{player.name}</th>
                    <td>{score(player.weightedScore)}</td>
                    <td>{format(player.tokensSpent)}</td>
                    <td>{format(player.expectedTokens)}</td>
                    <td>
                      {player.scoredBossCount} / {player.bossCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.players.map((player) => (
            <details key={player.rowKey} className="rounded border p-3">
              <summary>{player.name} — boss and loop details</summary>
              {player.bosses.map((boss) => (
                <section key={boss.bossKey} className="mt-3 space-y-2">
                  <h2>
                    {boss.bossName} · {boss.rarity} set {boss.set} · Main
                  </h2>
                  <p>
                    Expected-token source:{' '}
                    {TIERS[boss.tier as keyof typeof TIERS]}
                  </p>
                  <p>
                    Score: {score(boss.score)} · Tokens spent:{' '}
                    {format(boss.tokensSpent)} · Expected tokens:{' '}
                    {optional(boss.expectedTokens)}
                  </p>
                  <p>
                    Actual damage: {format(boss.actualDamage)} · Expected
                    damage: {optional(boss.expectedDamage)}
                  </p>
                  <p>
                    Loop details include only attacks with a recorded loop
                    index; aggregate totals can include other saved attacks.
                  </p>
                  <ul>
                    {boss.perLoop.map((loop) => (
                      <li key={loop.loopIndex}>
                        Loop {loop.loopIndex}: {format(loop.tokensSpent)} tokens
                        · {format(loop.actualDamage)} damage ·{' '}
                        {score(loop.score)}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </details>
          ))}
        </>
      )}
    </section>
  )
}
