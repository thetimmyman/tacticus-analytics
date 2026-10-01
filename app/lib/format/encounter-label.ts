import { isMainBossEncounter } from '@/app/lib/config'

export type EncounterLabelStyle = 'plain' | 'parens' | 'dot' | 'short'

export function formatEncounterLabel(
  encounterId: number,
  style: EncounterLabelStyle = 'plain'
): string {
  const isMain = isMainBossEncounter(encounterId)
  switch (style) {
    case 'parens':
      return isMain ? '' : ` (Prime ${encounterId})`
    case 'dot':
      return isMain ? ' · Main' : ` · Prime ${encounterId}`
    case 'short':
      return isMain ? '' : ` · P${encounterId}`
    case 'plain':
    default:
      return isMain ? 'Main' : `Prime ${encounterId}`
  }
}
