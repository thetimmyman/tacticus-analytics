import playbooksCatalog from '@/data/boss-playbooks/playbooks.json'
import { stripGuildBossPrefix } from '@/app/lib/discord/formatters'
import { normalizeBossKey } from '@/app/lib/utils/bossNames'

type CatalogBoss = {
  id?: string
  tacticusTableIds?: {
    boss?: string
    prime1?: string
    prime2?: string
  }
}

function buildBossSlugLookup(): Map<string, string> {
  const catalog = playbooksCatalog as { bosses?: CatalogBoss[] }
  const lookup = new Map<string, string>()
  for (const boss of catalog.bosses ?? []) {
    if (typeof boss.id !== 'string') continue
    const slug = boss.id
    lookup.set(slug.toLowerCase().replace(/-/g, ''), slug)
    const ids = boss.tacticusTableIds ?? {}
    for (const raw of [ids.boss, ids.prime1, ids.prime2]) {
      const stripped = stripGuildBossPrefix(raw)
      if (stripped) lookup.set(stripped.toLowerCase(), slug)
    }
  }
  return lookup
}

const bossSlugLookup = buildBossSlugLookup()

export function buildHeraldCanonicalKey(bossId: string): string {
  const match = bossId.match(/^([A-Za-z][A-Za-z0-9]*)_E\d+$/)
  const bossType = match?.[1]
  if (!bossType) return ''

  const direct = bossSlugLookup.get(bossType.toLowerCase())
  if (direct) return normalizeBossKey(direct)

  // Post-rework `RW` suffix fallback.
  if (bossType.endsWith('RW')) {
    const rwBase = bossSlugLookup.get(bossType.slice(0, -2).toLowerCase())
    if (rwBase) return normalizeBossKey(rwBase)
  }

  return normalizeBossKey(bossType)
}
