import { guildRosterQuery } from '@/app/lib/data/guild-roster'
// The live reading is written back as a player_mapping snapshot strictly AFTER the deltas, so it
// cannot feed back into them.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EOTGRData } from '@tacticus/app-core/types'
import { serviceDb } from '@/app/lib/db'
import { calculateTokenAvailability } from '@/app/lib/calculations/token-calculation'
import { getSeasonTiming } from '@/app/lib/services/season-timing-service'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import { settledMapWithConcurrency } from '@/app/lib/utils/bounded-fanout'
import { writeBackPlayerTokenSnapshot } from '@/app/api/guild-tokens/token-service'
import { getPlayerApiKey } from '@tacticus/app-core/api-key-helper'
import { createComponentLogger } from '@/app/lib/logging'
import {
  buildAuditRow,
  decideAuditMode,
  type AuditMode,
  type AuditRow,
  type EstimatorReading,
  type LiveTokenReading
} from './audit-core'

const logger = createComponentLogger('token-audit.runner')

// One bad key must not park the whole batch (3s cap, no in-batch retries).
const BATCH_PER_CALL_TIMEOUT_MS = 3000
const BATCH_MAX_RETRIES = 0
const LIVE_AUDIT_FANOUT_CONCURRENCY = 4
const MAX_LIVE_AUDIT_FANOUT_MEMBERS = 40
// One shared budget per run bounds the AGGREGATE across all guilds.
const MAX_LIVE_AUDIT_REQUESTS_PER_RUN = 400

type LiveAuditRunBudget = { remaining: number }

function newLiveAuditRunBudget(): LiveAuditRunBudget {
  return { remaining: MAX_LIVE_AUDIT_REQUESTS_PER_RUN }
}

type KeyHolderRow = {
  player_id: string
  display_name: string
  guild_code: string
  tacticus_api_key_encrypted: string | null
  last_sync_tokens: number | null
  last_sync_bombs: number | null
  next_token_seconds: number | null
  next_bomb_seconds: number | null
  api_key_is_valid: boolean | null
}

type BattleQueryRow = Pick<
  EOTGRData,
  'userId' | 'displayName' | 'damageType' | 'startedOn' | 'Season'
>

type BattleRow = Omit<
  BattleQueryRow,
  'userId' | 'displayName' | 'damageType' | 'startedOn'
> & {
  userId: string
  displayName: string
  damageType: string
  startedOn: string
}

const hasReplayIdentity = (row: BattleQueryRow): row is BattleRow =>
  Boolean(row.userId && row.displayName && row.damageType && row.startedOn)

type RpcTokenStateRow = {
  player_id?: string | null
  tokens_available?: number | null
  token_next_in_seconds?: number | null
  data_source?: string | null
  post_snapshot_spends?: number | null
}

type TokenUsageRow = {
  player_id?: string | null
  tokens_available?: number | null
}

export interface GuildAuditResult {
  guild_code: string
  mode: AuditMode
  live_eligible: number
  live_fetched: number
  rows_inserted: number
}

export interface TokenAuditSummary {
  held: boolean
  season: string | null
  guilds: GuildAuditResult[]
  total_rows: number
  skipped_guilds: Array<{ guild_code: string; reason: string }>
}

function isMissingTableError(error: {
  code?: string
  message?: string
}): boolean {
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /could not find the table/i.test(error.message ?? '')
  )
}

async function fetchLiveReading(member: KeyHolderRow): Promise<{
  tokens: LiveTokenReading
  bombs: LiveTokenReading | null
} | null> {
  const apiKey = await getPlayerApiKey(member)
  if (!apiKey) return null

  const playerData = await tacticusAPI.getPlayerWithRetry(apiKey, {
    timeoutMs: BATCH_PER_CALL_TIMEOUT_MS,
    maxRetries: BATCH_MAX_RETRIES
  })
  const gr = playerData?.progress?.guildRaid
  if (!gr?.tokens) return null

  const tokens: LiveTokenReading = {
    current: gr.tokens.current,
    max: gr.tokens.max,
    nextTokenInSeconds: gr.tokens.nextTokenInSeconds ?? null,
    regenDelayInSeconds: gr.tokens.regenDelayInSeconds
  }
  const bombs: LiveTokenReading | null = gr.bombTokens
    ? {
        current: gr.bombTokens.current,
        max: gr.bombTokens.max,
        nextTokenInSeconds: gr.bombTokens.nextTokenInSeconds ?? null,
        regenDelayInSeconds: gr.bombTokens.regenDelayInSeconds
      }
    : null

  return { tokens, bombs }
}

