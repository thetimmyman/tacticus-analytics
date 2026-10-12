import 'server-only'

import { db } from '@/app/lib/db'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { AppError, Errors } from '@/app/lib/errors/AppError'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'
import {
  resolveSavedPlanningRotation,
  resolveSavedSeasonWindow
} from './season-planner/saved-season'
import {
  parseReplacement,
  parseReplacementJson,
  record,
  savedStateFromRpc,
  replacementSummary,
  clearSummary,
  SAVED_ASSIGNMENTS_BODY_BYTES
} from './saved-assignments-input'
import {
  getTokenAvailability,
  SEASON_MAX_SPENDABLE_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'
import { computeSeasonTokenAggregates } from '@/app/lib/season-forecast/season-token-economy'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type {
  SavedAssignmentResult,
  ReplacementSummary,
  ClearSummary
} from './saved-assignments-types'

const DEADLINE_MS = 7000
type Query = PromiseLike<{ data: unknown; error: unknown }> & {
  throwOnError(): Query
  abortSignal(signal: AbortSignal): Query
  retry(enabled: boolean): Query
}

function selectedSeason(params: URLSearchParams): string {
  for (const key of params.keys())
    if (key !== 'season_number' || params.getAll(key).length !== 1)
      throw Errors.validation('Unsupported saved assignment parameter')
  const season = params.get('season_number') ?? ''
  if (!/^[1-9]\d{0,5}$/.test(season))
    throw Errors.validation('A saved season is required')
  return season
}

/** One caller-bound entry/deadline; no shared cache, service model client or
 * global mapping preference fallback. Auth's SDK call cannot itself abort. */
export async function savedAssignmentRequest(args: {
  params: URLSearchParams
  signal: AbortSignal
  action: 'read' | 'replace' | 'clear'
  body?: ReadableStream<Uint8Array> | null
  contentType?: string | null
}): Promise<SavedAssignmentResult> {
  const season = selectedSeason(args.params)
  const controller = new AbortController()
  const deadline = performance.now() + DEADLINE_MS
  let writeAttempted = false
  let interruption: AppError | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => {
      interruption ??= Errors.timeout('Saved assignment request canceled')
      reject(interruption)
      controller.abort()
    }
    if (args.signal.aborted) onAbort()
    else args.signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      interruption ??= Errors.external(
        'Saved assignment request timed out',
        503
      )
      reject(interruption)
      controller.abort()
    }, DEADLINE_MS)
  })
  const running = () => {
    if (interruption) throw interruption
    if (performance.now() >= deadline) {
      interruption = Errors.external('Saved assignment request timed out', 503)
      controller.abort()
      throw interruption
    }
  }
  const run = async (input: unknown, mutation = false): Promise<unknown> => {
    running()
    const query = input as Query
    try {
      const result = await query
        .throwOnError()
        .abortSignal(controller.signal)
        .retry(false)
      running()
      if (result.error)
        throw Errors.external('Saved assignments unavailable', 503)
      return result.data
    } catch (error) {
      running()
      if (mutation && record(error) && error.code === '42501')
        throw Errors.forbidden('Saved assignment mutation refused')
      if (
        mutation &&
        record(error) &&
        ['22023', '22P02', '23514'].includes(String(error.code))
      )
        throw Errors.validation('Saved assignment mutation refused')
      throw Errors.external('Saved assignments unavailable', 503)
    }
  }
  const read = async (): Promise<SavedAssignmentResult> => {
    running()
    const client = await Promise.race([db(), stopped])
    running()
    const identity = await Promise.race([client.auth.getUser(), stopped]).catch(
      (error: unknown) => {
        if (error === interruption) throw error
        throw Errors.external(
          'Saved assignment authentication unavailable',
          503
        )
      }
    )
    running()
    const user = await requireSessionUser(
      { auth: { getUser: async () => identity } } as Pick<
        TypedSupabaseClient,
        'auth'
      >,
      undefined,
      controller.signal
    )
    running()
    const membership = async () => {
      const data = await run(
        client
          .from(CURRENT_USER_PLAYER_MAPPING)
          .select('player_id,guild_code,role')
          .eq('user_id', user.id)
          .eq('is_current', true)
          .eq('is_active', true)
          .maybeSingle()
      )
      if (
        !data ||
        typeof data !== 'object' ||
        !('guild_code' in data) ||
        typeof data.guild_code !== 'string' ||
        !data.guild_code ||
        !('role' in data) ||
        typeof data.role !== 'string' ||
        !['member', 'officer', 'leader'].includes(data.role.toLowerCase())
      )
        throw Errors.forbidden('Current guild membership required')
      return {
        guild: normalizeGuildIdentifier(data.guild_code),
        role: data.role
      }
    }
    const initial = await membership()
    const seasons = await run(
      client.rpc('get_distinct_seasons_for_guild', { p_guild: initial.guild })
    )
    if (!Array.isArray(seasons))
      throw Errors.external('Saved seasons unavailable', 503)
    if (!seasons.includes(season))
      throw Errors.unprocessable(
        'Import raid data for the selected saved season'
      )
    const rotation = resolveSavedPlanningRotation(
      season,
      new Date(0).toISOString()
    )
    const feature = await run(
      client
        .from('feature_releases')
        .select('release_stage')
        .eq('feature_key', 'boss_assignments')
        .maybeSingle()
    )
    if (
      !feature ||
      typeof feature !== 'object' ||
      !('release_stage' in feature) ||
      feature.release_stage !== 'public'
    )
      throw Errors.forbidden('Saved assignments access required')
    let summary: ReplacementSummary | undefined
    let deleted: ClearSummary | undefined
    if (args.action !== 'read') {
      if (initial.role !== 'officer' && initial.role !== 'leader')
        throw Errors.forbidden('Lowercase officer or leader role required')
      const rpc = client.rpc.bind(client) as unknown as (
        name: string,
        params: Record<string, unknown>
      ) => Query
      let rpcArgs: Record<string, unknown> = { p_season_number: season }
      if (args.action === 'replace') {
        if (
          args.contentType?.split(';', 1)[0]?.trim().toLowerCase() !==
          'application/json'
        )
          throw Errors.fromStatus(415, 'Replacement body must be JSON')
        if (!args.body) throw Errors.validation('Replacement body is required')
        const reader = args.body.getReader()
        const decoder = new TextDecoder('utf-8', { fatal: true })
        const decode = (value?: Uint8Array, stream = false) => {
          try {
            return decoder.decode(value, { stream })
          } catch {
            throw Errors.validation('Invalid replacement UTF-8')
          }
        }
        let bytes = 0
        let text = ''
        try {
          while (true) {
            running()
            const { done, value } = await Promise.race([reader.read(), stopped])
            running()
            if (done) break
            bytes += value.byteLength
            if (bytes > SAVED_ASSIGNMENTS_BODY_BYTES)
              throw Errors.fromStatus(413, 'Replacement body too large')
            text += decode(value, true)
          }
          text += decode()
        } finally {
          void reader.cancel().catch(() => {})
          reader.releaseLock()
        }
        const raw = parseReplacementJson(text)
        const replacement = parseReplacement(raw, rotation.currentBosses)
        const { seasonStartMs, seasonEndMs } = resolveSavedSeasonWindow(season)
        if (
          replacement.asOfMs < seasonStartMs ||
          replacement.asOfMs >= seasonEndMs
        )
          throw Errors.unprocessable(
            'asOf must be within the selected saved season'
          )
        const [roster, history] = await Promise.all([
          run(
            client
              .from('player_mapping')
              .select('player_id,display_name')
              .eq('guild_code', initial.guild)
              .eq('is_current', true)
              .eq('is_active', true)
              .limit(31)
          ),
          run(
            client
              .from('EOT_GR_data')
              .select('userId,startedOn,damageType')
              .eq('Guild', initial.guild)
              .eq('Season', season)
              .eq('damageType', 'Battle')
              .gte('startedOn', new Date(seasonStartMs).toISOString())
              .lte('startedOn', replacement.asOf)
              .limit(10001)
          )
        ])
        if (
          !Array.isArray(roster) ||
          roster.length > 30 ||
          !Array.isArray(history) ||
          history.length > 10000
        )
          throw Errors.external('Saved assignment inputs unavailable', 503)
        const ids = new Set<string>()
        for (const member of roster) {
          if (
            !record(member) ||
            typeof member.player_id !== 'string' ||
            !member.player_id ||
            ids.has(member.player_id)
          )
            throw Errors.external('Saved roster unavailable', 503)
          ids.add(member.player_id)
        }
        for (const assignment of replacement.assignments) {
          if (!ids.has(assignment.player_id))
            throw Errors.validation(
              'Assignment player is not in the current active guild roster'
            )
          const battles = history
            .filter((row) => {
              if (
                !record(row) ||
                typeof row.userId !== 'string' ||
                typeof row.startedOn !== 'string' ||
                !Number.isFinite(Date.parse(row.startedOn)) ||
                row.damageType !== 'Battle'
              )
                throw Errors.external('Saved token history unavailable', 503)
              return row.userId === assignment.player_id
            })
            .map((row) => ({
              displayName: '',
              damageType: 'Battle' as const,
              startedOn: (row as Record<string, string>).startedOn!
            }))
          const bank = getTokenAvailability(
            null,
            battles,
            new Date(seasonStartMs),
            new Date(replacement.asOf)
          ).tokensAvailable
          const seconds = (seasonEndMs - replacement.asOfMs) / 1000
          const budget = computeSeasonTokenAggregates({
            players: [
              { bank, usedThisSeason: battles.length, recentBattleCount: 0 }
            ],
            regenToEnd: Math.floor(seconds / TWELVE_HOURS_IN_SECONDS),
            daysRemaining: seconds / 86400,
            rateWindowDays: 1,
            seasonMaxTokens: SEASON_MAX_SPENDABLE_TOKENS,
            regenPerDay: 2
          }).tokensRemaining
          const total = Object.values(assignment.token_allocations).reduce(
            (sum, value) => sum + value,
            0
          )
          if (!Number.isSafeInteger(total) || total > budget)
            throw Errors.unprocessable(
              'Allocation exceeds saved season token budget'
            )
        }
        rpcArgs = {
          ...rpcArgs,
          p_bosses: replacement.bosses,
          p_assignments: replacement.assignments
        }
      } else if (args.body) {
        // Node-backed DELETE requests can have a stream even with no payload.
        // Only actual empty EOF permits a clear; do not trust body headers.
        const reader = args.body.getReader()
        let chunks = 0
        try {
          while (true) {
            running()
            const { done, value } = await Promise.race([reader.read(), stopped])
            running()
            if (done) break
            if (value.byteLength !== 0 || ++chunks > 1024)
              throw Errors.validation('Clear does not accept a body')
          }
        } finally {
          void reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      }
      const writer = await membership()
      if (
        writer.guild !== initial.guild ||
        (writer.role !== 'officer' && writer.role !== 'leader')
      )
        throw Errors.forbidden('Current lowercase writer membership required')
      running()
      writeAttempted = true
      const result = await run(
        rpc(
          args.action === 'replace'
            ? 'desktop_replace_saved_assignments'
            : 'desktop_clear_saved_assignments',
          rpcArgs
        ),
        true
      )
      if (args.action === 'replace') summary = replacementSummary(result)
      else deleted = clearSummary(result)
    }
    const rpc = client.rpc.bind(client) as unknown as (
      name: string,
      params: Record<string, unknown>
    ) => Query
    const state = savedStateFromRpc(
      await run(
        rpc('desktop_get_saved_assignments', {
          p_season_number: season
        })
      )
    )
    const fresh = await membership()
    if (fresh.guild !== initial.guild)
      throw Errors.forbidden('Current guild membership required')
    running()
    const canWrite = fresh.role === 'officer' || fresh.role === 'leader'
    return {
      source: 'saved-local',
      season,
      ...state,
      canReplace: canWrite,
      canClear: canWrite,
      ...(summary ? { summary } : {}),
      ...(deleted ? { deleted } : {})
    }
  }
  try {
    return await Promise.race([read(), stopped])
  } catch (error) {
    if (writeAttempted) {
      const safe =
        error instanceof AppError
          ? error
          : Errors.external('Saved assignments unavailable', 503)
      throw new AppError(
        safe.code,
        'Saved assignment outcome unavailable; reload the current saved season before retrying',
        safe.statusCode,
        false
      )
    }
    if (error instanceof AppError)
      throw Errors.fromStatus(error.statusCode, error.message)
    throw Errors.external('Saved assignments unavailable', 503)
  } finally {
    clearTimeout(timer)
    if (onAbort) args.signal.removeEventListener('abort', onAbort)
    controller.abort()
  }
}
