import { guildRosterQuery } from '@/app/lib/data/guild-roster'
/**
 * Authoritative guild-rank reconciler (role-only /guild overlay).
 * job_type='reconcile-guild-ranks', job_class='batch', consumed by workers-batch.
 *
 * Guild sync derives ranks only from LOKI and skips when LOKI returns 0
 * members, so in-game promotions can be missed and members stuck at a stale,
 * lower clearance. This overlays ranks from the reliable Tacticus `/guild`
 * member roles while LOKI stays the source of names / avatar / power; the same
 * role-only reconcile runs at guild creation.
 *
 * Safety:
 *   - role-ONLY UPDATE (never writes display_name / other fields).
 *   - PROMOTE-to-match by default; demotion (in-game member but app elevated) is
 *     logged-not-applied unless payload.demote === true (sensitive direction).
 *   - never touches `protected` or `is_app_admin` rows.
 *   - leaves `member` targets alone in promote mode (the default; gates nothing).
 *   - soft-timeout-then-partial + shuffled guild order, mirroring
 *     roster-loki-backfill.ts, so no guild is systematically starved.
 */

import { randomInt } from 'node:crypto'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import { resolveStoredSecret } from '@tacticus/app-core/encryption'
import { API_URLS } from '@tacticus/app-core/api-constants'
import { normalizeTacticusGuildRole } from '@tacticus/app-core/role-utils'
import { withRetry, TACTICUS_API_POLICY } from '@/app/lib/resilience'
import { registerJobHandler } from './dispatcher'
import { softDeadlineFor } from './deadline'
import type { JobHandler } from './types'

const logger = createComponentLogger('lib.jobs.reconcile-guild-ranks')

const SOFT_TIMEOUT_MS = 240_000 // 4 min — comfortable within the worker tick
const INTER_GUILD_DELAY_MS = 100 // gentle on the Tacticus API
const MAX_FAILURES = 5 // skip guilds in a sustained sync-failure state
const TACTICUS_GUILD_TIMEOUT_MS = 15_000

type ReconcileAppRole = 'leader' | 'officer' | 'member'

interface ReconcileGuildRanksPayload {
  guildCode?: string
  demote?: boolean
}

interface StoredRosterRow {
  id: number
  player_id: string | null
  display_name: string | null
  role: string | null
  protected: boolean | null
  is_app_admin: boolean | null
}

