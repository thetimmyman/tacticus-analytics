import { db } from '@/app/lib/db'
import { getCurrentBossStatusWithLifecycle } from '@/app/lib/data/boss-status'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('briefing.since-last-visit')

export interface BriefingDelta {
  kind: 'announcement' | 'raid_advanced'
  label: string
  href?: string
}

export interface SinceLastVisit {
  isFirstVisit: boolean
  snapshotAtIso: string
  deltas: BriefingDelta[]
}

interface LoadArgs {
  userId: string
  guildCode: string | undefined
  season: string
  nowMs?: number
}

type BriefingStateUpsertClient = {
  from(table: string): {
    upsert(
      values: Record<string, string>,
      options: { onConflict: string; ignoreDuplicates: boolean }
    ): PromiseLike<{ error: { message?: string } | null }>
  }
}

/**
 * Without a seeded row the feature never fires. Never backdated; `ignoreDuplicates`
 * stops concurrent loads rolling back an advanced cutoff.
 */
async function seedBaselineCutoff(
  sb: BriefingStateUpsertClient,
  userId: string,
  guildCode: string,
  snapshotAtIso: string
): Promise<void> {
  const { error } = await sb.from('user_briefing_state').upsert(
    {
      user_id: userId,
      guild_code: guildCode,
      previous_cutoff_at: snapshotAtIso,
      updated_at: snapshotAtIso
    },
    { onConflict: 'user_id,guild_code', ignoreDuplicates: true }
  )
  if (error) {
    logger.warn(
      {
        error:
          error instanceof Error
            ? error.message
            : String(error?.message ?? error)
      },
      'since-last-visit baseline seed failed'
    )
  }
}

export async function loadSinceLastVisit(
  args: LoadArgs
): Promise<SinceLastVisit> {
  const nowMs = args.nowMs ?? Date.now()
  const snapshotAtIso = new Date(nowMs).toISOString()
  const empty: SinceLastVisit = {
    isFirstVisit: true,
    snapshotAtIso,
    deltas: []
  }
  if (!args.guildCode) return empty

  try {
    const sb = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAny = sb as any
    const { data: stateRow } = await sbAny
      .from('user_briefing_state')
      .select('previous_cutoff_at')
      .eq('user_id', args.userId)
      .eq('guild_code', args.guildCode)
      .maybeSingle()

    const cutoff: string | null = stateRow?.previous_cutoff_at ?? null
    if (!cutoff) {
      await seedBaselineCutoff(
        sbAny,
        args.userId,
        args.guildCode,
        snapshotAtIso
      )
      return empty
    }

    const deltas: BriefingDelta[] = []

    try {
      const { count } = await sb
        .from('carousel_items')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .gt('created_at', cutoff)
        .lte('created_at', snapshotAtIso)
      if (count && count > 0) {
        deltas.push({
          kind: 'announcement',
          label: `${count} new announcement${count === 1 ? '' : 's'}`
        })
      }
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'announcement delta failed'
      )
    }

    try {
      const bossRows = await getCurrentBossStatusWithLifecycle(
        args.guildCode,
        args.season
      )
      const cleared = bossRows.filter(
        (r) => r.completed_on && r.completed_on > cutoff
      ).length
      if (cleared > 0) {
        deltas.push({
          kind: 'raid_advanced',
          label: `Raid advanced — ${cleared} encounter${cleared === 1 ? '' : 's'} cleared`,
          href: '/boss-playbooks'
        })
      }
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'raid-advanced delta failed'
      )
    }

    return { isFirstVisit: false, snapshotAtIso, deltas }
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'since-last-visit load failed'
    )
    return empty
  }
}
