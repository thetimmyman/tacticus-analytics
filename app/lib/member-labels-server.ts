import 'server-only'

import { serviceDb } from '@/app/lib/db'
import {
  buildMemberLabelMap,
  resolveMemberLabel,
  type DuplicateDisplayLabel,
  type MemberLabelMap
} from '@/app/lib/member-labels'

// The TTL cache turns a burst of Discord formatting into one query.
const CACHE_TTL_MS = 60_000
let cached: { map: MemberLabelMap; at: number } | null = null
let inflight: Promise<MemberLabelMap> | null = null

async function fetchMemberLabelMap(): Promise<MemberLabelMap> {
  const supabase = serviceDb()
  const { data, error } = await supabase.rpc('get_duplicate_display_labels', {})
  if (error) throw error
  return buildMemberLabelMap(data as DuplicateDisplayLabel[] | null)
}

/** Never throws: on error returns the last cached map, else an empty one. */
export async function getMemberLabelMap(): Promise<MemberLabelMap> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.map
  if (inflight) return inflight

  inflight = fetchMemberLabelMap()
    .then((map) => {
      cached = { map, at: Date.now() }
      return map
    })
    .catch(() => cached?.map ?? (new Map() as MemberLabelMap))
    .finally(() => {
      inflight = null
    })

  return inflight
}

export async function labelForMember(
  displayName: string | null | undefined
): Promise<string> {
  if (!displayName) return displayName ?? ''
  const map = await getMemberLabelMap()
  return resolveMemberLabel(displayName, map)
}
