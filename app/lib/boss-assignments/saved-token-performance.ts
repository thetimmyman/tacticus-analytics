import 'server-only'

import { createHash } from 'node:crypto'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { db } from '@/app/lib/db'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { AppError, Errors } from '@/app/lib/errors/AppError'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'
import { getSeasonConfigForSeasonNumber } from '@/app/lib/loki/season-configs'
import { getAllBossHp } from '@/app/lib/data/boss-hp'
import {
  getGuildTokenPerformance,
  type DamageRow
} from '@/app/lib/data/guild-token-performance'
import {
  aggregateByPlayer,
  summarizeGuild
} from './performance-leaderboard-aggregate'
import { LEGACY_SEASON, selectSeasonScoped } from './target-token-season'
import {
  resolveSavedPlanningRotation,
  resolveSavedSeasonWindow
} from './season-planner/saved-season'
import type {
  TokenPerformanceData,
  TokenPerformanceEntry
} from './token-performance-types'
import type {
  SavedTokenPerformance,
  SavedTokenPerformancePageContext,
  SavedTokenPerformancePlayer
} from './saved-token-performance-types'

const DEADLINE_MS = 7000
const MAX_HISTORY = 10000
const MAX_DAMAGE = Math.floor(Number.MAX_SAFE_INTEGER / MAX_HISTORY)
type Result = { data: unknown; error: unknown; count?: number | null }
type Query = PromiseLike<Result> & {
  throwOnError(): Query
  abortSignal(signal: AbortSignal): Query
  retry(enabled: boolean): Query
}
type TargetQuery = Query & {
  eq(column: string, value: string | number | boolean): TargetQuery
  in(column: string, values: string[]): TargetQuery
  limit(count: number): TargetQuery
}
type Row = Record<string, unknown>
const record = (v: unknown): v is Row =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const stableId = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 256 &&
  v.trim() === v &&
  !/[\u0000-\u001f\u007f]/u.test(v)
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v)
const finite = (v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= Number.MAX_SAFE_INTEGER
const nullableFinite = (v: unknown) => v === null || finite(v)
const integer = (v: unknown, max: number): v is number =>
  finite(v) && Number.isSafeInteger(v) && v <= max
function unavailable(): never {
  throw Errors.external('Saved token performance inputs unavailable', 503)
}
const opaque = (parts: string[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex')

type Context = {
  client: TypedSupabaseClient
  guild: string
  playerId: string
  role: string
  userId: string
  seasons: string[]
  signal: AbortSignal
  running: () => void
  read: (query: unknown, max?: number, array?: boolean) => Promise<unknown>
}
/** One entry deadline includes authentication, ban reads, body work and final authority. */
async function withContext<T>(
  signal: AbortSignal | undefined,
  job: (c: Context) => Promise<T>
): Promise<T> {
  if (getRuntimeProfile() !== 'desktop')
    throw Errors.external(
      'Saved token performance requires a local workspace',
      503
    )
  const controller = new AbortController()
  const deadline = performance.now() + DEADLINE_MS
  let interruption: AppError | undefined
  let onAbort: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => {
      interruption ??= Errors.timeout(
        'Saved token performance request canceled'
      )
      reject(interruption)
      controller.abort()
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      interruption ??= Errors.external(
        'Saved token performance request timed out',
        503
      )
      reject(interruption)
      controller.abort()
    }, DEADLINE_MS)
  })
  const running = () => {
    if (interruption) throw interruption
    if (performance.now() >= deadline) {
      interruption = Errors.external(
        'Saved token performance request timed out',
        503
      )
      controller.abort()
      throw interruption
    }
  }
  const execute = async () => {
    running()
    const client = await Promise.race([db(), stopped]).catch(() =>
      unavailable()
    )
    running()
    const identity = await Promise.race([client.auth.getUser(), stopped]).catch(
      () => unavailable()
    )
    running()
    // Verify once with GoTrue; canonical ban checks still run at both boundaries.
    const auth = { auth: { getUser: async () => identity } } as Pick<
      TypedSupabaseClient,
      'auth'
    >
    const user = await requireSessionUser(auth, undefined, controller.signal)
    running()
    const read = async (
      value: unknown,
      max?: number,
      array = false
    ): Promise<unknown> => {
      running()
      const query = value as Query
      let result: Result
      try {
        result = await query
          .throwOnError()
          .abortSignal(controller.signal)
          .retry(false)
      } catch {
        running()
        return unavailable()
      }
      running()
      if (result.error) unavailable()
      if (max !== undefined) {
        const length = Array.isArray(result.data)
          ? result.data.length
          : result.data === null
            ? 0
            : 1
        if (
          (array && !Array.isArray(result.data)) ||
          !integer(result.count, max) ||
          result.count !== length
        )
          unavailable()
      }
      return result.data
    }
    const membership = async () => {
      const value = await read(
        client
          .from(CURRENT_USER_PLAYER_MAPPING)
          .select('player_id,guild_code,role', { count: 'exact' })
          .eq('user_id', user.id)
          .eq('is_current', true)
          .eq('is_active', true)
          .maybeSingle(),
        1
      )
      if (
        !record(value) ||
        !stableId(value.player_id) ||
        !stableId(value.guild_code) ||
        (value.role !== 'officer' && value.role !== 'leader')
      )
        throw Errors.forbidden('Current guild officer access required')
      return {
        playerId: value.player_id,
        guild: normalizeGuildIdentifier(value.guild_code),
        role: value.role
      }
    }
    const feature = async () => {
      const value = await read(
        client.rpc('check_feature_access', {
          p_user_id: user.id,
          p_feature_key: 'boss_assignments'
        })
      )
      if (!record(value) || typeof value.has_access !== 'boolean') unavailable()
      if (!value.has_access)
        throw Errors.forbidden('Saved token performance access required')
    }
    const initial = await membership()
    await feature()
    const imported = await read(
      client.rpc('get_distinct_seasons_for_guild', { p_guild: initial.guild })
    )
    if (
      !Array.isArray(imported) ||
      imported.length > 1000 ||
      !imported.every(
        (s) => typeof s === 'string' && /^[1-9]\d{0,5}$/.test(s)
      ) ||
      new Set(imported).size !== imported.length
    )
      unavailable()
    const seasons = (imported as string[])
      .filter((s) => getSeasonConfigForSeasonNumber(Number(s)))
      .sort((a, b) => Number(b) - Number(a))
    const result = await job({
      client,
      ...initial,
      userId: user.id,
      seasons,
      signal: controller.signal,
      running,
      read
    })
    await requireSessionUser(auth, undefined, controller.signal)
    running()
    const fresh = await membership()
    if (
      fresh.guild !== initial.guild ||
      fresh.playerId !== initial.playerId ||
      fresh.role !== initial.role
    )
      throw Errors.forbidden('Current guild authority changed')
    await feature()
    running()
    return result
  }
  try {
    return await Promise.race([execute(), stopped])
  } catch (error) {
    if (interruption) throw interruption
    if (error instanceof AppError)
      throw Errors.fromStatus(error.statusCode, error.message)
    return unavailable()
  } finally {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    controller.abort()
  }
}
function selectSeason(seasons: string[], requested?: string) {
  if (
    requested !== undefined &&
    (!/^[1-9]\d{0,5}$/.test(requested) || !seasons.includes(requested))
  )
    throw Errors.unprocessable('Select an imported captured season')
  return requested ?? seasons[0] ?? null
}
export function getSavedTokenPerformancePageContext(
  args: { selectedSeason?: string; signal?: AbortSignal } = {}
): Promise<SavedTokenPerformancePageContext> {
  return withContext(args.signal, async (c) => ({
    source: 'saved-local',
    seasons: c.seasons,
    season: selectSeason(c.seasons, args.selectedSeason),
    canCalculate: true,
    contextKey: opaque([c.userId, c.playerId, c.guild, c.role])
  }))
}
async function emptyBody(body: ReadableStream<Uint8Array> | null, c: Context) {
  if (!body) return
  const reader = body.getReader()
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  c.signal.addEventListener('abort', cancel, { once: true })
  try {
    for (let chunks = 0; ; chunks++) {
      c.running()
      const next = await reader.read()
      c.running()
      if (next.done) return
      if (next.value.byteLength !== 0)
        throw Errors.validation(
          'Saved token performance does not accept a body'
        )
      if (chunks >= 31)
        throw Errors.validation(
          'Saved token performance body work limit exceeded'
        )
    }
  } finally {
    c.signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}
function input(params: URLSearchParams, seasons: string[]) {
  if (
    new TextEncoder().encode(params.toString()).byteLength > 256 ||
    [...params].length !== 3 ||
    params.getAll('view').length !== 1 ||
    params.get('view') !== 'saved' ||
    params.getAll('season').length !== 1 ||
    params.getAll('asOf').length !== 1
  )
    throw Errors.validation(
      'Exactly view=saved, season and UTC asOf are required'
    )
  const season = selectSeason(seasons, params.get('season') ?? '')
  const raw = params.get('asOf') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw))
    throw Errors.validation('Explicit UTC asOf required')
  const ms = Date.parse(raw)
  if (
    !Number.isFinite(ms) ||
    new Date(ms).toISOString() !==
      (raw.length === 20 ? raw.replace('Z', '.000Z') : raw)
  )
    throw Errors.validation('Invalid UTC asOf')
  if (!season) throw Errors.unprocessable('Select an imported captured season')
  const window = resolveSavedSeasonWindow(season)
  if (ms < window.seasonStartMs || ms >= window.seasonEndMs)
    throw Errors.unprocessable('asOf must be inside the selected season')
  return { season, asOf: new Date(ms).toISOString(), ms }
}
async function roster(c: Context): Promise<Map<string, string>> {
  const value = await c.read(
    c.client
      .from('player_mapping')
      .select('player_id,display_name,guild_code,is_current', {
        count: 'exact'
      })
      .eq('guild_code', c.guild)
      .eq('is_current', true)
      .limit(31),
    30,
    true
  )
  if (!Array.isArray(value)) unavailable()
  const result = new Map<string, string>()
  for (const r of value) {
    if (
      !record(r) ||
      !stableId(r.player_id) ||
      r.guild_code !== c.guild ||
      r.is_current !== true ||
      (r.display_name !== null && !text(r.display_name, 1024)) ||
      result.has(r.player_id)
    )
      unavailable()
    const label =
      typeof r.display_name === 'string' ? r.display_name.trim() : ''
    result.set(
      r.player_id,
      !label || label === r.player_id ? 'Unnamed saved player' : label
    )
  }
  return result
}
function historyRows(
  value: unknown,
  guild: string,
  season: string,
  asOf: number
): DamageRow[] {
  if (!Array.isArray(value)) unavailable()
  return value.map((r, i) => {
    if (
      !record(r) ||
      r.Guild !== guild ||
      r.Season !== season ||
      r.damageType !== 'Battle' ||
      r.encounterId !== 0 ||
      !['Legendary', 'Mythic'].includes(String(r.rarity)) ||
      !integer(r.set, 4) ||
      (r.loopIndex !== null && !integer(r.loopIndex, MAX_HISTORY)) ||
      !text(r.Name, 200) ||
      !r.Name.trim() ||
      !finite(r.damageDealt) ||
      r.damageDealt <= 0 ||
      r.damageDealt > MAX_DAMAGE ||
      !text(r.startedOn, 64) ||
      !Number.isFinite(Date.parse(r.startedOn)) ||
      Date.parse(r.startedOn) > asOf ||
      (r.userId !== null && r.userId !== '' && !stableId(r.userId)) ||
      (r.displayName !== null && !text(r.displayName, 1024)) ||
      (r.maxHp !== null && (!finite(r.maxHp) || r.maxHp > MAX_DAMAGE)) ||
      (r.remainingHp !== null &&
        (!finite(r.remainingHp) || r.remainingHp > MAX_DAMAGE))
    )
      unavailable()
    // Baseline-only rows must never alias a valid ID through the legacy label key.
    const id = stableId(r.userId) ? r.userId : null
    return {
      userId: id,
      displayName: id
        ? typeof r.displayName === 'string' && r.displayName
          ? r.displayName
          : 'Saved raid player'
        : `\u0000baseline:${i}`,
      Name: r.Name,
      set: r.set,
      Season: season,
      rarity: r.rarity as string,
      encounterId: 0,
      loopIndex: r.loopIndex as number | null,
      damageDealt: r.damageDealt,
      maxHp: r.maxHp as number | null,
      remainingHp: r.remainingHp as number | null
    }
  })
}
function targets(value: unknown, guild: string, season: string) {
  if (!Array.isArray(value)) unavailable()
  const seen = new Set<string>()
  const rows: {
    boss_name: string
    rarity: string
    set: number
    target_tokens: number
    season_number: string
  }[] = []
  for (const r of value) {
    if (
      !record(r) ||
      r.guild_code !== guild ||
      (r.season_number !== season && r.season_number !== LEGACY_SEASON) ||
      !text(r.boss_name, 200) ||
      !r.boss_name.trim() ||
      !['Legendary', 'Mythic'].includes(String(r.rarity)) ||
      !integer(r.set, 5) ||
      r.set < 1 ||
      r.encounter_id !== 0 ||
      r.skip !== false ||
      !finite(r.target_tokens) ||
      r.target_tokens <= 0
    )
      unavailable()
    const key = JSON.stringify([r.boss_name, r.rarity, r.set, r.season_number])
    if (seen.has(key)) unavailable()
    seen.add(key)
    rows.push({
      boss_name: r.boss_name,
      rarity: r.rarity as string,
      set: r.set,
      target_tokens: r.target_tokens,
      season_number: r.season_number
    })
  }
  const selected = selectSeasonScoped(
    rows,
    season,
    (r) => `${r.boss_name}_${r.rarity === 'Mythic' ? 'M' : 'L'}${r.set}_0`
  )
  return Object.fromEntries(
    [...selected].map(([key, r]) => [key, r.target_tokens])
  )
}
function validEntry(entry: TokenPerformanceEntry) {
  return (
    nullableFinite(entry.score) &&
    integer(entry.tokensSpent, MAX_HISTORY) &&
    nullableFinite(entry.expectedTokens) &&
    finite(entry.actualDamage) &&
    nullableFinite(entry.expectedDamage) &&
    ['officer_target', 'per_boss', 'rarity_set_guild', 'insufficient'].includes(
      entry.tier
    ) &&
    entry.encounterId === 0
  )
}
function present(
  data: TokenPerformanceData,
  current: Map<string, string>,
  guild: string
): {
  players: SavedTokenPerformancePlayer[]
  summary: SavedTokenPerformance['summary']
} {
  const scoped: TokenPerformanceData = Object.fromEntries(
    Object.entries(data)
      .filter(
        ([id, bosses]) =>
          current.has(id) &&
          Object.values(bosses).every((e) => e.playerId === id)
      )
      .map(([id, bosses]) => [
        id,
        Object.fromEntries(
          Object.entries(bosses).map(([key, e]) => [
            key,
            { ...e, displayName: current.get(id)! }
          ])
        )
      ])
  )
  const aggregates = aggregateByPlayer(scoped)
  const players = aggregates
    .map((a) => {
      const id = a.playerId
      if (
        !id ||
        !current.has(id) ||
        !nullableFinite(a.weightedScore) ||
        !integer(a.tokensSpent, MAX_HISTORY) ||
        !finite(a.expectedTokens)
      )
        unavailable()
      const bosses = Object.entries(scoped[id] ?? {})
        .map(([bossKey, e]) => {
          if (!validEntry(e)) unavailable()
          const match = /^(.+)_([ML])([1-5])$/.exec(bossKey)
          if (!match) unavailable()
          const perLoop = Object.values(e.perLoop ?? {}).sort(
            (x, y) => x.loopIndex - y.loopIndex
          )
          if (
            perLoop.length > MAX_HISTORY ||
            perLoop.some(
              (l) =>
                !integer(l.loopIndex, MAX_HISTORY) ||
                !integer(l.tokensSpent, MAX_HISTORY) ||
                !nullableFinite(l.score) ||
                !finite(l.actualDamage)
            )
          )
            unavailable()
          return {
            bossKey,
            bossName: match[1]!,
            rarity:
              match[2] === 'M' ? ('Mythic' as const) : ('Legendary' as const),
            set: Number(match[3]),
            encounterId: 0 as const,
            score: e.score,
            tier: e.tier,
            tokensSpent: e.tokensSpent,
            expectedTokens: e.expectedTokens,
            actualDamage: e.actualDamage,
            expectedDamage: e.expectedDamage,
            perLoop
          }
        })
        .sort((a, b) => a.bossKey.localeCompare(b.bossKey))
      return {
        rowKey: opaque([guild, id]),
        name: current.get(id)!,
        bossCount: a.bossCount,
        scoredBossCount: a.scoredBossCount,
        tokensSpent: a.tokensSpent,
        expectedTokens: a.expectedTokens,
        weightedScore: a.weightedScore,
        tierCounts: a.tierCounts,
        bosses
      }
    })
    .sort(
      (a, b) => a.name.localeCompare(b.name) || a.rowKey.localeCompare(b.rowKey)
    )
  if (players.length > 30 || players.some((p) => p.bosses.length > 10))
    unavailable()
  return { players, summary: summarizeGuild(aggregates) }
}
export function readSavedTokenPerformance(args: {
  params: URLSearchParams
  body: ReadableStream<Uint8Array> | null
  signal?: AbortSignal
}): Promise<SavedTokenPerformance> {
  return withContext(args.signal, async (c) => {
    await emptyBody(args.body, c)
    const selected = input(args.params, c.seasons)
    const rotation = resolveSavedPlanningRotation(
      selected.season,
      selected.asOf
    )
    const config = await c.read(
      c.client
        .from('guild_config')
        .select('timezone', { count: 'exact' })
        .eq('guild_code', c.guild)
        .maybeSingle(),
      1
    )
    if (!record(config) || !text(config.timezone, 128) || !config.timezone)
      unavailable()
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: config.timezone })
    } catch {
      unavailable()
    }
    await roster(c)
    const raw = await c.read(
      c.client
        .from('EOT_GR_data')
        .select(
          'Guild,Season,userId,displayName,damageType,Name,set,encounterId,rarity,loopIndex,damageDealt,remainingHp,maxHp,startedOn',
          { count: 'exact' }
        )
        .eq('Guild', c.guild)
        .eq('Season', selected.season)
        .eq('damageType', 'Battle')
        .eq('encounterId', 0)
        .in('rarity', ['Legendary', 'Mythic'])
        .gt('damageDealt', 0)
        .not('Name', 'is', null)
        .lte('startedOn', selected.asOf)
        .order('startedOn', { ascending: false })
        .limit(MAX_HISTORY + 1),
      MAX_HISTORY,
      true
    )
    const damageData = historyRows(raw, c.guild, selected.season, selected.ms)
    // The local relation predates generated application table typings.
    const targetRelation = c.client.from(
      'boss_target_tokens' as 'guild_config'
    ) as unknown as {
      select(columns: string, options: { count: 'exact' }): TargetQuery
    }
    const rawTargets = await c.read(
      targetRelation
        .select(
          'guild_code,boss_name,rarity,set,encounter_id,target_tokens,season_number,skip',
          { count: 'exact' }
        )
        .eq('guild_code', c.guild)
        .in('season_number', [selected.season, LEGACY_SEASON])
        .eq('encounter_id', 0)
        .in('rarity', ['Legendary', 'Mythic'])
        .eq('skip', false)
        .limit(21),
      20,
      true
    )
    const data = await getGuildTokenPerformance(c.guild, {
      seasonOverride: selected.season,
      compareMode: 'guild',
      rarities: ['Legendary', 'Mythic'],
      includePerLoop: true,
      includeHistoricalPlayers: true,
      includePrimes: false,
      prefetched: {
        damageData,
        mostRecentSeasonPerBoss: Object.fromEntries(
          damageData.map((r) => [r.Name!, selected.season])
        ),
        bossHpData: await getAllBossHp(c.guild),
        officerTargetsByBossKey: targets(rawTargets, c.guild, selected.season)
      }
    })
    c.running()
    const current = await roster(c)
    return {
      source: 'saved-local',
      season: selected.season,
      configId: rotation.currentConfigId!,
      asOf: selected.asOf,
      timeZone: config.timezone,
      cohort: 'own-guild',
      rarities: ['Legendary', 'Mythic'],
      encounters: 'main',
      currentSavedRoster: true,
      targets: 'current-saved',
      ...present(data, current, c.guild)
    }
  })
}
