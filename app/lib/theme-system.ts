// Client logger: this module is imported by client providers, and the server
// logger chain pulls next/headers.
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('lib.theme-system')

export type { GuildTheme } from '@/app/lib/themes/definitions'
export {
  guildThemes,
  specialThemes,
  allThemes
} from '@/app/lib/themes/definitions'

import {
  type GuildTheme,
  guildThemes,
  specialThemes,
  allThemes
} from '@/app/lib/themes/definitions'

const FALLBACK_THEME = (() => {
  const fallback =
    specialThemes.dark ?? allThemes.light ?? Object.values(allThemes)[0]
  if (!fallback) {
    throw new Error('Theme data missing')
  }
  return fallback
})()

export function getGuildTheme(
  themeCode: string | null | undefined
): GuildTheme {
  if (!themeCode) {
    return FALLBACK_THEME
  }

  return allThemes[themeCode] ?? FALLBACK_THEME
}

export function isValidThemeCode(
  code: string | null | undefined
): code is string {
  if (!code) return false
  return code in allThemes
}

export function getAvailableThemes(
  profile?: { role: string; guild_code: string } | null
) {
  const basicThemes = [
    { code: 'light', name: 'Light Mode', category: 'basic' },
    { code: 'dark', name: 'Dark Mode', category: 'basic' }
  ]

  const specialThemeList = Object.entries(specialThemes)
    .filter(
      ([code]) => code !== 'light' && code !== 'dark' && code !== 'visitor'
    )
    .map(([code, theme]) => ({
      code,
      name: theme.name,
      category: 'special'
    }))

  const guildThemeList = Object.entries(guildThemes).map(([code, theme]) => ({
    code,
    name: theme.name,
    category: 'guild'
  }))

  const themes = [...basicThemes, ...specialThemeList, ...guildThemeList]

  const guildTheme = profile?.guild_code
    ? guildThemes[profile.guild_code]
    : null
  if (profile?.guild_code && guildTheme) {
    return [
      {
        code: 'guild',
        name: 'Guild Default (' + guildTheme.name + ')',
        category: 'guild'
      },
      ...themes
    ]
  }

  return themes
}

interface CachedTheme {
  theme: GuildTheme
  timestamp: number
}

const customThemeCache = new Map<string, CachedTheme>()
const CUSTOM_THEME_CACHE_TTL = 5 * 60 * 1000

