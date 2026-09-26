'use client'

import { useEffect, useState } from 'react'
import { getGuildThemeClient, applyThemeToCSS } from '@/app/lib/theme-system'
import type { GuildTheme } from '@/app/lib/theme-system'
import { useLocalStorage } from '@/app/lib/hooks/useLocalStorage'

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

  const fallbackTheme = {
    primary: '#C0C0C0',
    secondary: '#808080',
    accent: '#FF6B35',
    background: { from: '#000000', via: '#111111', to: '#000000' },
    cardBg: '#1A1A1A',
    cardBorder: '#333333',
    text: { primary: '#FFFFFF', secondary: '#CCCCCC', accent: '#FF6B35' }
  }

  const activeTheme = theme || fallbackTheme
  const themeStyles = {
    '--primary': activeTheme.primary,
    '--secondary': activeTheme.secondary,
    '--accent': activeTheme.accent,
    '--bg-from': activeTheme.background.from,
    '--bg-via': activeTheme.background.via,
    '--bg-to': activeTheme.background.to,
    '--card-bg': activeTheme.cardBg,
    '--card-border': activeTheme.cardBorder,
    '--text-primary': activeTheme.text.primary,
    '--text-secondary': activeTheme.text.secondary,
    '--text-accent': activeTheme.text.accent
  } as React.CSSProperties

  return (
    <div style={themeStyles} className="contents">
      {children}
    </div>
  )
}
