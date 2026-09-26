import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
export {
  ensureStringArray,
  isRecord,
  toNumber,
  toRecord,
  toStringSafe
} from '@/app/lib/utils/coerce'

// Resolves the name in a level-prefixed raw token ("L5 BelisariusRW"), keeping the prefix.
export const resolveLoopBossLabel = (label: string): string => {
  const m = label.match(/^([ML]\d+)\s+(.+)$/)
  return m ? `${m[1]} ${getBossDisplayName(m[2])}` : getBossDisplayName(label)
}

export const readRecordValue = (
  record: Record<string, unknown> | null,
  key: string
): unknown => (record ? record[key] : undefined)
