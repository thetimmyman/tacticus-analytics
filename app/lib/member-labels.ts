// Display-only labels for duplicate member names. The suffixed `display_name` is the join key
// for ~30 analytics RPCs, so it is never rewritten.

export interface DuplicateDisplayLabel {
  player_id: string
  display_name: string
  original_display_name: string | null
  previous_name: string | null
  friendly_label: string
}

/** Raw (suffixed) `display_name` → friendly label; only duplicates appear. */
export type MemberLabelMap = ReadonlyMap<string, string>

const EMPTY_LABEL_MAP: MemberLabelMap = new Map()

export function buildMemberLabelMap(
  rows: readonly DuplicateDisplayLabel[] | null | undefined
): MemberLabelMap {
  if (!rows || rows.length === 0) return EMPTY_LABEL_MAP
  const map = new Map<string, string>()
  for (const row of rows) {
    if (row?.display_name && row.friendly_label) {
      map.set(row.display_name, row.friendly_label)
    }
  }
  return map
}

export function resolveMemberLabel(
  displayName: string | null | undefined,
  labelMap: MemberLabelMap | null | undefined
): string {
  if (!displayName) return displayName ?? ''
  if (!labelMap) return displayName
  return labelMap.get(displayName) ?? displayName
}
