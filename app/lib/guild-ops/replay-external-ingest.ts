/**
 * Scrapes live: the committed snapshot is not in the production image. Catalogs are
 * static imports because the Next.js bundle has no data/ on disk.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import playbooks from '@/data/boss-playbooks/playbooks.json'
import seasonLineups from '@/data/loki-api/season-lineups.json'
import globalConfig from '@/data/loki-api/GlobalConfig.json'
import {
  EXTERNAL_SNAPSHOT_USER_AGENT,
  TERMINUS_REPLAY_LIBRARY_URL,
  buildExternalNormalizationContext,
  buildExternalPublishTags,
  extractTerminusReplayLibrary,
  extractYouTubeVideoId,
  isPublishReadyCandidate,
  normalizeTerminusReplay,
  type ExternalReplayCandidate
} from '@/app/lib/guild-ops/replay-external-sources'

const CHUNK = 100

export interface ExternalIngestOptions {
  apply: boolean
  publishClean: boolean
  visibility: 'public' | 'cluster'
  limit?: number | null
}

export interface ExternalIngestSummary {
  candidates: number
  alreadyQueued: number
  newCandidates: number
  publishable: number
  stageOnly: number
  withoutVideoId: number
  repairable: number
  promotable: number
  staged: number
  published: number
  promoted: number
  repaired: number
  applied: boolean
}

const chunked = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

const candidateSortKey = (candidate: ExternalReplayCandidate): string =>
  `tm:${candidate.externalVideoId ?? candidate.videoUrl}`

export async function fetchTerminusCandidates(options?: {
  url?: string
  html?: string
}): Promise<ExternalReplayCandidate[]> {
  const ctx = buildExternalNormalizationContext({
    playbooks: playbooks as {
      bosses: Array<{ id: string; boards?: string[] }>
    },
    seasonLineups: seasonLineups as Record<string, unknown>,
    globalConfig: globalConfig as Record<string, unknown>
  })

  let html = options?.html
  if (html === undefined) {
    const url = options?.url ?? TERMINUS_REPLAY_LIBRARY_URL
    const response = await fetch(url, {
      headers: { 'User-Agent': EXTERNAL_SNAPSHOT_USER_AGENT }
    })
    if (!response.ok) {
      throw new Error(`GET ${url} failed with HTTP ${response.status}`)
    }
    html = await response.text()
  }

  const library = extractTerminusReplayLibrary(html)
  return library.replays
    .map((record) => normalizeTerminusReplay(record, ctx))
    .sort((a, b) => candidateSortKey(a).localeCompare(candidateSortKey(b)))
}

interface QueuedRow {
  id: string
  review_status: string
  published_replay_id: string | null
  /** Promotion falls back to this when re-normalizing an old replay loses the resolution. */
  boss_id: string | null
  board_id: string | null
}

interface ExistingState {
  queueByVideoId: Map<string, QueuedRow>
  publishedIdByVideoId: Map<string, string>
}

async function loadExistingState(
  db: SupabaseClient,
  candidates: ExternalReplayCandidate[]
): Promise<ExistingState> {
  const videoIds = candidates
    .map((candidate) => candidate.externalVideoId)
    .filter((id): id is string => Boolean(id))
  // A queue row for the same video under any source blocks re-staging.
  const queueByVideoId = new Map<string, QueuedRow>()
  for (const chunk of chunked(videoIds, CHUNK)) {
    const { data, error } = await db
      .from('replay_ingest_queue')
      .select(
        'id, external_video_id, review_status, published_replay_id, boss_id, board_id'
      )
      .in('external_video_id', chunk)
    if (error) throw new Error(`queue lookup failed: ${error.message}`)
    for (const row of data ?? []) {
      if (row.external_video_id) {
        queueByVideoId.set(row.external_video_id as string, {
          id: row.id as string,
          review_status: row.review_status as string,
          published_replay_id: row.published_replay_id as string | null,
          boss_id: (row.boss_id as string | null) ?? null,
          board_id: (row.board_id as string | null) ?? null
        })
      }
    }
  }

  // Keyed by video id, not URL: one video appears under several URL shapes.
  const publishedIdByVideoId = new Map<string, string>()
  const { data: publishedRows, error: publishedError } = await db
    .from('boss_playbook_replays')
    .select('id, video_url')
    .eq('video_type', 'youtube')
  if (publishedError) {
    throw new Error(`published lookup failed: ${publishedError.message}`)
  }
  for (const row of publishedRows ?? []) {
    const videoId = extractYouTubeVideoId(row.video_url as string | null)
    if (videoId && !publishedIdByVideoId.has(videoId)) {
      publishedIdByVideoId.set(videoId, row.id as string)
    }
  }

  return { queueByVideoId, publishedIdByVideoId }
}

