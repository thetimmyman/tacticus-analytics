/** Temporary read-only diagnostic: diffs a guild-season's upstream raid rows (via the writer transform)
 * against landed `EOT_GR_data`. Remove with `app/lib/diagnostics/raid-token-diff.ts` once answered. */
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { NextResponse, type NextRequest } from 'next/server'
import { decryptApiKey } from '@tacticus/app-core/encryption'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import {
  extractEntries,
  processRaidEntry,
  type GuildRaidApiResponse,
  type RawRaidEntry
} from '@/app/lib/sync/transformers'
import {
  assertDiffInvariants,
  classifyRawDiscriminators,
  DiffInvariantViolation,
  diffRaidRows,
  finalDayUtc,
  isOnUtcDay,
  toRaidRowKey,
  type RaidRowKey,
  type RawDiscriminators
} from '@/app/lib/diagnostics/raid-token-diff'

const logger = createComponentLogger('api.admin.diagnostics.ps502-token-diff')

export const dynamic = 'force-dynamic'

/** Fixed literals only: no error message, upstream body or credential reaches a response or log. */
const ALLOWED_FAILURES = {
  invalid_request: 'invalid_request',
  guild_not_found: 'guild_not_found',
  guild_key_missing: 'guild_key_missing',
  key_unavailable: 'key_unavailable',
  upstream_unavailable: 'upstream_unavailable',
  season_unresolved: 'season_unresolved',
  landed_query_failed: 'landed_query_failed',
  diff_invariant_violated: 'diff_invariant_violated',
  internal_error: 'internal_error'
} as const

type FailureCode = (typeof ALLOWED_FAILURES)[keyof typeof ALLOWED_FAILURES]

class DiagnosticFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code)
    this.name = 'DiagnosticFailure'
  }
}

const fail = (code: FailureCode): never => {
  throw new DiagnosticFailure(code)
}

function failureResponse(code: FailureCode): NextResponse {
  const status =
    code === ALLOWED_FAILURES.invalid_request
      ? 400
      : code === ALLOWED_FAILURES.guild_not_found
        ? 404
        : code === ALLOWED_FAILURES.internal_error ||
            code === ALLOWED_FAILURES.landed_query_failed ||
            code === ALLOWED_FAILURES.diff_invariant_violated
          ? 500
          : 502
  // withErrorHandler rewrites non-2xx bodies lacking `{ error: { code, message } }`.
  return NextResponse.json({ error: { code, message: code } }, { status })
}

const KEY_COLUMNS =
  'Guild,Season,userId,encounterId,startedOn,completedOn,damageDealt,damageType'

const MATCHED_SAMPLE_SIZE = 10

