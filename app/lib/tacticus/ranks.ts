export const RANK_NAMES = [
  'Stone I',
  'Stone II',
  'Stone III',
  'Iron I',
  'Iron II',
  'Iron III',
  'Bronze I',
  'Bronze II',
  'Bronze III',
  'Silver I',
  'Silver II',
  'Silver III',
  'Gold I',
  'Gold II',
  'Gold III',
  'Diamond I',
  'Diamond II',
  'Diamond III',
  'Adamantium I',
  'Adamantium II',
  'Adamantium III',
  'Mythic I',
  'Mythic II',
  'Mythic III'
]

export const RANK_OPTIONS = RANK_NAMES.map((label, index) => ({ label, index }))
export const RANK_SELECT_OPTIONS = RANK_NAMES.map((name, index) => ({
  name,
  index
}))

const RANK_NAME_TO_INDEX = new Map(
  RANK_NAMES.map((name, index) => [name, index])
)

export const getRankName = (rank: number): string =>
  RANK_NAMES[rank] || `Rank ${rank}`

export const resolveRankName = (
  rank: number | null | undefined
): string | null => (rank != null ? (RANK_NAMES[rank] ?? null) : null)

export const getRankIndexFromName = (rankName: unknown): number | null =>
  typeof rankName === 'string'
    ? (RANK_NAME_TO_INDEX.get(rankName) ?? null)
    : null
