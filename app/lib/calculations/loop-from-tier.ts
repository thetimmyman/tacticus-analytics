/** Tiers 4/5 are Loop 0, then +1 loop per 2 tiers. Non-throwing: bad input maps to 0. */
export function loopIndexFromTier(tier: number): number {
  if (!Number.isFinite(tier) || tier < 4) return 0
  return Math.floor((tier - 4) / 2)
}
