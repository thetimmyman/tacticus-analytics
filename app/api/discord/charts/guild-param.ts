const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeGuildParam(value: string | null): string {
  const trimmed = value?.trim() ?? ''
  return UUID_PATTERN.test(trimmed)
    ? trimmed.toLowerCase()
    : trimmed.toUpperCase()
}
