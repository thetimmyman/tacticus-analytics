// normalizeBossName deliberately skips normalizeBossKey's variant/alias collapsing.
import { stripNonAlnumLower } from '@/app/lib/resolvers/boss-identity'

export function normalizeText(value?: string | null): string {
  return value ? String(value).trim().toLowerCase() : ''
}

export function normalizeDisplayName(name?: string | null): string {
  return normalizeText(name)
}

export function normalizeToUpper(value?: string | null): string {
  return value ? String(value).trim().toUpperCase() : ''
}

export function normalizeGuild(value?: string | null): string {
  return normalizeToUpper(value)
}

export function normalizeBossName(value?: string | null): string {
  return stripNonAlnumLower(value)
}

export function normalizeBossType(input?: string | null): string {
  return normalizeBossName(input)
}

/** Also true when one normalized name is a prefix of the other. */
export function bossNamesMatch(
  name1?: string | null,
  name2?: string | null
): boolean {
  const n1 = normalizeBossName(name1)
  const n2 = normalizeBossName(name2)
  if (!n1 || !n2) return false
  return n1 === n2 || n1.startsWith(n2) || n2.startsWith(n1)
}

export function normalizeIdentifier(value?: string | null): string {
  return stripNonAlnumLower(value)
}