export const GET = withAdminGuards(
  { guard: 'app-admin' },
  async (request: NextRequest) => {
    const params = request.nextUrl.searchParams
    const guildCode = (params.get('guild') ?? '').trim()
    const seasonRaw = (params.get('season') ?? '').trim()
    const season = Number(seasonRaw)

    if (
      !guildCode ||
      guildCode.length > 64 ||
      !/^\d+$/.test(seasonRaw) ||
      !Number.isSafeInteger(season) ||
      season <= 0
    ) {
      return failureResponse(ALLOWED_FAILURES.invalid_request)
    }

    try {
      const supabase = serviceDb()

      const { data: config, error: configError } = await supabase
        .from('guild_config')
        .select('guild_code,api_key_encrypted')
        .eq('guild_code', guildCode)
        .maybeSingle()

      if (configError || !config) fail(ALLOWED_FAILURES.guild_not_found)
      if (!config!.api_key_encrypted) fail(ALLOWED_FAILURES.guild_key_missing)

      // The decrypted key lives only in this local: never logged, returned or put in an error.
      let apiKey: string
      try {
        apiKey = await decryptApiKey(config!.api_key_encrypted as string)
      } catch {
        // Swallowed: a decrypt error can carry key/ciphertext detail.
        fail(ALLOWED_FAILURES.key_unavailable)
        throw new Error('unreachable')
      }

      const raw = await tacticusAPI.getGuildRaidBySeason(apiKey, season)
      if (!raw) fail(ALLOWED_FAILURES.upstream_unavailable)

      const entries = extractEntries(raw as unknown as GuildRaidApiResponse)

      // Mappings are empty on purpose: they feed only names, which must not be returned.
      let transformRejected = 0
      const upstream: RaidRowKey[] = []
      // Keyed by object identity, so identical key values stay distinct.
      const rawByKey = new Map<RaidRowKey, RawRaidEntry>()
      for (const entry of entries) {
        const processed = processRaidEntry(
          entry,
          guildCode,
          String(season),
          new Map<string, string>(),
          {},
          null,
          null
        )
        if (!processed) {
          transformRejected += 1
          continue
        }
        const key = toRaidRowKey(processed)
        upstream.push(key)
        rawByKey.set(key, entry)
      }

      const day = finalDayUtc(upstream)
      if (!day) fail(ALLOWED_FAILURES.season_unresolved)

      const upstreamFinalDay = upstream.filter((row) => isOnUtcDay(row, day!))

      const { data: landedRows, error: landedError } = await supabase
        .from('EOT_GR_data')
        .select(KEY_COLUMNS)
        .eq('Guild', guildCode)
        .eq('Season', String(season))
        .gte('completedOn', `${day}T00:00:00.000Z`)
        .lt('completedOn', `${day}T23:59:59.999Z`)

      if (landedError) fail(ALLOWED_FAILURES.landed_query_failed)

      const landed = (landedRows ?? []).map((row) =>
        toRaidRowKey(row as Record<string, unknown>)
      )

      const diff = diffRaidRows(upstreamFinalDay, landed)

      try {
        assertDiffInvariants(diff)
      } catch (invariantError) {
        logger.error(
          {
            guildCode,
            season,
            finalDayUtc: day,
            upstreamRowCount: diff.upstreamRowCount,
            landedRowCount: diff.landedRowCount,
            unmatchedCount: diff.unmatchedUpstreamRows.length,
            duplicateKeyGroupCount: diff.upstreamDuplicateKeyGroups.length,
            invariant:
              invariantError instanceof DiffInvariantViolation
                ? invariantError.message
                : 'unknown'
          },
          'Raid token diff produced an impossible result'
        )
        fail(ALLOWED_FAILURES.diff_invariant_violated)
      }

      // Counts only: no ids beyond the guild code, no payload, no key.
      logger.info(
        {
          guildCode,
          season,
          finalDayUtc: day,
          upstreamRowCount: diff.upstreamRowCount,
          landedRowCount: diff.landedRowCount,
          unmatchedCount: diff.unmatchedUpstreamRows.length,
          duplicateKeyGroupCount: diff.upstreamDuplicateKeyGroups.length,
          transformRejected
        },
        'Raid token diff complete'
      )

      const unmatchedDiscriminators: RawDiscriminators[] =
        diff.unmatchedUpstreamRows.map((row) =>
          classifyRawDiscriminators(rawByKey.get(row) as RawRaidEntry)
        )

      // Positive control: missing rows alone prove nothing.
      const unmatchedSet = new Set(diff.unmatchedUpstreamRows)
      const matchedFinalDay = upstreamFinalDay.filter(
        (row) => !unmatchedSet.has(row)
      )
      const matchedSample = matchedFinalDay.slice(0, MATCHED_SAMPLE_SIZE)
      const matchedSampleDiscriminators: RawDiscriminators[] =
        matchedSample.map((row) =>
          classifyRawDiscriminators(rawByKey.get(row) as RawRaidEntry)
        )

      return NextResponse.json({
        guildCode,
        season,
        finalDayUtc: day,
        transformRejected,
        ...diff,
        unmatchedDiscriminators,
        matchedSampleSize: matchedSample.length,
        matchedSampleDiscriminators
      })
    } catch (error) {
      const code =
        error instanceof DiagnosticFailure
          ? error.code
          : ALLOWED_FAILURES.internal_error
      // `code` only, never `err`.
      logger.warn({ guildCode, season, code }, 'Raid token diff failed')
      return failureResponse(code)
    }
  }
)
