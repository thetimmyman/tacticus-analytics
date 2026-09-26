/** Uppercases and strips ALL whitespace: codes copied from Discord can contain inner spaces. */
export function normalizeInviteCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}
