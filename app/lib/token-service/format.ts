export function formatCooldownWithSeconds(
  seconds: number | null
): string | null {
  if (seconds === null || seconds <= 0) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = Math.floor(seconds % 60)
  if (hours === 0 && minutes === 0) return `${remainder}s`
  if (hours === 0) return `${minutes}m ${remainder}s`
  return `${hours}h ${minutes}m ${remainder}s`
}