type LiveFetchOutcome = {
  member: KeyHolderRow
  live: Awaited<ReturnType<typeof fetchLiveReading>>
  fetchedAt: string
}

// fetchedAt (the write-back race cutoff) is captured BEFORE the fetch, so a concurrent writer
// landing mid-flight is not clobbered via onlyIfLastSyncBefore.
async function fetchLiveReadings(
  members: KeyHolderRow[],
  runBudget: LiveAuditRunBudget
): Promise<Array<PromiseSettledResult<LiveFetchOutcome>>> {
  const effectiveCap = Math.max(
    0,
    Math.min(MAX_LIVE_AUDIT_FANOUT_MEMBERS, runBudget.remaining)
  )
  const membersToFetch = members.slice(0, effectiveCap)
  runBudget.remaining -= membersToFetch.length
  if (members.length > membersToFetch.length) {
    logger.warn(
      {
        eligible: members.length,
        cap: MAX_LIVE_AUDIT_FANOUT_MEMBERS,
        runBudgetRemaining: runBudget.remaining
      },
      'Live audit fan-out truncated to per-guild cap / per-run budget'
    )
  }
  return settledMapWithConcurrency(
    membersToFetch,
    LIVE_AUDIT_FANOUT_CONCURRENCY,
    async (member) => {
      // Must precede the await.
      const fetchedAt = new Date().toISOString()
      const live = await fetchLiveReading(member)
      return { member, live, fetchedAt }
    }
  )
}

// Fire-and-forget: a failed write-back never fails the audit.
function writeBackLiveSnapshot(
  db: SupabaseClient,
  guildCode: string,
  member: KeyHolderRow,
  live: NonNullable<LiveFetchOutcome['live']>,
  fetchedAt: string
): void {
  try {
    writeBackPlayerTokenSnapshot(
      db,
      member,
      {
        tokensAvailable: live.tokens.current,
        bombsAvailable: live.bombs?.current ?? 0,
        tokenNextSeconds: live.tokens.nextTokenInSeconds,
        bombNextSeconds: live.bombs?.nextTokenInSeconds ?? null
      },
      { onlyIfLastSyncBefore: fetchedAt }
    )
  } catch (error) {
    logger.warn(
      {
        guildCode,
        player: member.display_name,
        error: error instanceof Error ? error.message : String(error)
      },
      'snapshot write-back failed; audit row unaffected'
    )
  }
}

function replayReading(
  playerBattles: BattleRow[],
  now: Date,
  anchorStart: Date | null
): EstimatorReading {
  const result = calculateTokenAvailability(
    playerBattles.map((b) => ({
      displayName: b.displayName,
      damageType:
        b.damageType === 'Bomb' ? ('Bomb' as const) : ('Battle' as const),
      startedOn: b.startedOn
    })),
    anchorStart ?? undefined,
    now
  )
  return {
    tokensAvailable: result.tokensAvailable,
    tokenNextSeconds: result.tokenNextSeconds ?? null
  }
}

async function auditGuild(
  db: SupabaseClient,
  args: {
    guildCode: string
    season: string
    seasonStartAt: Date | null
    anchorStartAt: Date | null
    members: KeyHolderRow[]
    now: Date
    forceMode: AuditMode | null
    runBudget: LiveAuditRunBudget
  }
): Promise<
  | { skipped: true; reason: string }
  | { skipped: false; result: GuildAuditResult }
