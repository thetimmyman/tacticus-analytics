import { normalizeIdentifier } from '@/app/lib/utils/normalize'

export type HeroMapping = {
  unit_id: string
  display_name: string
  web_icon_url: string | null
}

export const normalizeHeroKey = normalizeIdentifier

export const resolveHeroMapping = (
  value: string | null | undefined,
  heroMappings: Map<string, HeroMapping>
): HeroMapping | null => {
  if (!value) return null
  const raw = value.trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  const normalized = normalizeHeroKey(raw)
  const direct =
    heroMappings.get(raw) ||
    heroMappings.get(lower) ||
    heroMappings.get(normalized)
  if (!direct) return null
  const unitId = direct.unit_id?.trim()
  if (!unitId) return direct
  return (
    heroMappings.get(unitId) ||
    heroMappings.get(unitId.toLowerCase()) ||
    heroMappings.get(normalizeHeroKey(unitId)) ||
    direct
  )
}
