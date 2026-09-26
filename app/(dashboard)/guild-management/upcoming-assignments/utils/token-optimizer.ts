/** Shared types and primary/secondary conversion; auto-assignment lives in solver-core. */
export interface PlayerTokenAllocation {
  player_id: string
  display_name: string
  allocations: Record<string, number>
  totalTokensUsed: number
}

export function convertToPrimarySecondary(
  allocations: PlayerTokenAllocation[],
  primaryValue: number,
  secondaryValue: number
) {
  return allocations.map((playerAlloc) => {
    const sorted = Object.entries(playerAlloc.allocations).sort(
      (a, b) => b[1] - a[1]
    )

    let primary = null
    let secondary = null

    for (const [boss, tokens] of sorted) {
      if (!primary && tokens >= primaryValue) {
        primary = boss
      } else if (!secondary && tokens >= secondaryValue) {
        secondary = boss
      }
    }

    if (!primary && sorted.length > 0) {
      const first = sorted[0]
      if (first) primary = first[0]
    }
    if (!secondary && sorted.length > 1) {
      const second = sorted[1]
      if (second) secondary = second[0]
    }

    return {
      player_id: playerAlloc.player_id,
      display_name: playerAlloc.display_name,
      primary_boss: primary,
      secondary_boss: secondary,
      token_allocations: playerAlloc.allocations
    }
  })
}
