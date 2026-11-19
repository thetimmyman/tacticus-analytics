'use client'

import { useEffect, useState } from 'react'
import { getGuildThemeClient, applyThemeToCSS } from '@/app/lib/theme-system'
import type { GuildTheme } from '@/app/lib/theme-system'
import { useLocalStorage } from '@/app/lib/hooks/useLocalStorage'
import { getOnFillVariables } from '@/app/lib/utils/contrast'

export function PublicThemeProvider({
  children
}: {
  children: React.ReactNode
}) {
  const [theme, setTheme] = useState<GuildTheme | null>(null)
  const [themeOverride, , isHydrated] = useLocalStorage<string>(
    'theme-override',
    'dark'
  )

  useEffect(() => {
    if (!isHydrated) return

    const loadTheme = async () => {
      const themeCode = themeOverride || 'dark'
      const loadedTheme = await getGuildThemeClient(themeCode)
      setTheme(loadedTheme)
      applyThemeToCSS(loadedTheme)
      document.documentElement.setAttribute('data-theme', themeCode)
    }

    loadTheme()
  }, [isHydrated, themeOverride])

  // Until the stored theme has loaded, set nothing: the wrapper inherits the
  // variables the pre-hydration script put on <html> (the stored theme, else
  // the :root dark defaults). A different fallback here would paint over them.
  const themeStyles = theme
    ? ({
        '--primary': theme.primary,
        '--secondary': theme.secondary,
        '--accent': theme.accent,
        '--bg-from': theme.background.from,
        '--bg-via': theme.background.via,
        '--bg-to': theme.background.to,
        '--card-bg': theme.cardBg,
        '--card-border': theme.cardBorder,
        '--text-primary': theme.text.primary,
        '--text-secondary': theme.text.secondary,
        '--text-accent': theme.text.accent,
        // The wrapper re-declares the fills, so their label colours too.
        ...getOnFillVariables(theme)
      } as React.CSSProperties)
    : undefined

  return (
    <div style={themeStyles} className="contents">
      {children}
    </div>
  )
}
