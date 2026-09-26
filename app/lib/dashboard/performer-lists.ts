export interface PerformerEntry {
  name: string
  vsGuildPct: number
  rank: number
}

export interface PerformerSource {
  name: string
  vsGuildPct: number
}

/** Bottom is empty for <= 5 players, else it repeats the top list. */
export function buildTopBottomPerformers(
  sortedByVsGuildDesc: ReadonlyArray<PerformerSource>
): { topPerformers: PerformerEntry[]; bottomPerformers: PerformerEntry[] } {
  const topPerformers = sortedByVsGuildDesc.slice(0, 5).map((p, idx) => ({
    name: p.name,
    vsGuildPct: p.vsGuildPct,
    rank: idx + 1
  }))

  const bottomPerformers =
    sortedByVsGuildDesc.length > 5
      ? sortedByVsGuildDesc.slice(-5).map((p, idx) => ({
          name: p.name,
          vsGuildPct: p.vsGuildPct,
          rank: sortedByVsGuildDesc.length - 5 + idx + 1
        }))
      : []

  return { topPerformers, bottomPerformers }
}
