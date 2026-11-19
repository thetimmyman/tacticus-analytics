import { allThemes, type GuildTheme } from '@/app/lib/themes/definitions'
import { getOnFillVariables } from '@/app/lib/utils/contrast'

/**
 * Themes the inline pre-hydration script can paint before React runs. Any
 * other stored theme starts from the dark base and is applied on hydration.
 */
export const FIRST_PAINT_THEME_CODES = [
  'dark',
  'light',
  'HORUS_HERESY'
] as const

export type FirstPaintThemeCode = (typeof FIRST_PAINT_THEME_CODES)[number]

/**
 * The variables that decide the first frame (page gradient, cards, text and
 * accents). Values come from the theme definitions and must equal what
 * `applyThemeToCSS` writes after hydration, so nothing shifts when React
 * attaches; tests/components/ThemeScript.test.tsx holds the two together.
 */
export function getFirstPaintVariables(
  theme: GuildTheme
): Record<string, string> {
  const overrides = theme.semanticOverrides
  const accent = overrides?.accent ?? theme.accent
  return {
    '--primary': theme.primary,
    '--secondary': theme.secondary,
    '--accent': accent,
    '--bg-from': theme.background.from,
    '--bg-via': theme.background.via,
    '--bg-to': theme.background.to,
    '--card-bg': theme.cardBg,
    '--card-border': theme.cardBorder,
    '--text-primary': overrides?.textPrimary ?? theme.text.primary,
    '--text-secondary': overrides?.textSecondary ?? theme.text.secondary,
    '--text-accent': overrides?.accent ?? theme.text.accent,
    '--bg-primary': theme.background.from,
    '--primary-wh40k': theme.primary,
    '--secondary-wh40k': theme.secondary,
    '--accent-wh40k': theme.accent,
    '--card': theme.cardBg,
    '--light': theme.cardBorder,
    ...getOnFillVariables({
      primary: theme.primary,
      secondary: theme.secondary,
      accent
    })
  }
}

export function getFirstPaintThemes(): Record<
  FirstPaintThemeCode,
  Record<string, string>
> {
  const entries = FIRST_PAINT_THEME_CODES.map((code) => {
    const theme = allThemes[code]
    if (!theme) throw new Error(`First-paint theme missing: ${code}`)
    return [code, getFirstPaintVariables(theme)] as const
  })
  return Object.fromEntries(entries) as Record<
    FirstPaintThemeCode,
    Record<string, string>
  >
}