interface ReconcileAction {
  id: number
  playerId: string
  displayName: string | null
  from: string
  to: ReconcileAppRole
  direction: 'promote' | 'demote'
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Unknown error'

/**
 * Map a Tacticus `/guild` member role to an app_role (CO_LEADER and LEADER are
 * both `leader`, not `officer`).
 */
export function mapTacticusRoleToAppRole(
  role: string | null | undefined
): ReconcileAppRole {
  return normalizeTacticusGuildRole(role)
}

function appRoleRank(role: string | null | undefined): number {
  const u = String(role ?? '').toLowerCase()
  if (u === 'leader') return 3
  if (u === 'officer') return 2
  return 1
}

/**
 * Pure decision core (unit-tested): given the authoritative live roles
 * (player_id → in-game role) and the stored is_current rows, produce the
 * role-only changes. Never proposes touching protected / app-admin rows; only
 * proposes demotions when `demote` is enabled.
 */
export function computeRankReconcileActions(
  liveRoles: Map<string, string>,
  stored: StoredRosterRow[],
  opts: { demote: boolean }
): ReconcileAction[] {
  const actions: ReconcileAction[] = []
  for (const row of stored) {
    if (!row.player_id) continue
    if (row.protected || row.is_app_admin) continue
    const live = liveRoles.get(row.player_id)
    if (live === undefined) continue // not in the live roster — leave to the membership path
    const want = mapTacticusRoleToAppRole(live)
    const haveRank = appRoleRank(row.role)
    const wantRank = appRoleRank(want)
    if (haveRank === wantRank) continue
    const direction = wantRank > haveRank ? 'promote' : 'demote'
    if (direction === 'demote' && !opts.demote) continue
    actions.push({
      id: row.id,
      playerId: row.player_id,
      displayName: row.display_name,
      from: String(row.role ?? 'member'),
      to: want,
      direction
    })
  }
  return actions
}

interface GuildRolesResult {
  /** The Tacticus guildId the supplied key actually belongs to (identity check). */
  guildId: string | null
  /** player_id → in-game role. */
  roles: Map<string, string>
}

/**
 * Fetch authoritative member roles from Tacticus `/guild` (roles only, no
 * names) plus the guildId the key belongs to, so the caller can confirm the
 * roster is for the expected guild. Returns null on error / empty roster.
 */
async function fetchGuildRolesViaTacticus(
  apiKey: string,
  guildCode: string
): Promise<GuildRolesResult | null> {
  const url = `${API_URLS.TACTICUS.BASE}/guild`
  try {
    const response = await withRetry(
      async () => {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(TACTICUS_GUILD_TIMEOUT_MS)
        })
        if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`)
        return res
      },
      { ...TACTICUS_API_POLICY, maxAttempts: 2 }
    )

    if (!response.ok) {
      logger.warn(
        { guildCode, status: response.status },
        '[ReconcileGuildRanks] /guild fetch non-OK'
      )
      return null
    }

    const data = (await response.json()) as Record<string, unknown>
    const guild = data.guild as Record<string, unknown> | undefined
    const fetchedGuildId = (guild?.guildId ?? data.guildId ?? data.id) as
      string | undefined
    const rawMembers =
      (guild?.members as unknown[] | undefined) ??
      (data.members as unknown[] | undefined) ??
      []

    if (!Array.isArray(rawMembers) || rawMembers.length === 0) {
      return null
    }

    const map = new Map<string, string>()
    for (const entry of rawMembers) {
      const m = entry as Record<string, unknown>
      const id = (m.userId ?? m.playerId ?? m.id) as string | undefined
      if (id && typeof id === 'string' && typeof m.role === 'string') {
        map.set(id, m.role)
      }
    }
    return map.size > 0
      ? {
          guildId: typeof fetchedGuildId === 'string' ? fetchedGuildId : null,
          roles: map
        }
      : null
  } catch (error) {
    logger.warn(
      { guildCode, err: getErrorMessage(error) },
      '[ReconcileGuildRanks] /guild fetch failed'
    )
    return null
  }
}

const reconcileGuildRanksHandler: JobHandler = async (payload, ctx) => {
  const startTime = Date.now()
  const softDeadline = softDeadlineFor(startTime, SOFT_TIMEOUT_MS, ctx)

  const { guildCode: scopeGuild } = (payload ??
    {}) as ReconcileGuildRanksPayload
  // Demotion is the sensitive direction: require a strict boolean `true`, since
  // a payload string like 'false' would pass a truthy cast.
  const demote =
    (payload as Record<string, unknown> | undefined)?.demote === true

  logger.info(
    { jobId: ctx.jobId, guildCode: scopeGuild ?? 'ALL', demote },
    '[ReconcileGuildRanks] starting'
  )

  const supabase = serviceDb()

  try {
    let guildsQuery = supabase
      .from('guild_config')
      .select(
        'guild_code, display_name, guild_id, api_key_encrypted, consecutive_sync_failures'
      )
      .eq('enabled', true)
      .eq('auto_sync_enabled', true)
      // Match batch-sync eligibility: include validity true and null (unknown),
      // exclude only an explicit false.
      .not('api_key_is_valid', 'is', false)
      .not('api_key_encrypted', 'is', null)

    if (scopeGuild) {
      guildsQuery = guildsQuery.eq('guild_code', scopeGuild)
    }

    const { data: guilds, error: guildsErr } = await guildsQuery

    if (guildsErr) {
      throw new Error(`Failed to fetch guilds: ${guildsErr.message}`)
    }

    const eligibleGuilds = (guilds ?? []).filter(
      (g) => (g.consecutive_sync_failures ?? 0) < MAX_FAILURES
    )

    if (eligibleGuilds.length === 0) {
      logger.info(
        { jobId: ctx.jobId },
        '[ReconcileGuildRanks] no eligible guilds'
      )
      return {
        guilds: 0,
        scanned: 0,
        promoted: 0,
        demoted: 0,
        demotionsDetected: 0,
        skipped: 0,
        mismatched: 0,
        failed: 0,
        durationMs: Date.now() - startTime
      }
    }

    // Fair rotation: shuffle so a soft-timeout doesn't starve the same tail.
    for (let i = eligibleGuilds.length - 1; i > 0; i--) {
      const j = randomInt(i + 1)
      const tmp = eligibleGuilds[i]!
      eligibleGuilds[i] = eligibleGuilds[j]!
      eligibleGuilds[j] = tmp
    }

    let scanned = 0
    let promoted = 0
    let demoted = 0
    let demotionsDetected = 0
    let skipped = 0
    let mismatched = 0
    let failed = 0
    let timedOutEarly = false

    for (const guild of eligibleGuilds) {
      if (Date.now() >= softDeadline) {
        logger.warn(
          { jobId: ctx.jobId, scanned, promoted, demoted, skipped },
          '[ReconcileGuildRanks] soft deadline reached — partial run'
        )
        timedOutEarly = true
        break
      }

      const apiKey = await resolveStoredSecret(guild.api_key_encrypted)
      if (!apiKey) {
        skipped++
        continue
      }

      const fetched = await fetchGuildRolesViaTacticus(apiKey, guild.guild_code)
      if (!fetched) {
        skipped++
        await new Promise((r) => setTimeout(r, INTER_GUILD_DELAY_MS))
        continue
      }

      // Guild-identity guard: reconcile only when the fetched roster positively
      // belongs to this guild. A key whose owner moved guilds returns another
      // guild's roster, and this job writes clearance unattended. Expected
      // identity is guild_id when set, else the (UUID) guild_code.
      const expectedGuildId = guild.guild_id ?? guild.guild_code
      if (!fetched.guildId || fetched.guildId !== expectedGuildId) {
        logger.warn(
          {
            jobId: ctx.jobId,
            guildCode: guild.guild_code,
            fetchedGuildId: fetched.guildId,
            expectedGuildId
          },
          '[ReconcileGuildRanks] guild identity not confirmed — skipping (key may belong to another guild)'
        )
        mismatched++
        await new Promise((r) => setTimeout(r, INTER_GUILD_DELAY_MS))
        continue
      }

      const liveRoles = fetched.roles

      const { data: stored, error: storedErr } = await guildRosterQuery(
        supabase,
        guild.guild_code,
        'id, player_id, display_name, role, protected, is_app_admin'
      ).not('player_id', 'is', null)

      if (storedErr) {
        logger.warn(
          {
            jobId: ctx.jobId,
            guildCode: guild.guild_code,
            err: storedErr.message
          },
          '[ReconcileGuildRanks] fetch stored roster failed'
        )
        failed++
        continue
      }

      const actions = computeRankReconcileActions(
        liveRoles,
        (stored ?? []) as StoredRosterRow[],
        { demote }
      )

      // Count detected (but not-applied) demotions for observability even when
      // demotion is disabled.
      demotionsDetected += (stored ?? []).reduce((acc, row) => {
        const r = row as StoredRosterRow
        if (!r.player_id || r.protected || r.is_app_admin) return acc
        const live = liveRoles.get(r.player_id)
        if (live === undefined) return acc
        return appRoleRank(mapTacticusRoleToAppRole(live)) < appRoleRank(r.role)
          ? acc + 1
          : acc
      }, 0)

      if (actions.length > 0) {
        // Role-only updates grouped by (oldRole -> newRole) so each write can
        // carry a `.eq('role', oldRole)` guard and no-op if the role changed
        // since the SELECT (never clobber a concurrent promotion).
        const byPair = new Map<
          string,
          { from: string; to: ReconcileAppRole; ids: number[] }
        >()
        for (const a of actions) {
          const key = `${a.from} ${a.to}`
          const group = byPair.get(key) ?? { from: a.from, to: a.to, ids: [] }
          group.ids.push(a.id)
          byPair.set(key, group)
        }

        for (const { from, to: role, ids } of byPair.values()) {
          const { error: updErr } = await supabase
            .from('player_mapping')
            .update({ role, updated_at: new Date().toISOString() })
            .in('id', ids)
            .eq('guild_code', guild.guild_code)
            .eq('is_current', true)
            // Only rows still at the observed old role. `from` is the stored
            // enum value verbatim; the cast only narrows the string type.
            .eq('role', from as ReconcileAppRole)
            // Write-time protection guard: rows flipped to protected /
            // is_app_admin after the SELECT are never re-ranked (NULL counts
            // as unprotected, matching the decision core).
            .not('protected', 'is', true)
            .not('is_app_admin', 'is', true)

          if (updErr) {
            logger.warn(
              {
                jobId: ctx.jobId,
                guildCode: guild.guild_code,
                role,
                count: ids.length,
                err: updErr.message
              },
              '[ReconcileGuildRanks] role update failed'
            )
            failed++
            continue
          }

          for (const a of actions) {
            if (a.from !== from || a.to !== role) continue
            if (a.direction === 'promote') promoted++
            else demoted++
          }
        }

        logger.info(
          {
            jobId: ctx.jobId,
            guildCode: guild.guild_code,
            guildName: guild.display_name,
            changes: actions.map((a) => ({
              player: a.displayName,
              from: a.from,
              to: a.to,
              dir: a.direction
            }))
          },
          '[ReconcileGuildRanks] reconciled ranks'
        )
      }

      scanned++
      await new Promise((r) => setTimeout(r, INTER_GUILD_DELAY_MS))
    }

    const durationMs = Date.now() - startTime
    logger.info(
      {
        jobId: ctx.jobId,
        guilds: eligibleGuilds.length,
        scanned,
        promoted,
        demoted,
        demotionsDetected,
        skipped,
        mismatched,
        failed,
        durationMs,
        timedOutEarly
      },
      '[ReconcileGuildRanks] complete'
    )

    return {
      guilds: eligibleGuilds.length,
      scanned,
      promoted,
      demoted,
      demotionsDetected,
      skipped,
      mismatched,
      failed,
      durationMs,
      partialDueToTimeout: timedOutEarly
    }
  } catch (error) {
    rethrowIfAppError(error)
    const message = getErrorMessage(error)
    captureSentryException(error, {
      tags: { handler: 'reconcile-guild-ranks', jobId: String(ctx.jobId) },
      extra: { guildCode: scopeGuild ?? 'ALL' }
    })
    logger.error(
      { jobId: ctx.jobId, err: message },
      '[ReconcileGuildRanks] handler failed'
    )
    throw error
  }
}

export function registerReconcileGuildRanksHandler(): void {
  registerJobHandler('reconcile-guild-ranks', reconcileGuildRanksHandler)
}

export const __internal = {
  reconcileGuildRanksHandler,
  fetchGuildRolesViaTacticus
}
