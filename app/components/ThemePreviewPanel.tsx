'use client'

import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Palette,
  Shield,
  Skull,
  Bug,
  Crown,
  Save,
  Check
} from 'lucide-react'
import {
  allThemes,
  specialThemes,
  guildThemes,
  type GuildTheme
} from '@/app/lib/theme-system'
import { applyThemeToCSS } from '@/app/lib/theme-system'
import { useTheme } from '@/app/components/ThemeProvider'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.ThemePreviewPanel')

interface ThemePreviewPanelProps {
  currentTheme?: string
  onThemeSelect?: (themeCode: string) => void
  allowSelection?: boolean
}

interface ThemeCategory {
  id: string
  label: string
  icon: React.ReactNode
  description: string
  themes: Record<string, GuildTheme>
  defaultExpanded?: boolean
}

function ThemePreviewPanel({
  currentTheme = 'dark',
  onThemeSelect,
  allowSelection = false
}: ThemePreviewPanelProps) {
  const { setTheme: saveTheme } = useTheme()
  const [previewTheme, setPreviewTheme] = useState<string | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  )
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const categories: ThemeCategory[] = [
    {
      id: 'chaos',
      label: 'Chaos Forces',
      icon: <Skull className="w-4 h-4" />,
      description: 'Traitor legions and daemonic entities',
      themes: Object.fromEntries(
        Object.entries(guildThemes)
          .filter(([code]) =>
            [
              'CHAOS_DAEMONS',
              'DG',
              'EC',
              'KHORNE',
              'LEGION_DAMNED',
              'NL',
              'NURGLE',
              'RENEGADES',
              'SLAANESH',
              'TZEENTCH',
              'WB',
              'WE'
            ].includes(code)
          )
          .sort(([a], [b]) => a.localeCompare(b))
      )
    },
    {
      id: 'imperial',
      label: 'Imperial Forces',
      icon: <Crown className="w-4 h-4" />,
      description: "The Imperium's military might",
      themes: Object.fromEntries(
        Object.entries(guildThemes)
          .filter(([code]) =>
            [
              'CADIA',
              'CATACHAN',
              'CUSTODES',
              'DAEMON_HUNTERS',
              'INQUISITION',
              'KNIGHTS',
              'MECHANICUS',
              'NAVY',
              'SISTERS',
              'STEEL_LEGION',
              'TITANS',
              'VALHALLAN'
            ].includes(code)
          )
          .sort(([a], [b]) => a.localeCompare(b))
      )
    },
    {
      id: 'loyalist',
      label: 'Loyalist Astartes',
      icon: <Shield className="w-4 h-4" />,
      description: "The Emperor's finest Space Marine chapters",
      themes: Object.fromEntries(
        Object.entries(guildThemes)
          .filter(([code]) =>
            [
              'BA',
              'BT',
              'CF',
              'DA_LOYALIST',
              'DEATHWATCH',
              'GREY_KNIGHTS',
              'IF',
              'IH_LOYALIST',
              'LAMENTERS',
              'RG_LOYALIST',
              'SA',
              'SW',
              'UM',
              'WS'
            ].includes(code)
          )
          .sort(([a], [b]) => a.localeCompare(b))
      )
    },
    {
      id: 'special',
      label: 'Special Themes',
      icon: <Palette className="w-4 h-4" />,
      description: 'Unique and experimental themes',
      themes: Object.fromEntries(
        Object.entries(specialThemes).sort(([a], [b]) => a.localeCompare(b))
      )
    },
    {
      id: 'xenos',
      label: 'Xenos Threats',
      icon: <Bug className="w-4 h-4" />,
      description: 'Alien races and their craftworlds',
      themes: Object.fromEntries(
        Object.entries(guildThemes)
          .filter(([code]) =>
            [
              'CRAFTWORLD_BIEL_TAN',
              'CRAFTWORLD_SAIM_HANN',
              'CRAFTWORLD_ULTHWE',
              'DELDAR',
              'ELDAR',
              'GENESTEALER',
              'HARLEQUINS',
              'NECRONS',
              'ORKS',
              'TAU',
              'TYRANIDS',
              'VOTANN'
            ].includes(code)
          )
          .sort(([a], [b]) => a.localeCompare(b))
      )
    }
  ]

  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories)
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId)
    } else {
      newExpanded.add(categoryId)
    }
    setExpandedCategories(newExpanded)
  }

  const handleThemePreview = (themeCode: string) => {
    const theme = allThemes[themeCode]
    if (theme) {
      applyThemeToCSS(theme)
      setPreviewTheme(themeCode)
      document.documentElement.setAttribute('data-theme', themeCode)
    }
  }

  const handleThemeSelect = (themeCode: string) => {
    if (allowSelection && onThemeSelect) {
      onThemeSelect(themeCode)
    } else {
      handleThemePreview(themeCode)
    }
  }

  const resetPreview = () => {
    if (previewTheme) {
      const originalTheme = allThemes[currentTheme]
      if (originalTheme) {
        applyThemeToCSS(originalTheme)
        document.documentElement.setAttribute('data-theme', currentTheme)
      }
      setPreviewTheme(null)
    }
  }

  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSaveTheme = async () => {
    if (!previewTheme) return

    setSaving(true)
    setSaveSuccess(false)
    setSaveError(null)

    try {
      const result = await saveTheme(previewTheme)

      if (result.success) {
        setSaveSuccess(true)
        setPreviewTheme(null)
        setTimeout(() => setSaveSuccess(false), 3000)
      } else {
        setSaveError(result.error || 'Failed to save theme')
        setTimeout(() => setSaveError(null), 5000)
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to save theme:')
      setSaveError('An unexpected error occurred')
      setTimeout(() => setSaveError(null), 5000)
    } finally {
      setSaving(false)
    }
  }

  const totalThemes = Object.keys(allThemes).length
  const expandedThemesCount = categories
    .filter((cat) => expandedCategories.has(cat.id))
    .reduce((sum, cat) => sum + Object.keys(cat.themes).length, 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">
            Warhammer 40K Theme Collection
          </h2>
          <p className="text-[var(--text-secondary)] mt-1">
            {totalThemes} themes available • {expandedThemesCount} visible •
            {previewTheme
              ? ` Previewing: ${allThemes[previewTheme]?.name}`
              : ' Click a category to explore'}
          </p>
        </div>

        {previewTheme && (
          <div className="flex flex-col gap-2 items-end">
            <div className="flex gap-2">
              <button
                onClick={handleSaveTheme}
                disabled={saving}
                className="btn-accent-wh40k text-sm flex items-center gap-2"
              >
                {saving ? (
                  <>Saving...</>
                ) : saveSuccess ? (
                  <>
                    <Check className="w-4 h-4" /> Saved!
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" /> Save Theme
                  </>
                )}
              </button>
              <button onClick={resetPreview} className="btn-wh40k text-sm">
                Reset Preview
              </button>
            </div>
            {saveError && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-1">
                {saveError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2">
        <button
          onClick={() =>
            setExpandedCategories(new Set(categories.map((c) => c.id)))
          }
          className="text-xs px-2 py-1 rounded bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--card-border)]"
        >
          Expand All
        </button>
        <button
          onClick={() => setExpandedCategories(new Set())}
          className="text-xs px-2 py-1 rounded bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--card-border)]"
        >
          Collapse All
        </button>
      </div>

      {/* Categories */}
      <div className="space-y-3">
        {categories.map((category) => {
          const isExpanded = expandedCategories.has(category.id)
          const themeCount = Object.keys(category.themes).length

          if (themeCount === 0) return null

          return (
            <div
              key={category.id}
              className="border border-[var(--card-border)] rounded-lg overflow-hidden bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200"
            >
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category.id)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--card-hover)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[var(--accent)]">{category.icon}</span>
                  <div className="text-left">
                    <h3 className="font-semibold text-[var(--text-primary)]">
                      {category.label}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {category.description} • {themeCount} themes
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-[var(--text-secondary)]" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-[var(--text-secondary)]" />
                  )}
                </div>
              </button>

              {/* Theme Grid (Collapsible) */}
              {isExpanded && (
                <div className="p-4 border-t border-[var(--card-border)]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {Object.entries(category.themes).map(([code, theme]) => {
                      const isActive = code === currentTheme
                      const isPreviewing = code === previewTheme

                      return (
                        <div
                          key={code}
                          className={`relative group cursor-pointer transition-all duration-300 ${
                            isActive ? 'ring-2 ring-[var(--accent)]' : ''
                          } ${isPreviewing ? 'ring-2 ring-blue-400' : ''}`}
                          onClick={() => handleThemeSelect(code)}
                        >
                          {/* Compact Theme Card */}
                          <div
                            className="p-3 rounded-lg border-2 transition-all duration-300 group-hover:border-opacity-60"
                            style={{
                              background: `linear-gradient(135deg, ${theme.background.from}, ${theme.background.to})`,
                              borderColor: theme.primary
                            }}
                          >
                            {/* Theme Header */}
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <h4
                                  className="font-bold text-sm leading-tight"
                                  style={{ color: theme.text.primary }}
                                >
                                  {theme.name}
                                </h4>
                                <div
                                  className="text-xs opacity-75 mt-0.5"
                                  style={{ color: theme.text.accent }}
                                >
                                  {code}
                                </div>
                              </div>

                              {theme.heraldry && (
                                <span className="text-lg ml-2" title="Heraldry">
                                  {theme.heraldry}
                                </span>
                              )}
                            </div>

                            {/* Color Swatches */}
                            <div className="flex gap-1 mb-2">
                              <div
                                className="w-6 h-3 rounded border border-white/20"
                                style={{ backgroundColor: theme.primary }}
                                title="Primary"
                              />
                              <div
                                className="w-6 h-3 rounded border border-white/20"
                                style={{ backgroundColor: theme.secondary }}
                                title="Secondary"
                              />
                              <div
                                className="w-6 h-3 rounded border border-white/20"
                                style={{ backgroundColor: theme.accent }}
                                title="Accent"
                              />
                            </div>

                            {/* Motto (if exists) */}
                            {theme.motto && (
                              <p
                                className="text-xs italic opacity-80 line-clamp-2"
                                style={{ color: theme.text.secondary }}
                              >
                                &quot;{theme.motto}&quot;
                              </p>
                            )}

                            {/* Status Indicators */}
                            {(isActive || isPreviewing) && (
                              <div className="absolute top-2 right-2 flex gap-1">
                                {isActive && (
                                  <div
                                    className="w-2 h-2 bg-green-400 rounded-full"
                                    title="Current Theme"
                                  />
                                )}
                                {isPreviewing && (
                                  <div
                                    className="w-2 h-2 bg-blue-400 rounded-full"
                                    title="Previewing"
                                  />
                                )}
                              </div>
                            )}

                            {/* Hover overlay */}
                            <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                              <span className="text-white font-medium text-xs bg-black/50 px-2 py-0.5 rounded">
                                {allowSelection ? 'Select' : 'Preview'}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Instructions */}
      <div className="text-center text-sm text-[var(--text-secondary)] space-y-1 pt-4">
        <p>
          Click any theme to{' '}
          {allowSelection ? 'select it' : 'preview it instantly'}
        </p>
        {!allowSelection && (
          <p>
            Use the &quot;Reset Preview&quot; button to return to your current
            theme
          </p>
        )}
      </div>
    </div>
  )
}

export default ThemePreviewPanel
