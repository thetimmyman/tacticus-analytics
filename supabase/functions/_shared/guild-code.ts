const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeGuildCode(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return UUID_PATTERN.test(trimmed)
    ? trimmed.toLowerCase()
    : trimmed.toUpperCase()
}

export function guildCodesEqual(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeGuildCode(left)
  const normalizedRight = normalizeGuildCode(right)
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight
}