async function loadMetaTeamIds(
  db: SupabaseClient
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from('meta_teams')
    .select('id, team_name')
    .eq('is_meta', true)
  if (error) throw new Error(`meta_teams lookup failed: ${error.message}`)
  return new Map(
    (data ?? []).map((row) => [row.team_name as string, row.id as string])
  )
}

function buildQueueRow(
  candidate: ExternalReplayCandidate,
  metaTeamIds: Map<string, string>
) {
  const metaTeamId = candidate.metaTeamName
    ? (metaTeamIds.get(candidate.metaTeamName) ?? null)
    : null
  return {
    source_system: candidate.sourceSystem,
    external_video_id: candidate.externalVideoId,
    raw_video_url: candidate.videoUrl,
    media_status: 'external',
    review_status: 'needs_review',
    boss: candidate.bossId ?? null,
    boss_id: candidate.bossId,
    board_id: candidate.boardId,
    map_id: candidate.mapNumber,
    encounter_role: candidate.encounterRole,
    season: candidate.season,
    tier: candidate.tier,
    damage: candidate.damage,
    units: candidate.units,
    meta_team_ids: metaTeamId ? [metaTeamId] : null,
    suggested_title: candidate.title,
    source_author: candidate.creator,
    posted_at: candidate.publishedAt,
    parse_flags: { missing: candidate.parseFlags.missing }
  }
}

/** A fresh resolution always wins over the stored one. */
function recoverStoredResolution(
  candidate: ExternalReplayCandidate,
  existing: ExistingState
): ExternalReplayCandidate {
  const queueRow = existing.queueByVideoId.get(candidate.externalVideoId!)
  if (!queueRow) return candidate
  if (candidate.bossId || !queueRow.boss_id) return candidate
  return {
    ...candidate,
    bossId: queueRow.boss_id,
    boardId: candidate.boardId ?? queueRow.board_id
  }
}