> {
  const {
    guildCode,
    season,
    seasonStartAt,
    anchorStartAt,
    members,
    now,
    forceMode,
    runBudget
  } = args

  let mode = forceMode
  if (!mode) {
    const [firstBattleRes, lastDailyRes] = await Promise.all([
      db
        .from('EOT_GR_data')
        .select('startedOn')
        .eq('Guild', guildCode)
        .eq('Season', season)
        .order('startedOn', { ascending: true })
        .limit(1),
      db
        .from('token_audit_snapshots')
        .select('created_at')
        .eq('guild_code', guildCode)
        .eq('mode', 'daily')
        .order('created_at', { ascending: false })
        .limit(1)
    ])

    const firstBattleRaw = firstBattleRes.data?.[0]?.startedOn
    const seasonFirstBattleAt = firstBattleRaw ? new Date(firstBattleRaw) : null
    const lastDailyRaw = lastDailyRes.data?.[0]?.created_at
    const lastDailyRunAt = lastDailyRaw ? new Date(lastDailyRaw) : null

    mode = decideAuditMode({
      now,
      seasonStartAt,
      seasonFirstBattleAt,
      lastDailyRunAt
    })
    if (!mode) {
      // Only the audit insert is daily-spaced; the hourly snapshot refresh still runs.
      const liveResults = await fetchLiveReadings(members, runBudget)
      for (const settled of liveResults) {
        if (settled.status !== 'fulfilled' || !settled.value.live) continue
        const { member, live, fetchedAt } = settled.value
        writeBackLiveSnapshot(db, guildCode, member, live, fetchedAt)
      }
      return { skipped: true, reason: 'daily_spacing' }
    }
  }

  const seasonNumForPrev = Number(season)
  const replaySeasons =
    Number.isFinite(seasonNumForPrev) && seasonNumForPrev > 1
      ? [season, String(seasonNumForPrev - 1)]
      : [season]
  const [battlesRes, rpcRes, usageRes] = await Promise.all([
    db
      .from('EOT_GR_data')
      .select('userId, displayName, damageType, startedOn, Season')
      .eq('Guild', guildCode)
      .in('Season', replaySeasons)
      .in('damageType', ['Battle', 'Bomb'])
      .order('startedOn', { ascending: true }),
    db.rpc('get_player_token_state', {
      p_guild_code: guildCode,
      p_season: season,
      p_cluster_code: null,
      p_player_id: null
    }),
    db.rpc('get_token_usage_for_guild', {
      p_guild_code: guildCode,
      p_season: season
    })
  ])

  if (battlesRes.error) {
    return {
      skipped: true,
      reason: `battles_query_failed: ${battlesRes.error.message}`
    }
  }
  const battles = (battlesRes.data ?? []).filter(hasReplayIdentity)

  const rpcByPlayerId = new Map<
    string,
    EstimatorReading & {
      dataSource: string | null
      postSnapshotSpends: number | null
    }
  >()
  let rpcHasPostSnapshotSpends = false
  if (rpcRes.error) {
    logger.warn(
      { guildCode, error: rpcRes.error.message },
      'get_player_token_state failed during audit; rpc columns will be null'
    )
  } else {
    for (const row of (rpcRes.data ?? []) as RpcTokenStateRow[]) {
      if (typeof row.player_id !== 'string') continue
      if ('post_snapshot_spends' in row) rpcHasPostSnapshotSpends = true
      rpcByPlayerId.set(row.player_id, {
        tokensAvailable:
          typeof row.tokens_available === 'number'
            ? row.tokens_available
            : null,
        tokenNextSeconds:
          typeof row.token_next_in_seconds === 'number'
            ? row.token_next_in_seconds
            : null,
        dataSource:
          typeof row.data_source === 'string' ? row.data_source : null,
        postSnapshotSpends:
          typeof row.post_snapshot_spends === 'number'
            ? row.post_snapshot_spends
            : null
      })
    }
  }

  const cptaByPlayerId = new Map<string, number | null>()
  if (usageRes.error) {
    logger.warn(
      { guildCode, error: usageRes.error.message },
      'get_token_usage_for_guild failed during audit; cpta columns will be null'
    )
  } else {
    for (const row of (usageRes.data ?? []) as TokenUsageRow[]) {
      if (typeof row.player_id !== 'string') continue
      cptaByPlayerId.set(
        row.player_id,
        typeof row.tokens_available === 'number' ? row.tokens_available : null
      )
    }
  }

  const liveResults = await fetchLiveReadings(members, runBudget)

  const rows: AuditRow[] = []
  let liveFetched = 0
  for (const settled of liveResults) {
    if (settled.status !== 'fulfilled' || !settled.value.live) continue
    liveFetched += 1
    const { member, live, fetchedAt } = settled.value

    const playerReplayBattles = battles.filter(
      (b) => b.userId === member.player_id
    )
    const currentSeasonRows = playerReplayBattles.filter(
      (b) => b.Season === season
    )
    const rpcReading = rpcByPlayerId.get(member.player_id) ?? null
    rows.push(
      buildAuditRow({
        guildCode,
        playerId: member.player_id,
        displayName: member.display_name,
        season,
        mode,
        live: live.tokens,
        liveBombs: live.bombs,
        replay: replayReading(playerReplayBattles, now, anchorStartAt),
        rpc: rpcReading,
        cptaTokens: cptaByPlayerId.get(member.player_id) ?? null,
        rpcPostSnapshotSpends: rpcHasPostSnapshotSpends
          ? (rpcReading?.postSnapshotSpends ?? null)
          : undefined,
        battleRowsSeen: currentSeasonRows.length
      })
    )

    // Strictly after buildAuditRow.
    writeBackLiveSnapshot(db, guildCode, member, live, fetchedAt)
  }

  if (rows.length > 0) {
    const { error: insertError } = await db
      .from('token_audit_snapshots')
      .insert(rows)
    if (insertError) {
      return {
        skipped: true,
        reason: `insert_failed: ${insertError.message}`
      }
    }
  }

  return {
    skipped: false,
    result: {
      guild_code: guildCode,
      mode,
      live_eligible: members.length,
      live_fetched: liveFetched,
      rows_inserted: rows.length
    }
  }
}

