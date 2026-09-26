export type StabilityRank = 'High' | 'Medium' | 'Low'

export const getStabilityColor = (rank: StabilityRank): string => {
  switch (rank) {
    case 'High':
      return 'text-green-400'
    case 'Medium':
      return 'text-[var(--primary)]'
    case 'Low':
      return 'text-[var(--accent)]'
  }
}

export const getStabilityBgColor = (rank: StabilityRank): string => {
  switch (rank) {
    case 'High':
      return 'bg-green-600/20'
    case 'Medium':
      return 'bg-[color-mix(in_srgb,var(--primary)_20%,transparent)]'
    case 'Low':
      return 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]'
  }
}
