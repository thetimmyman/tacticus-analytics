'use client'

import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import {
  GuildTheme,
  getAvailableThemes,
  getGuildThemeClient,
  applyThemeToCSS
} from '@/app/lib/theme-system'
import type { PlayerMapping } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.ThemeProvider')
import { generateContrastVariables } from '@/app/lib/utils/contrast'
import { useLocalStorage } from '@/app/lib/hooks/useLocalStorage'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'

interface ThemeContextType {
  theme: GuildTheme
  guildCode: string
  currentThemeCode: string
  setGuildCode: (code: string) => void
  setTheme: (code: string) => Promise<{ success: boolean; error?: string }>
  availableThemes: Array<{ code: string; name: string; category: string }>
  resetToGuildTheme: () => Promise<{ success: boolean; error?: string }>
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

// SSR fallback when context is unavailable.
const SSR_FALLBACK = {
  theme: { primary: '#ef4444', secondary: '#dc2626', accent: '#b91c1c' },
  guildCode: '',
  currentThemeCode: '',
  setGuildCode: () => {},
  setTheme: async () => ({ success: false, error: 'SSR fallback' }),
  availableThemes: [],
  resetToGuildTheme: async () => ({ success: false, error: 'SSR fallback' })
} as const

async function updateThemePreference(userId: string, themePreference: string) {
  const { dbClient } = await import('@/app/lib/db/client')
  return dbClient()
    .from(CURRENT_USER_PLAYER_MAPPING)
    .update({ theme_preference: themePreference })
    .eq('user_id', userId)
    .eq('is_current', true)
}

export function useTheme() {
  const context = useContext(ThemeContext)

  if (!context) {
    return SSR_FALLBACK
  }
  return context
}

interface ThemeProviderProps {
  children: React.ReactNode
  initialGuild?: string
  selectedGuild?: string
  profile?: PlayerMapping | null
}

export function ThemeProvider({
  children,
  initialGuild = 'dark',
  selectedGuild,
  profile
}: ThemeProviderProps) {
  const effectiveGuild = selectedGuild || profile?.guild_code || initialGuild

  const initialTheme = useMemo(() => {
    if (profile?.theme_preference && profile.theme_preference !== 'guild') {
      return profile.theme_preference
    }
    return effectiveGuild
  }, [profile, effectiveGuild])

  const [themeOverride, setThemeOverride, isHydrated] = useLocalStorage<
    string | null
  >('theme-override', null)

  const [theme, setThemeState] = useState<GuildTheme | null>(null)

  const profileForThemes = profile
    ? { role: profile.role ?? '', guild_code: profile.guild_code ?? '' }
    : null
  const availableThemes = getAvailableThemes(profileForThemes).map((theme) => ({
    ...theme,
    name: theme.name
  }))

  const currentThemeCode = useMemo(() => {
    if (!isHydrated) {
      return initialTheme
    }

    // The override is the most recent user choice, so it wins.
    if (themeOverride) {
      return themeOverride
    }

    if (profile) {
      const themePreference = profile.theme_preference

      if (themePreference && themePreference !== 'guild') {
        return themePreference
      }

      return effectiveGuild
    }

    return 'dark'
  }, [isHydrated, themeOverride, profile, effectiveGuild, initialTheme])

  useEffect(() => {
    const loadTheme = async () => {
      const loadedTheme = await getGuildThemeClient(currentThemeCode)
      setThemeState(loadedTheme)
    }
    loadTheme()
  }, [currentThemeCode])

  useEffect(() => {
    if (!theme) return

    applyThemeToCSS(theme)

    const root = document.documentElement
    root.setAttribute('data-theme', currentThemeCode)

    const accentRgb = theme.accent.match(/\d+/g)
    if (accentRgb && accentRgb.length >= 3) {
      root.style.setProperty(
        '--accent-opacity-20',
        `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.2)`
      )
      root.style.setProperty(
        '--hover-bg',
        `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.1)`
      )
    } else {
      const hex = theme.accent.replace('#', '')
      const r = parseInt(hex.substr(0, 2), 16)
      const g = parseInt(hex.substr(2, 2), 16)
      const b = parseInt(hex.substr(4, 2), 16)
      root.style.setProperty(
        '--accent-opacity-20',
        `rgba(${r}, ${g}, ${b}, 0.2)`
      )
      root.style.setProperty('--hover-bg', `rgba(${r}, ${g}, ${b}, 0.1)`)
    }

    const contrastVariables = generateContrastVariables(theme)
    Object.entries(contrastVariables).forEach(([property, value]) => {
      root.style.setProperty(property, value)
    })
  }, [theme, currentThemeCode])

  const setTheme = async (themeCode: string) => {
    const canAccess = availableThemes.some((t) => t.code === themeCode)
    if (!canAccess) {
      logger.error({ err: themeCode }, 'User cannot access theme:')
      return { success: false, error: 'You do not have access to this theme' }
    }

    try {
      // Setting themeOverride updates currentThemeCode, whose effect loads the theme.
      setThemeOverride(themeCode)

      if (profile && profile.user_id) {
        try {
          const { error } = await updateThemePreference(
            profile.user_id,
            themeCode
          )

          if (error) {
            logger.error(
              { err: error },
              'Failed to save theme preference to database:'
            )
            // Applied locally but not saved.
            return {
              success: false,
              error:
                'Theme applied locally but could not save to server. It will be reset on next login.'
            }
          }
        } catch (dbError) {
          logger.error(
            { err: dbError },
            'Database error saving theme preference:'
          )
          return {
            success: false,
            error:
              'Theme applied locally but could not save to server. It will be reset on next login.'
          }
        }
      }

      return { success: true }
    } catch (error) {
      logger.error({ err: error }, 'Error setting theme:')
      return {
        success: false,
        error: 'Failed to load theme. Please try again.'
      }
    }
  }

  const resetToGuildTheme = async () => {
    try {
      // Clearing themeOverride makes the effect load the guild theme.
      setThemeOverride(null)

      if (profile && profile.user_id) {
        try {
          const { error } = await updateThemePreference(
            profile.user_id,
            'guild'
          )

          if (error) {
            logger.error(
              { err: error },
              'Failed to reset theme preference in database:'
            )
            return {
              success: false,
              error:
                'Theme reset locally but could not save to server. It will be restored on next login.'
            }
          }
        } catch (dbError) {
          logger.error(
            { err: dbError },
            'Database error resetting theme preference:'
          )
          return {
            success: false,
            error:
              'Theme reset locally but could not save to server. It will be restored on next login.'
          }
        }
      }

      return { success: true }
    } catch (error) {
      logger.error({ err: error }, 'Error resetting theme:')
      return {
        success: false,
        error: 'Failed to reset theme. Please try again.'
      }
    }
  }

  return (
    <ThemeContext.Provider
      value={{
        theme: theme || {
          name: 'Loading',
          primary: '#fff',
          secondary: '#ccc',
          accent: '#999',
          background: { from: '#000', via: '#111', to: '#000' },
          cardBg: '#222',
          cardBorder: '#333',
          text: { primary: '#fff', secondary: '#ccc', accent: '#999' }
        },
        guildCode: currentThemeCode,
        currentThemeCode,
        setGuildCode: setThemeOverride,
        setTheme,
        availableThemes,
        resetToGuildTheme
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}