type AuditRunContext =
  | { held: true }
  | {
      held: false
      season: string
      seasonStartAt: Date | null
      anchorStartAt: Date | null
    }

async function resolveAuditContext(
  db: SupabaseClient,
  now: Date
): Promise<AuditRunContext> {
  // Held until token_audit_snapshots exists; exits before any Tacticus call.
  const probe = await db.from('token_audit_snapshots').select('id').limit(1)
  if (probe.error) {
    if (isMissingTableError(probe.error)) {
      logger.info(
        {},
        'token_audit_snapshots missing (deployment held) — audit skipped'
      )
      return { held: true }
    }
    throw new Error(
      `token_audit_snapshots probe failed: ${probe.error.message}`
    )
  }

  const { data: seasonData, error: seasonError } =
    await db.rpc('get_latest_season')
  if (seasonError || typeof seasonData !== 'string' || !seasonData.trim()) {
    throw new Error(
      `get_latest_season failed: ${seasonError?.message ?? 'empty result'}`
    )
  }
  const season = seasonData.trim()

  // get_latest_season lags at a boundary until someone battles, so also try the
  // next season and anchor on the latest start already past.
  let seasonStartAt: Date | null = null
  const seasonNum = Number(season)
  if (Number.isFinite(seasonNum)) {
    for (const candidate of [seasonNum, seasonNum + 1]) {
      try {
        const timing = await getSeasonTiming(candidate)
        const start = new Date(timing.seasonStart)
        if (
          !Number.isNaN(start.getTime()) &&
          start.getTime() <= now.getTime() &&
          (!seasonStartAt || start.getTime() > seasonStartAt.getTime())
        ) {
          seasonStartAt = start
        }
      } catch (error) {
        logger.warn(
          {
            season: candidate,
            error: error instanceof Error ? error.message : String(error)
          },
          'season timing unavailable for rollover anchor candidate'
        )
      }
    }
  }

  let anchorStartAt: Date | null = seasonStartAt
  if (Number.isFinite(seasonNum) && seasonNum > 1) {
    try {
      const prevTiming = await getSeasonTiming(seasonNum - 1)
      const prevStart = new Date(prevTiming.seasonStart)
      if (!Number.isNaN(prevStart.getTime())) {
        anchorStartAt = prevStart
      }
    } catch (error) {
      logger.warn(
        {
          season: seasonNum - 1,
          error: error instanceof Error ? error.message : String(error)
        },
        'previous-season timing unavailable; replay anchor falls back'
      )
    }
  }

  return { held: false, season, seasonStartAt, anchorStartAt }
}