/** Idempotent. */
export async function ingestExternalReplays(
  db: SupabaseClient,
  allCandidates: ExternalReplayCandidate[],
  options: ExternalIngestOptions
): Promise<ExternalIngestSummary> {
  const candidates = options.limit
    ? allCandidates.slice(0, options.limit)
    : allCandidates

  const withVideoId = candidates.filter((c) => c.externalVideoId)
  const withoutVideoId = candidates.length - withVideoId.length

  const [existing, metaTeamIds] = await Promise.all([
    loadExistingState(db, withVideoId),
    loadMetaTeamIds(db)
  ])

  const newCandidates = withVideoId.filter(
    (candidate) =>
      !existing.queueByVideoId.has(candidate.externalVideoId!) &&
      !existing.publishedIdByVideoId.has(candidate.externalVideoId!)
  )
  const publishable = options.publishClean
    ? newCandidates.filter(isPublishReadyCandidate)
    : []
  const publishableSet = new Set(publishable)
  const stageOnly = newCandidates.filter((c) => !publishableSet.has(c))

  // A run that died between publish and queue mark leaves a published needs_review row; link it.
  const repairable = withVideoId.filter((candidate) => {
    const queueRow = existing.queueByVideoId.get(candidate.externalVideoId!)
    return (
      queueRow &&
      queueRow.review_status === 'needs_review' &&
      !queueRow.published_replay_id &&
      existing.publishedIdByVideoId.has(candidate.externalVideoId!)
    )
  })

  // Without this, queued rows that now pass the gate stay needs_review forever.
  const promotable = options.publishClean
    ? withVideoId
        .filter((candidate) => {
          const queueRow = existing.queueByVideoId.get(
            candidate.externalVideoId!
          )
          return (
            queueRow &&
            queueRow.review_status === 'needs_review' &&
            !queueRow.published_replay_id &&
            !existing.publishedIdByVideoId.has(candidate.externalVideoId!)
          )
        })
        .map((candidate) => recoverStoredResolution(candidate, existing))
        .filter(isPublishReadyCandidate)
    : []

  const summary: ExternalIngestSummary = {
    candidates: candidates.length,
    alreadyQueued: existing.queueByVideoId.size,
    newCandidates: newCandidates.length,
    publishable: publishable.length,
    stageOnly: stageOnly.length,
    withoutVideoId,
    repairable: repairable.length,
    promotable: promotable.length,
    staged: 0,
    published: 0,
    promoted: 0,
    repaired: 0,
    applied: options.apply
  }

  if (!options.apply) return summary

  for (const candidate of repairable) {
    const publishedId = existing.publishedIdByVideoId.get(
      candidate.externalVideoId!
    )!
    const { error } = await db
      .from('replay_ingest_queue')
      .update({
        review_status: 'approved',
        published_replay_id: publishedId,
        reviewed_at: new Date().toISOString()
      })
      .eq('source_system', candidate.sourceSystem)
      .eq('external_video_id', candidate.externalVideoId!)
      .eq('review_status', 'needs_review')
    if (error) {
      throw new Error(
        `repair failed for ${candidate.externalVideoId}: ${error.message}`
      )
    }
    summary.repaired += 1
  }

  for (const chunk of chunked(stageOnly, CHUNK)) {
    const { error } = await db.from('replay_ingest_queue').upsert(
      chunk.map((candidate) => buildQueueRow(candidate, metaTeamIds)),
      { onConflict: 'source_system,external_video_id', ignoreDuplicates: true }
    )
    if (error) throw new Error(`queue upsert failed: ${error.message}`)
    summary.staged += chunk.length
  }

  const promotedSet = new Set(promotable)
  for (const candidate of [...publishable, ...promotable]) {
    const metaTeamId = candidate.metaTeamName
      ? (metaTeamIds.get(candidate.metaTeamName) ?? null)
      : null

    // Provenance row first, so a crash after publish is fixed by the repair pass.
    const { error: stageError } = await db
      .from('replay_ingest_queue')
      .upsert(buildQueueRow(candidate, metaTeamIds), {
        onConflict: 'source_system,external_video_id',
        ignoreDuplicates: true
      })
    if (stageError) {
      throw new Error(
        `queue stage failed for ${candidate.externalVideoId}: ${stageError.message}`
      )
    }

    const { data: publishedRow, error: publishError } = await db
      .from('boss_playbook_replays')
      .insert({
        boss_id: candidate.bossId!,
        title: candidate.title,
        video_type: 'youtube',
        video_url: candidate.videoUrl,
        season: candidate.season,
        map_id: candidate.boardId,
        encounter_role: candidate.encounterRole,
        // Both columns get the tier code so they cannot drift.
        difficulty: candidate.tier,
        rarity_set: candidate.tier,
        damage: candidate.damage,
        units: candidate.units,
        featured_for_season: false,
        meta_team_ids: metaTeamId ? [metaTeamId] : null,
        meta_team_id: metaTeamId,
        visibility: options.visibility,
        cluster_code: 'EOT',
        guild_code: null,
        contributor_id: null,
        source_system: candidate.sourceSystem,
        source_creator: candidate.creator,
        source_published_at: candidate.publishedAt,
        tags: buildExternalPublishTags(
          candidate.sourceSystem,
          candidate.encounterRole
        )
      })
      .select('id')
      .single()
    if (publishError) {
      throw new Error(
        `publish failed for ${candidate.externalVideoId}: ${publishError.message}`
      )
    }

    const { error: queueError } = await db
      .from('replay_ingest_queue')
      .update({
        review_status: 'approved',
        published_replay_id: publishedRow.id,
        reviewed_at: new Date().toISOString()
      })
      .eq('source_system', candidate.sourceSystem)
      .eq('external_video_id', candidate.externalVideoId!)
    if (queueError) {
      throw new Error(
        `queue mark-approved failed for ${candidate.externalVideoId}: ${queueError.message}`
      )
    }
    if (promotedSet.has(candidate)) summary.promoted += 1
    else summary.published += 1
  }

  return summary
}