export async function getGuildThemeClient(
  themeCode: string | null | undefined
): Promise<GuildTheme> {
  if (!themeCode) {
    return FALLBACK_THEME
  }

  const specialTheme = specialThemes[themeCode]
  if (specialTheme) {
    return specialTheme
  }

  const cached = customThemeCache.get(themeCode)
  if (cached && Date.now() - cached.timestamp < CUSTOM_THEME_CACHE_TTL) {
    return cached.theme
  }

  try {
    const { dbClient } = await import('@/app/lib/db/client')
    const supabase = dbClient()

    // guild_config may redirect to a `theme_preset`; guild_themes holds overrides for `themeCode` itself.
    const [guildConfigResult, customThemeResult] = await Promise.all([
      supabase
        .from('guild_config')
        .select('theme_preset')
        .eq('guild_code', themeCode)
        .maybeSingle(),
      supabase
        .from('guild_themes')
        .select('*')
        .eq('guild_code', themeCode)
        .maybeSingle()
    ])

    const guildConfig = guildConfigResult.data
    const { data: customTheme, error } = customThemeResult

    if (guildConfig?.theme_preset && guildConfig.theme_preset !== 'default') {
      if (guildConfig.theme_preset !== themeCode) {
        return getGuildThemeClient(guildConfig.theme_preset)
      }
    }

    if (
      error &&
      error.code !== 'PGRST116' &&
      !error.message?.includes('Row not found')
    ) {
      // Browser-visible log: raw PostgREST errors carry table names and RLS hints, so keep only the code.
      logger.error({ code: error.code ?? null }, 'Error loading guild theme')
    }

    if (customTheme) {
      const theme: GuildTheme = {
        ...getGuildTheme(themeCode),
        primary: customTheme.primary_color,
        secondary: customTheme.secondary_color,
        accent: customTheme.accent_color,
        background: {
          from: customTheme.bg_from,
          via: customTheme.bg_via,
          to: customTheme.bg_to
        },
        cardBg: customTheme.card_bg,
        cardBorder: customTheme.card_border,
        text: {
          primary: customTheme.text_primary,
          secondary: customTheme.text_secondary,
          accent: customTheme.text_accent
        }
      }

      customThemeCache.set(themeCode, {
        theme,
        timestamp: Date.now()
      })

      return theme
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    logger.error({ message }, 'Error loading custom theme')
  }

  return getGuildTheme(themeCode)
}

export function clearThemeCache(guildCode?: string) {
  if (guildCode) {
    customThemeCache.delete(guildCode)
  } else {
    customThemeCache.clear()
  }
}

/** "R G B" channels for Tailwind `<alpha-value>`: Tailwind drops opacity on
 * `bg-[var(--card-bg)]/N`. Falls back to white. */
function extractRgbChannels(color: string): string {
  if (!color) return '255 255 255'
  const trimmed = color.trim()
  if (
    trimmed.startsWith('#') &&
    (trimmed.length === 7 || trimmed.length === 4)
  ) {
    if (trimmed.length === 4) {
      const rHex = trimmed[1]
      const gHex = trimmed[2]
      const bHex = trimmed[3]
      if (!rHex || !gHex || !bHex) return '255 255 255'
      const r = parseInt(rHex + rHex, 16)
      const g = parseInt(gHex + gHex, 16)
      const b = parseInt(bHex + bHex, 16)
      return `${r} ${g} ${b}`
    }
    const r = parseInt(trimmed.slice(1, 3), 16)
    const g = parseInt(trimmed.slice(3, 5), 16)
    const b = parseInt(trimmed.slice(5, 7), 16)
    return `${r} ${g} ${b}`
  }
  const match = trimmed.match(/\d+(?:\.\d+)?/g)
  if (match && match.length >= 3) {
    const [r, g, b] = match
    if (r && g && b) {
      return `${parseInt(r, 10)} ${parseInt(g, 10)} ${parseInt(b, 10)}`
    }
  }
  return '255 255 255'
}

function extractCommaRgbChannels(color: string): string {
  return extractRgbChannels(color).replaceAll(' ', ', ')
}

function isLightBackground(bgColor: string): boolean {
  let r = 0,
    g = 0,
    b = 0

  if (bgColor.startsWith('#')) {
    r = parseInt(bgColor.slice(1, 3), 16)
    g = parseInt(bgColor.slice(3, 5), 16)
    b = parseInt(bgColor.slice(5, 7), 16)
  } else if (bgColor.startsWith('rgb')) {
    const match = bgColor.match(/\d+/g)
    if (match && match.length >= 3) {
      const [rValue, gValue, bValue] = match
      if (rValue && gValue && bValue) {
        r = parseInt(rValue, 10)
        g = parseInt(gValue, 10)
        b = parseInt(bValue, 10)
      }
    }
  }

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5
}

export function applyThemeToCSS(theme: GuildTheme) {
  if (typeof document === 'undefined') return

  const root = document.documentElement

  root.style.setProperty('--primary', theme.primary)
  root.style.setProperty('--secondary', theme.secondary)
  root.style.setProperty('--accent', theme.accent)

  root.style.setProperty('--bg-from', theme.background.from)
  root.style.setProperty('--bg-via', theme.background.via)
  root.style.setProperty('--bg-to', theme.background.to)

  root.style.setProperty('--card-bg', theme.cardBg)
  root.style.setProperty('--card-border', theme.cardBorder)
  root.style.setProperty('--card-bg-rgb', extractRgbChannels(theme.cardBg))
  root.style.setProperty(
    '--card-border-rgb',
    extractRgbChannels(theme.cardBorder)
  )
  root.style.setProperty('--accent-rgb', extractCommaRgbChannels(theme.accent))

  const bgColor = theme.background.via || theme.background.from
  let dropdownBg = theme.cardBg

  if (bgColor.startsWith('#')) {
    const r = parseInt(bgColor.slice(1, 3), 16)
    const g = parseInt(bgColor.slice(3, 5), 16)
    const b = parseInt(bgColor.slice(5, 7), 16)
    dropdownBg = `rgba(${r}, ${g}, ${b}, 0.98)`
  } else {
    dropdownBg = theme.cardBg.replace(/[\d.]+\)$/, '0.98)')
  }

  root.style.setProperty('--dropdown-bg', dropdownBg)

  root.style.setProperty('--text-primary', theme.text.primary)
  root.style.setProperty('--text-secondary', theme.text.secondary)
  root.style.setProperty('--text-accent', theme.text.accent)

  root.style.setProperty('--fx-psychic', theme.palette?.fxPsychic ?? '#59c1ff')
  root.style.setProperty('--fx-nurgle', theme.palette?.fxNurgle ?? '#88a347')
  root.style.setProperty('--fx-necron', theme.palette?.fxNecron ?? '#7af77a')
  root.style.setProperty('--fx-eldar', theme.palette?.fxEldar ?? '#ffb357')
  root.style.setProperty('--fx-smoke', theme.palette?.smoke ?? '#2b2b2b')
  root.style.setProperty('--fx-blood', theme.palette?.blood ?? '#6c2e2e')
  root.style.setProperty('--gutter-px', `${theme.post?.gutterPx ?? 4}px`)
  root.style.setProperty(
    '--story-vignette',
    String(theme.post?.vignette ?? 0.25)
  )
  root.style.setProperty('--story-grain', String(theme.post?.grain ?? 0.15))
  root.style.setProperty(
    '--story-grade-bias',
    theme.post?.gradeBias ?? 'neutral'
  )

  const isLightTheme = isLightBackground(bgColor)
  const interactionHoverBg = isLightTheme
    ? 'rgba(0, 0, 0, 0.06)'
    : 'rgba(255, 255, 255, 0.08)'

  root.style.setProperty('--bg-primary', theme.background.from)
  root.style.setProperty('--bg-secondary', theme.cardBg)
  root.style.setProperty('--bg-tertiary', interactionHoverBg)
  root.style.setProperty('--background', theme.background.from)
  root.style.setProperty('--border', theme.cardBorder)
  root.style.setProperty('--border-color', theme.cardBorder)
  root.style.setProperty('--border-primary', theme.cardBorder)
  root.style.setProperty('--card', theme.cardBg)
  root.style.setProperty('--light', theme.cardBorder)
  root.style.setProperty('--surface', theme.cardBg)
  root.style.setProperty('--surface-raised', theme.cardBg)
  root.style.setProperty('--card-hover', interactionHoverBg)
  root.style.setProperty('--card-bg-hover', interactionHoverBg)
  root.style.setProperty('--card-header', theme.cardBg)
  root.style.setProperty(
    '--card-hover-rgb',
    extractCommaRgbChannels(theme.cardBg)
  )
  root.style.setProperty('--card-border-hover', theme.accent)
  root.style.setProperty('--accent-primary', theme.accent)
  root.style.setProperty('--accent-hover', theme.primary)
  root.style.setProperty('--accent-foreground', '#ffffff')
  root.style.setProperty('--primary-wh40k', theme.primary)
  root.style.setProperty('--secondary-wh40k', theme.secondary)
  root.style.setProperty('--accent-wh40k', theme.accent)
  root.style.setProperty('--text-muted', theme.text.secondary)
  root.style.setProperty('--portrait-width', '6rem')
  root.style.setProperty('--portrait-width-medium', '4rem')

  const overrides = theme.semanticOverrides

  const dangerDefault = '#ff6b6b'
  const warningDefault = '#fbbf24'
  const successDefault = '#4ade80'
  const infoDefault = '#0ea5e9'

  const dangerValue = overrides?.danger ?? dangerDefault
  const warningValue = overrides?.warning ?? warningDefault
  const successValue = overrides?.success ?? successDefault
  const infoValue = overrides?.info ?? infoDefault

  if (isLightTheme) {
    root.style.setProperty('--hover-bg', 'rgba(0, 0, 0, 0.05)')
    root.style.setProperty('--input-bg', '#ffffff')
    root.style.setProperty('--input-text', '#1f2937')
    root.style.setProperty('--input-border', '#d1d5db')
    root.style.setProperty('--dropdown-bg-solid', '#ffffff')
    root.style.setProperty(
      '--select-arrow',
      "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%233b82f6' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")"
    )
    // yellow-400/sky-500 fail contrast on white cardBg.
    root.style.setProperty('--warning', overrides?.warning ?? '#ca8a04')
    root.style.setProperty('--warning-text', overrides?.warning ?? '#854d0e')
    root.style.setProperty('--info', overrides?.info ?? '#0369a1')
  } else {
    root.style.setProperty('--hover-bg', 'rgba(255, 255, 255, 0.05)')
    root.style.setProperty('--input-bg', 'rgba(30, 41, 59, 0.9)')
    root.style.setProperty('--input-text', '#f3f4f6')
    root.style.setProperty('--input-border', 'rgba(71, 85, 105, 0.6)')
    root.style.setProperty(
      '--dropdown-bg-solid',
      theme.background.via || theme.background.from
    )
    root.style.setProperty(
      '--select-arrow',
      "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2393c5fd' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")"
    )
    root.style.setProperty('--warning', warningValue)
    root.style.setProperty('--warning-text', warningValue)
    root.style.setProperty('--info', infoValue)
  }

  root.style.setProperty('--warning-bg', 'rgba(251, 191, 36, 0.2)')
  root.style.setProperty('--warning-border', 'rgba(251, 191, 36, 0.3)')
  root.style.setProperty('--success', successValue)
  root.style.setProperty('--success-bg', 'rgba(74, 222, 128, 0.2)')
  root.style.setProperty('--success-border', 'rgba(74, 222, 128, 0.3)')
  root.style.setProperty('--danger', dangerValue)
  root.style.setProperty('--error', dangerValue)
  root.style.setProperty('--error-bg', 'rgba(255, 107, 107, 0.2)')
  root.style.setProperty('--error-border', 'rgba(255, 107, 107, 0.3)')
  root.style.setProperty('--info-bg', 'rgba(14, 165, 233, 0.2)')
  root.style.setProperty('--info-border', 'rgba(14, 165, 233, 0.3)')

  if (overrides?.textPrimary)
    root.style.setProperty('--text-primary', overrides.textPrimary)
  if (overrides?.textSecondary)
    root.style.setProperty('--text-secondary', overrides.textSecondary)
  if (overrides?.accent) {
    root.style.setProperty('--accent', overrides.accent)
    root.style.setProperty('--text-accent', overrides.accent)
  }
}