export async function runTokenAudit(
  options: {
    now?: Date
    forceMode?: AuditMode | null
  } = {}
): Promise<TokenAuditSummary> {
  const now = options.now ?? new Date()
  const forceMode = options.forceMode ?? null
  // token_audit_snapshots is not in the generated schema.
  const db = serviceDb() as unknown as SupabaseClient

  const ctx = await resolveAuditContext(db, now)
  if (ctx.held) {
    return {
      held: true,
      season: null,
      guilds: [],
      total_rows: 0,
      skipped_guilds: []
    }
  }
  const { season, seasonStartAt, anchorStartAt } = ctx

  const { data: keyHolders, error: keyHolderError } = await db
    .from('player_mapping')
    .select(
      'player_id, display_name, guild_code, tacticus_api_key_encrypted, last_sync_tokens, last_sync_bombs, next_token_seconds, next_bomb_seconds, api_key_is_valid'
    )
    .eq('is_current', true)
    .not('tacticus_api_key_encrypted', 'is', null)
    .not('guild_code', 'is', null)
  if (keyHolderError) {
    throw new Error(`key-holder query failed: ${keyHolderError.message}`)
  }

  const byGuild = new Map<string, KeyHolderRow[]>()
  for (const row of (keyHolders ?? []) as KeyHolderRow[]) {
    if (!row.guild_code || !row.player_id) continue
    const list = byGuild.get(row.guild_code) ?? []
    list.push(row)
    byGuild.set(row.guild_code, list)
  }

  const guilds: GuildAuditResult[] = []
  const skippedGuilds: Array<{ guild_code: string; reason: string }> = []

  const runBudget = newLiveAuditRunBudget()

  for (const [guildCode, members] of byGuild) {
    try {
      const outcome = await auditGuild(db, {
        guildCode,
        season,
        seasonStartAt,
        anchorStartAt,
        members,
        now,
        forceMode,
        runBudget
      })
      if (outcome.skipped) {
        skippedGuilds.push({ guild_code: guildCode, reason: outcome.reason })
      } else {
        guilds.push(outcome.result)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn({ guildCode, error: message }, 'guild audit failed')
      skippedGuilds.push({
        guild_code: guildCode,
        reason: `error: ${message}`
      })
    }
  }

  const totalRows = guilds.reduce((sum, g) => sum + g.rows_inserted, 0)
  logger.info(
    {
      season,
      guildsAudited: guilds.length,
      guildsSkipped: skippedGuilds.length,
      totalRows
    },
    'token audit run complete'
  )

  return {
    held: false,
    season,
    guilds,
    total_rows: totalRows,
    skipped_guilds: skippedGuilds
  }
}

export interface GuildTokenAuditSummary {
  held: boolean
  season: string | null
  guild_code: string
  skipped: boolean
  reason: string | null
  result: GuildAuditResult | null
}

// Throws on infrastructure errors so the queue retries; soft conditions return skipped.
export async function runTokenAuditForGuild(options: {
  guildCode: string
  now?: Date
  forceMode?: AuditMode | null
}): Promise<GuildTokenAuditSummary> {
  const now = options.now ?? new Date()
  const forceMode = options.forceMode ?? null
  const db = serviceDb() as unknown as SupabaseClient

  const ctx = await resolveAuditContext(db, now)
  if (ctx.held) {
    return {
      held: true,
      season: null,
      guild_code: options.guildCode,
      skipped: true,
      reason: 'deployment_held',
      result: null
    }
  }
  const { season, seasonStartAt, anchorStartAt } = ctx

  const { data: keyHolders, error: keyHolderError } = await guildRosterQuery(
    db,
    options.guildCode,
    'player_id, display_name, guild_code, tacticus_api_key_encrypted, last_sync_tokens, last_sync_bombs, next_token_seconds, next_bomb_seconds, api_key_is_valid'
  ).not('tacticus_api_key_encrypted', 'is', null)
  if (keyHolderError) {
    throw new Error(`key-holder query failed: ${keyHolderError.message}`)
  }

  const members = ((keyHolders ?? []) as KeyHolderRow[]).filter(
    (row) => Boolean(row.guild_code) && Boolean(row.player_id)
  )
  if (members.length === 0) {
    return {
      held: false,
      season,
      guild_code: options.guildCode,
      skipped: true,
      reason: 'no_key_holders',
      result: null
    }
  }

  const outcome = await auditGuild(db, {
    guildCode: options.guildCode,
    season,
    seasonStartAt,
    anchorStartAt,
    members,
    now,
    forceMode,
    runBudget: newLiveAuditRunBudget()
  })

  if (outcome.skipped) {
    return {
      held: false,
      season,
      guild_code: options.guildCode,
      skipped: true,
      reason: outcome.reason,
      result: null
    }
  }
  return {
    held: false,
    season,
    guild_code: options.guildCode,
    skipped: false,
    reason: null,
    result: outcome.result
  }
}
