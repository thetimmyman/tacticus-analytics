import manifestJson from '@/public/images/bosses/portrait-manifest.json'

export type BossPortraitVariant = 'portraits' | 'icons' | 'thumbnails'

export interface BossPortraitManifest {
  bySlug: Record<string, Record<BossPortraitVariant, string>>
  byBase: Record<string, { variants: string[]; default: string }>
  byAlias: Record<string, string | string[]>
  slugToBase: Record<string, string>
}

export const bossPortraitManifest = manifestJson as BossPortraitManifest
