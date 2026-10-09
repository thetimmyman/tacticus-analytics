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
  resolveSavedPlanningRotation,
  resolveSavedSeasonWindow
} from './season-planner/saved-season'
import { getActiveProgressionConfig } from './progression-config'
import { buildPlanFromNowSnapshot } from './season-planner/snapshot'
import { computeRemainingBossSequence } from './season-sequence'
import { classifyPlayers } from './player-classifier'
import { orchestrateMultiStage } from './unified-orchestrator'
import {
  buildDamageModel,
  computeMeanDamagePerBattle,
  computeRosterEncounterDamagePerToken,
  type DamageRecord
} from './season-planner/damage-model'
import {
  resolveSkippedPrimesFromRows,
  type TargetTokenSkipRow,
  type SeasonOpsSkipRow
} from './resolve-skipped-primes'
import { resolveOfficerTargetsFromRows } from './resolve-officer-targets'
import {
  LEGACY_SEASON,
  isOfficerSkip,
  selectSeasonScoped
} from './target-token-season'
import { deriveStageCodeFromSetAndRarity } from './season-planner/snapshot-logic'
import { projectStageStartSeconds } from './stage-timing'
import { buildSavedStageKillDurationMedians } from './saved-stage-timing'
import {
  initialSavedTokenState,
  verifySavedQueueTemporalAllocation
} from './saved-queue-temporal'
import {
  parseReplacement,
  parseReplacementJson,
  record,
  type ReplacementBoss
} from './saved-assignments-input'
import {
  SEASON_MAX_SPENDABLE_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'
import { computeSeasonTokenAggregates } from '@/app/lib/season-forecast/season-token-economy'
import type {
  SavedQueueCalculation,
  SavedQueuePageContext
} from './saved-queue-types'

const DEADLINE_MS = 7000
const MAX_HISTORY = 10000
const TABLES = new Set([
  'current_user_player_mapping',
  'guild_config',
  'player_mapping',
  'EOT_GR_data',
  'raid_progression_config',
  'boss_target_tokens',
  'upcoming_season_bosses'
])
type QueryResult = { data: unknown; error: unknown; count: number | null }
type Query = PromiseLike<QueryResult> & {
  throwOnError(): Query
  abortSignal(signal: AbortSignal): Query
  retry(enabled: boolean): Query
}
function unavailable(): never {
  throw Errors.external('Saved queue inputs unavailable', 503)
}
const writer = (role: string) => role === 'officer' || role === 'leader'
const stablePlayerId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  value.trim() === value &&
  !/[\u0000-\u001f\u007f]/u.test(value)

/** Count-qualified signed builders refuse every capped or swallowed read. */
function savedReads(
  client: TypedSupabaseClient,
  signal: AbortSignal,
  running: () => void
) {
  let failed = false
  const guard = (query: Query, complete = false, snapshot = false) => {
    query.throwOnError().abortSignal(signal).retry(false)
    const execute = query.then.bind(query)
    query.then = (fulfilled, rejected) => {
      running()
      return Promise.resolve(
        execute((value) => {
          running()
          if (value.error) unavailable()
          if (
            complete &&
            (value.count === null ||
              !Number.isSafeInteger(value.count) ||
              value.count < 0 ||
              value.count > MAX_HISTORY ||
              (Array.isArray(value.data)
                ? value.count !== value.data.length
                : value.count !== (value.data === null ? 0 : 1)))
          )
            unavailable()
          if (snapshot && Array.isArray(value.data))
            for (const row of value.data) {
              if (
                !record(row) ||
                typeof row.Name !== 'string' ||
                !row.Name ||
                row.Name.length > 200 ||
                !['Legendary', 'Mythic'].includes(String(row.rarity)) ||
                typeof row.set !== 'number' ||
                !Number.isSafeInteger(row.set) ||
                row.set < 0 ||
                row.set > 4 ||
                typeof row.loopIndex !== 'number' ||
                !Number.isSafeInteger(row.loopIndex) ||
                row.loopIndex < 0 ||
                row.loopIndex > 10000 ||
                typeof row.encounterId !== 'number' ||
                !Number.isSafeInteger(row.encounterId) ||
                row.encounterId < 0 ||
                row.encounterId > 2 ||
                typeof row.startedOn !== 'string' ||
                !Number.isFinite(Date.parse(row.startedOn))
              )
                unavailable()
              for (const field of ['maxHp', 'remainingHp'])
                if (
                  row[field] !== null &&
                  (typeof row[field] !== 'number' ||
                    !Number.isSafeInteger(row[field]) ||
                    row[field] < 0)
                )
                  unavailable()
              for (const field of ['completedOn', 'timestamp'])
                if (
                  row[field] !== null &&
                  (typeof row[field] !== 'string' ||
                    !Number.isFinite(Date.parse(row[field])))
                )
                  unavailable()
            }
          return value
        })
      )
        .catch(() => {
          failed = true
          return unavailable()
        })
        .then(fulfilled, rejected)
    }
    return query
  }
  return {
    client: {
      from(table: string) {
        if (!TABLES.has(table)) unavailable()
        return {
          select(columns: string) {
            return guard(
              client
                .from(table as 'guild_config')
                .select(columns, { count: 'exact' }) as unknown as Query,
              true,
              table === 'EOT_GR_data' && columns.includes('remainingHp')
            )
          }
        }
      }
    } as unknown as TypedSupabaseClient,
    rpc(
      ...args:
        | ['get_distinct_seasons_for_guild', { p_guild: string }]
        | ['check_feature_access', { p_user_id: string; p_feature_key: string }]
    ) {
      running()
      const query =
        args[0] === 'get_distinct_seasons_for_guild'
          ? client.rpc(args[0], args[1])
          : client.rpc(args[0], args[1])
      return guard(query as unknown as Query)
    },
    assertSucceeded() {
      if (failed) unavailable()
    }
  }
}

type Context = {
  client: TypedSupabaseClient
  guild: string
  playerId: string
  role: string
  userId: string
  seasons: string[]
  signal: AbortSignal
  running: () => void
  reads: ReturnType<typeof savedReads>
}
async function withSavedContext<T>(
  signal: AbortSignal | undefined,
  job: (context: Context) => Promise<T>
): Promise<T> {
  if (getRuntimeProfile() !== 'desktop')
    throw Errors.external(
      'Saved queue is available in local workspaces only',
      503
    )
  const controller = new AbortController()
  const deadline = performance.now() + DEADLINE_MS
  let interruption: AppError | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => {
      interruption ??= Errors.timeout('Saved queue request canceled')
      reject(interruption)
      controller.abort()
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      interruption ??= Errors.external('Saved queue request timed out', 503)
      reject(interruption)
      controller.abort()
    }, DEADLINE_MS)
  })
  const running = () => {
    if (interruption) throw interruption
    if (performance.now() >= deadline) {
      interruption = Errors.external('Saved queue request timed out', 503)
      controller.abort()
      throw interruption
    }
  }
  const calculate = async () => {
    running()
    const client = await Promise.race([db(), stopped]).catch(
      (error: unknown) => {
        if (error === interruption) throw error
        return unavailable()
      }
    )
    running()
    const identity = await Promise.race([client.auth.getUser(), stopped]).catch(
      (error: unknown) => {
        if (error === interruption) throw error
        return unavailable()
      }
    )
    running()
    const auth = { auth: { getUser: async () => identity } } as Pick<
      TypedSupabaseClient,
      'auth'
    >
    const user = await requireSessionUser(auth, undefined, controller.signal)
    running()
    const reads = savedReads(client, controller.signal, running)
    const membership = async () => {
      running()
      const { data } = await reads.client
        .from(CURRENT_USER_PLAYER_MAPPING)
        .select('player_id,guild_code,role')
        .eq('user_id', user.id)
        .eq('is_current', true)
        .eq('is_active', true)
        .maybeSingle()
      if (
        !data ||
        !stablePlayerId(data.player_id) ||
        typeof data.guild_code !== 'string' ||
        !data.guild_code ||
        typeof data.role !== 'string' ||
        !['member', 'officer', 'leader'].includes(data.role.toLowerCase())
      )
        throw Errors.forbidden('Current guild membership required')
      return {
        guild: normalizeGuildIdentifier(data.guild_code),
        playerId: data.player_id,
        role: data.role
      }
    }
    const initial = await membership()
    const { data: feature } = await reads.rpc('check_feature_access', {
      p_user_id: user.id,
      p_feature_key: 'boss_assignments'
    })
    if (!record(feature) || feature.has_access !== true)
      throw Errors.forbidden('Saved queue access required')
    const { data: imported } = await reads.rpc(
      'get_distinct_seasons_for_guild',
      { p_guild: initial.guild }
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
      client: reads.client,
      ...initial,
      userId: user.id,
      seasons,
      signal: controller.signal,
      running,
      reads
    })
    // Recheck bans and current authority after model reads and before serialization.
    await requireSessionUser(auth, undefined, controller.signal)
    running()
    const fresh = await membership()
    if (
      fresh.guild !== initial.guild ||
      fresh.playerId !== initial.playerId ||
      fresh.role !== initial.role
    )
      throw Errors.forbidden('Current guild authority changed')
    reads.assertSucceeded()
    running()
    return result
  }
  try {
    return await Promise.race([calculate(), stopped])
  } catch (error) {
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
export function getSavedQueuePageContext(
  args: { selectedSeason?: string; signal?: AbortSignal } = {}
): Promise<SavedQueuePageContext> {
  return withSavedContext(args.signal, async (c) => ({
    source: 'saved-local',
    seasons: c.seasons,
    season: selectSeason(c.seasons, args.selectedSeason),
    canCalculate: writer(c.role),
    contextKey: createHash('sha256')
      .update(JSON.stringify([c.userId, c.playerId, c.guild, c.role]))
      .digest('hex')
  }))
}

async function calculationBody(
  body: ReadableStream<Uint8Array> | null,
  contentType: string | null,
  running: () => void,
  signal: AbortSignal
) {
  if (
    contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
  )
    throw Errors.fromStatus(415, 'Calculation body must be JSON')
  if (!body) throw Errors.validation('Calculation body is required')
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  const onAbort = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      running()
      const { done, value } = await reader.read()
      running()
      if (done) break
      bytes += value.byteLength
      if (bytes > 4096)
        throw Errors.fromStatus(413, 'Calculation body too large')
      try {
        text += decoder.decode(value, { stream: true })
      } catch {
        throw Errors.validation('Invalid calculation UTF-8')
      }
    }
    try {
      text += decoder.decode()
    } catch {
      throw Errors.validation('Invalid calculation UTF-8')
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const value = parseReplacementJson(text)
  if (
    !record(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'season_number') ||
    !Object.hasOwn(value, 'asOf') ||
    typeof value.season_number !== 'string' ||
    typeof value.asOf !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.asOf)
  )
    throw Errors.validation('season_number and UTC asOf are required')
  const asOfMs = Date.parse(value.asOf)
  if (
    !Number.isFinite(asOfMs) ||
    new Date(asOfMs).toISOString() !==
      (value.asOf.length === 20 ? value.asOf.replace('Z', '.000Z') : value.asOf)
  )
    throw Errors.validation('Invalid calculation asOf')
  return {
    season: value.season_number,
    asOf: new Date(asOfMs).toISOString(),
    asOfMs
  }
}

