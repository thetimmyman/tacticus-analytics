export function calculateDamagePercentage(
  damage: number,
  avgDamage: number | null | undefined
): number | null {
  if (!avgDamage || avgDamage <= 0 || damage <= 0) return null
  return ((damage - avgDamage) / avgDamage) * 100
}

export function formatDamagePercentage(percentage: number | null): string {
  if (percentage === null) return '--'
  const sign = percentage >= 0 ? '+' : ''
  return `${sign}${percentage.toFixed(0)}%`
}

export function getDamagePercentageColor(percentage: number | null): string {
  if (percentage === null) return 'text-(--text-tertiary)'
  if (percentage >= 20) return 'text-green-400'
  if (percentage >= 0) return 'text-green-300/80'
  if (percentage >= -20) return 'text-yellow-400'
  return 'text-red-400'
}