export function computeSavedQueue(args: {
  body: ReadableStream<Uint8Array> | null
  contentType: string | null
  params: URLSearchParams
  signal: AbortSignal
}): Promise<SavedQueueCalculation> {
  if (args.params.size)
    throw Errors.validation(
      'Saved queue calculation does not accept parameters'
    )
  return withSavedContext(args.signal, async (c) => {
    if (!writer(c.role))
      throw Errors.forbidden('Lowercase officer or leader role required')
    const { season, asOf, asOfMs } = await calculationBody(
      args.body,
      args.contentType,
      c.running,
      c.signal
    )
    selectSeason(c.seasons, season)
    const rotation = resolveSavedPlanningRotation(season, asOf)
    const { seasonStartMs, seasonEndMs } = resolveSavedSeasonWindow(season)
    if (asOfMs < seasonStartMs || asOfMs >= seasonEndMs)
      throw Errors.unprocessable(
        'asOf must be within the selected saved season'
      )
    const { data: config } = await c.client
      .from('guild_config')
      .select('timezone')
      .eq('guild_code', c.guild)
      .maybeSingle()
    if (
      !config ||
      typeof config.timezone !== 'string' ||
      !config.timezone ||
      config.timezone.length > 128
    )
      unavailable()
    const timeZone = config!.timezone!
    try {
      new Intl.DateTimeFormat('en', { timeZone })
    } catch {
      throw Errors.unprocessable('Saved guild timezone is invalid')
    }
    const progressionConfig = await getActiveProgressionConfig(
      c.guild,
      Number(season),
      c.client
    )
    const bossHpData = await getAllBossHp(c.guild)
    const snapshot = await buildPlanFromNowSnapshot({
      supabase: c.client,
      guildCode: c.guild,
      season,
      seasonId: rotation.currentConfigId,
      snapshotAt: asOf,
      bossHpData,
      rotationSnapshot: rotation,
      preferAsOfStatus: true,
      progressionConfig
    })
    c.reads.assertSucceeded()
    c.running()
    const [
      { data: members },
      { data: rawHistory },
      { data: targets },
      { data: ops }
    ] = await Promise.all([
      c.client
        .from('player_mapping')
        .select('player_id,display_name')
        .eq('guild_code', c.guild)
        .eq('is_current', true)
        .eq('is_active', true)
        .limit(31),
      c.client
        .from('EOT_GR_data')
        .select(
          'userId,displayName,damageType,startedOn,damageDealt,Name,encounterId,rarity,set,Season,loopIndex'
        )
        .eq('Guild', c.guild)
        .lte('season_num', Number(season))
        .in('damageType', ['Battle', 'Bomb'])
        .gte('startedOn', new Date(asOfMs - 60 * 86400000).toISOString())
        .lte('startedOn', asOf)
        .order('startedOn', { ascending: false })
        .limit(MAX_HISTORY + 1),
      c.client
        .from('boss_target_tokens' as 'guild_config')
        .select(
          'boss_name,rarity,set,encounter_id,source,seeded_from_seasons,skip,season_number,target_tokens'
        )
        .eq('guild_code', c.guild)
        .in('season_number', [season, LEGACY_SEASON])
        .limit(61),
      c.client
        .from('upcoming_season_bosses')
        .select('level,sub_bosses')
        .eq('guild_code', c.guild)
        .eq('season_number', season)
        .limit(11)
    ])
    if (
      !Array.isArray(members) ||
      members.length > 30 ||
      !Array.isArray(rawHistory) ||
      rawHistory.length > MAX_HISTORY ||
      !Array.isArray(targets) ||
      targets.length > 60 ||
      !Array.isArray(ops) ||
      ops.length > 10
    )
      unavailable()
    const ids = new Set<string>()
    const roster = (members ?? []).map((m) => {
      if (
        !stablePlayerId(m.player_id) ||
        ids.has(m.player_id) ||
        typeof m.display_name !== 'string' ||
        m.display_name.length > 1024 ||
        /[\u0000-\u001f\u007f]/u.test(m.display_name)
      )
        unavailable()
      ids.add(m.player_id)
      return { playerId: m.player_id, displayName: m.display_name! }
    })
    const history = (rawHistory ?? []).map((row) => {
      if (
        !stablePlayerId(row.userId) ||
        typeof row.startedOn !== 'string' ||
        !Number.isFinite(Date.parse(row.startedOn)) ||
        Date.parse(row.startedOn) > asOfMs ||
        !['Battle', 'Bomb'].includes(row.damageType ?? '') ||
        typeof row.Season !== 'string' ||
        !/^[1-9]\d{0,5}$/.test(row.Season) ||
        Number(row.Season) > Number(season) ||
        typeof row.damageDealt !== 'number' ||
        !Number.isSafeInteger(row.damageDealt) ||
        row.damageDealt < 0 ||
        row.damageDealt > 1_000_000_000_000 ||
        typeof row.Name !== 'string' ||
        !row.Name ||
        !Number.isSafeInteger(row.encounterId) ||
        row.encounterId! < 0 ||
        row.encounterId! > 2 ||
        !Number.isSafeInteger(row.set) ||
        row.set! < 0 ||
        row.set! > 4 ||
        !['Legendary', 'Mythic'].includes(row.rarity ?? '') ||
        !Number.isSafeInteger(row.loopIndex) ||
        row.loopIndex! < 0
      )
        unavailable()
      return row
    })
    for (const row of targets as unknown[]) {
      if (
        !record(row) ||
        typeof row.boss_name !== 'string' ||
        !row.boss_name ||
        row.boss_name.length > 200 ||
        !['Legendary', 'Mythic'].includes(String(row.rarity)) ||
        typeof row.set !== 'number' ||
        !Number.isSafeInteger(row.set) ||
        row.set < 1 ||
        row.set > 5 ||
        typeof row.encounter_id !== 'number' ||
        !Number.isSafeInteger(row.encounter_id) ||
        row.encounter_id < 0 ||
        row.encounter_id > 2 ||
        typeof row.source !== 'string' ||
        row.source.length > 200 ||
        !(
          row.seeded_from_seasons === null ||
          typeof row.seeded_from_seasons === 'string'
        ) ||
        typeof row.skip !== 'boolean' ||
        ![season, LEGACY_SEASON].includes(String(row.season_number)) ||
        !(
          row.target_tokens === null ||
          (typeof row.target_tokens === 'number' &&
            Number.isSafeInteger(row.target_tokens) &&
            row.target_tokens >= 0 &&
            row.target_tokens <= 2147483647)
        )
      )
        unavailable()
    }
    for (const row of ops as unknown[]) {
      if (
        !record(row) ||
        typeof row.level !== 'string' ||
        !/^[ML][1-5]$/.test(row.level)
      )
        unavailable()
      let sub: unknown = row.sub_bosses
      if (typeof sub === 'string') {
        if (sub.length > 8192) unavailable()
        try {
          sub = JSON.parse(sub)
        } catch {
          unavailable()
        }
      }
      if (
        sub !== null &&
        (!record(sub) ||
          !Object.entries(sub).every(([key, value]) =>
            ['sub1', 'sub2'].includes(key)
              ? typeof value === 'string' && value.length <= 200
              : ['sub1_skip', 'sub2_skip'].includes(key) &&
                typeof value === 'boolean'
          ))
      )
        unavailable()
    }
    const targetRows = targets as unknown as TargetTokenSkipRow[]
    const skippedPrimes = resolveSkippedPrimesFromRows({
      season,
      targetTokenRows: targetRows,
      seasonOpsRows: ops as unknown as SeasonOpsSkipRow[]
    })
    const officerTargets = resolveOfficerTargetsFromRows({
      season,
      targetTokenRows: targetRows
    })
    const skippedStages = new Set(
      [
        ...selectSeasonScoped(
          targetRows.filter((r) => r.encounter_id === 0),
          season,
          (r) => `${r.boss_name}__${r.rarity}__${r.set}`
        ).values()
      ]
        .filter(
          (r) =>
            isOfficerSkip(r) &&
            r.rarity &&
            typeof r.set === 'number' &&
            r.set >= 1 &&
            r.set <= 5
        )
        .map((r) => deriveStageCodeFromSetAndRarity(r.set! - 1, r.rarity!))
    )
    const damageRecords: DamageRecord[] = history
      .filter(
        (row) =>
          row.damageType === 'Battle' &&
          row.damageDealt! > 0 &&
          ids.has(row.userId!)
      )
      .map((row) => ({
        playerId: row.userId!,
        bossName: row.Name!,
        encounterId: row.encounterId!,
        rarity: row.rarity,
        set: row.set,
        startedOn: row.startedOn!,
        damageDealt: row.damageDealt!
      }))
    const damageModel = buildDamageModel(damageRecords, { referenceAt: asOf })
    const fullSequence = computeRemainingBossSequence({
      progressionConfig,
      currentStageCode: snapshot.stageCode,
      currentLoopIndex: snapshot.loopIndex,
      seasonBosses: rotation.currentBosses,
      bossHpData,
      guildAvgDamage: computeMeanDamagePerBattle(damageRecords),
      currentStageHp: {
        mainRemainingHp: snapshot.encounters.main.remainingHp,
        prime1RemainingHp: snapshot.encounters.prime1.remainingHp,
        prime2RemainingHp: snapshot.encounters.prime2.remainingHp
      },
      maxStages: 50,
      skippedPrimes,
      officerTargets,
      encounterDamagePerToken: (target) =>
        computeRosterEncounterDamagePerToken(damageModel, [...ids], target)
    }).filter((s) => !skippedStages.has(s.stageCode))
    const medians = buildSavedStageKillDurationMedians({
      rows: history
        .filter((row) => row.damageType === 'Battle')
        .map((row) => ({
          Season: row.Season!,
          damageType: 'Battle' as const,
          rarity: row.rarity!,
          set: row.set!,
          loopIndex: row.loopIndex!,
          startedOn: row.startedOn!
        })),
      season,
      asOf
    })
    const starts = projectStageStartSeconds(fullSequence, medians)
    // Preserve original timing precision: Date serialization truncates fractions.
    for (const start of starts)
      if (
        start.startSeconds < 0 ||
        !Number.isSafeInteger(start.startSeconds * 1000) ||
        !Number.isSafeInteger(asOfMs + start.startSeconds * 1000)
      )
        throw Errors.unprocessable(
          'Projected stage timing is unavailable at millisecond precision'
        )
    const horizonSeconds = (seasonEndMs - asOfMs) / 1000
    const sequence = fullSequence.filter(
      (_, i) => starts[i]!.startSeconds < horizonSeconds
    )
    const classified = classifyPlayers({
      players: roster,
      damageModel,
      bossSequence: sequence
    })
    const tokenStates = roster.map((member) => {
      const battles = history
        .filter(
          (row) =>
            row.userId === member.playerId &&
            row.Season === season &&
            Date.parse(row.startedOn!) >= seasonStartMs
        )
        .map((row) => ({
          displayName: member.displayName,
          damageType: row.damageType as 'Battle' | 'Bomb',
          startedOn: row.startedOn!
        }))
      const state = initialSavedTokenState({ seasonStartMs, asOfMs, battles })
      const used = battles.filter((b) => b.damageType === 'Battle').length
      const budget = computeSeasonTokenAggregates({
        players: [
          { bank: state.available, usedThisSeason: used, recentBattleCount: 0 }
        ],
        regenToEnd: Math.floor(horizonSeconds / TWELVE_HOURS_IN_SECONDS),
        daysRemaining: horizonSeconds / 86400,
        rateWindowDays: 1,
        seasonMaxTokens: SEASON_MAX_SPENDABLE_TOKENS,
        regenPerDay: 2
      }).tokensRemaining
      return { ...member, state, used, budget }
    })
    c.running()
    const result = orchestrateMultiStage({
      players: classified,
      playerTokens: Object.fromEntries(
        tokenStates.map((p) => [p.playerId, p.budget])
      ),
      bossSequence: sequence,
      damageModel,
      currentTokensByPlayer: Object.fromEntries(
        tokenStates.map((p) => [p.playerId, p.state.available])
      ),
      stageStartSecondsByIndex: starts
        .slice(0, sequence.length)
        .map((s) => s.startSeconds)
    })
    const temporal = verifySavedQueueTemporalAllocation({
      asOfMs,
      seasonEndMs,
      players: tokenStates.map((p) => ({
        playerId: p.playerId,
        state: p.state,
        usedThisSeason: p.used
      })),
      stages: result.stageAssignments.map((s) => ({
        stageCode: s.stageCode,
        loopIndex: s.loopIndex,
        startSeconds:
          starts[
            sequence.findIndex(
              (stage) =>
                stage.stageCode === s.stageCode &&
                stage.loopIndex === s.loopIndex
            )
          ]!.startSeconds,
        allocations: s.assignments
      }))
    })
    if (!temporal.feasible)
      throw Errors.unprocessable(
        'Calculated queue is not token-feasible at projected starts'
      )
    const stages: SavedQueueCalculation['stages'] = result.stageAssignments.map(
      (sa) => {
        const i = sequence.findIndex(
          (s) => s.stageCode === sa.stageCode && s.loopIndex === sa.loopIndex
        )
        const start = starts[i]!
        return {
          stageCode: sa.stageCode,
          loopIndex: sa.loopIndex,
          projectedStartAt: new Date(
            asOfMs + start.startSeconds * 1000
          ).toISOString(),
          inboundDurationSeconds: start.inboundDurationSeconds,
          inboundDurationSource: start.inboundDurationSource,
          conditionalOnPriorClear: i > 0,
          assignments: sa.assignments.map((a) => ({
            playerId: a.playerId,
            encounter: a.bossId.endsWith('_prime1')
              ? ('prime1' as const)
              : a.bossId.endsWith('_prime2')
                ? ('prime2' as const)
                : ('main' as const),
            tokens: a.tokens
          })),
          projections: sa.projections
        }
      }
    )
    const bosses: ReplacementBoss[] = []
    const bossLevels = new Set<string>()
    for (const stage of sequence) {
      if (bossLevels.has(stage.stageCode)) continue
      bossLevels.add(stage.stageCode)
      const find = (e: number) =>
        rotation.currentBosses.find(
          (b) =>
            deriveStageCodeFromSetAndRarity(b.set, b.rarity) ===
              stage.stageCode && b.encounter_id === e
        )?.boss_name ?? ''
      bosses.push({
        level: stage.stageCode,
        boss_name: find(0),
        sub_bosses: {
          sub1: find(1),
          sub2: find(2),
          sub1_skip: skippedPrimes.get(stage.stageCode)?.has(1) ?? false,
          sub2_skip: skippedPrimes.get(stage.stageCode)?.has(2) ?? false
        }
      })
    }
    const allocations = new Map(
      roster.map((p) => [p.playerId, {} as Record<string, number>])
    )
    for (const stage of stages)
      for (const a of stage.assignments) {
        const key =
          stage.stageCode +
          (a.encounter === 'main'
            ? ''
            : a.encounter === 'prime1'
              ? '_Sub1'
              : '_Sub2')
        const allocation = allocations.get(a.playerId)
        if (!allocation) unavailable()
        allocation![key] = (allocation![key] ?? 0) + a.tokens
      }
    let prefix = 0
    let firstUncleared: SavedQueueCalculation['feasibility']['projectedPrefix']['firstUnclearedStage'] =
      null
    const unsolved: SavedQueueCalculation['feasibility']['unsolvedRemainder'] =
      []
    for (let i = 0; i < fullSequence.length; i++) {
      const original = fullSequence[i]!
      const stage = stages.find(
        (s) =>
          s.stageCode === original.stageCode &&
          s.loopIndex === original.loopIndex
      )
      const identity = {
        stageCode: original.stageCode,
        loopIndex: original.loopIndex
      }
      if (starts[i]!.startSeconds >= horizonSeconds) {
        unsolved.push({ ...identity, reason: 'outside-season-horizon' })
        continue
      }
      if (!stage || !stage.assignments.length) {
        unsolved.push({ ...identity, reason: 'no-allocation' })
        firstUncleared ??= identity
        continue
      }
      if (firstUncleared) {
        unsolved.push({ ...identity, reason: 'prior-stage-uncleared' })
        continue
      }
      if (
        Object.values(stage.projections).every(
          (p) => !p || p.projectedRemainingHp <= 0
        )
      )
        prefix++
      else firstUncleared = identity
    }
    const warnings: SavedQueueCalculation['warnings'] = []
    if (
      starts
        .slice(0, sequence.length)
        .some((s) => s.inboundDurationSource === 'fallback')
    )
      warnings.push('fallback-stage-duration')
    if (stages.some((s) => s.conditionalOnPriorClear))
      warnings.push('conditional-stage-progression')
    if (!damageRecords.length) warnings.push('no-damage-signal')
    if (sequence.length < fullSequence.length)
      warnings.push('horizon-truncated')
    if (fullSequence.length === 50) warnings.push('stage-limit-reached')
    const output: SavedQueueCalculation = {
      source: 'saved-season',
      season,
      configId: rotation.currentConfigId!,
      asOf,
      timeZone,
      rosterSource: 'current-saved-roster',
      players: tokenStates.map((p) => ({
        playerId: p.playerId,
        displayName: p.displayName,
        tier: classified.find((m) => m.playerId === p.playerId)!.tier,
        currentTokens: p.state.available,
        nextRegenAt:
          p.state.nextRegenAt === null
            ? null
            : new Date(p.state.nextRegenAt).toISOString(),
        tokensUsedThisSeason: p.used,
        spendableByEnd: p.budget,
        tokensPlanned: result.playerBudgets[p.playerId]?.allocated ?? 0
      })),
      stages,
      replacement: {
        asOf,
        bosses,
        assignments: [...allocations].map(([player_id, token_allocations]) => ({
          player_id,
          token_allocations
        }))
      },
      metrics: {
        totalTokensPlanned: result.metrics.totalTokensPlanned,
        projectedStages: result.metrics.projectedStages
      },
      feasibility: {
        status: 'tokens-verified-at-projected-starts',
        stageStarts: 'historical-estimate',
        horizonEndExclusive: true,
        projectedPrefix: {
          fullyClearedStageCount: prefix,
          firstUnclearedStage: firstUncleared
        },
        unsolvedRemainder: unsolved,
        sequenceLimitReached: fullSequence.length === 50
      },
      warnings
    }
    // The calculated preview must itself be admissible by the saved-intent API.
    try {
      parseReplacement(output.replacement, rotation.currentBosses)
      for (const assignment of output.replacement.assignments) {
        const budget = tokenStates.find(
          (p) => p.playerId === assignment.player_id
        )?.budget
        const total = Object.values(assignment.token_allocations).reduce(
          (sum, tokens) => sum + tokens,
          0
        )
        if (
          budget === undefined ||
          !Number.isSafeInteger(total) ||
          total > budget
        )
          unavailable()
      }
    } catch {
      unavailable()
    }
    c.running()
    return output
  })
}
