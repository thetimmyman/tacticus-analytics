import { useId, useMemo, useState } from 'react'
import {
  Eye,
  EyeOff,
  UserX,
  Shuffle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Loader2
} from 'lucide-react'
import { Button } from '@tacticus/ui-kit'
import {
  ANONYMOUS_PLAYER_LABEL,
  type ExplorePrivacyMode,
  type ExplorePrivacyModes
} from '@tacticus/app-core/explore-privacy'
import { cn } from '@/app/lib/utils/cn'
import {
  MIN_OBFUSCATION_PERCENT,
  MAX_OBFUSCATION_PERCENT
} from '@tacticus/app-core/privacy'
import { SectionLabel, SnapPointSlider } from '@/app/components/ui'

// `<SnapPointSlider>` needs an exact match, so values are rounded to the nearest snap.
const OBFUSCATION_SNAPS = [1, 5, 10, 15, 20, 25, 30]

function nearestObfuscationSnap(value: number): number {
  return OBFUSCATION_SNAPS.reduce((nearest, snap) =>
    Math.abs(snap - value) < Math.abs(nearest - value) ? snap : nearest
  )
}

interface PrivacyOption {
  value: ExplorePrivacyMode
  label: string
  description: string
  icon: React.ReactNode
  example: string
  severity?: 'low' | 'medium' | 'high'
}

const PRIVACY_OPTIONS: PrivacyOption[] = [
  {
    value: 'public',
    label: 'Public',
    description: 'Show full values on public Explore and leaderboard pages',
    icon: <Eye className="w-5 h-5" />,
    example: 'Full guild stats, player names, exact damage values',
    severity: 'low'
  },
  {
    value: 'hide_primes',
    label: 'Hide Prime Bosses',
    description:
      'Hide prime boss data (encounters 1 and 2) on public Explore and leaderboard pages',
    icon: <EyeOff className="w-5 h-5" />,
    example: 'Main boss data visible, side bosses hidden',
    severity: 'low'
  },
  {
    value: 'hide_players',
    label: 'Hide Player Names',
    description: `Replace player names on public Explore and leaderboard pages with "${ANONYMOUS_PLAYER_LABEL}"`,
    icon: <UserX className="w-5 h-5" />,
    example: `${ANONYMOUS_PLAYER_LABEL}: 175,759 damage`,
    severity: 'medium'
  },
  {
    value: 'obfuscate_values',
    label: 'Obfuscate Values',
    description:
      'Show damage as ranges (± configurable %) instead of exact values on public Explore and leaderboard pages',
    icon: <Shuffle className="w-5 h-5" />,
    example: '175,759 becomes roughly 158k - 193k at ±10%',
    severity: 'medium'
  },
  {
    value: 'hide_all',
    label: 'Hide Completely',
    description: 'Remove guild from public Explore and leaderboard results',
    icon: <AlertTriangle className="w-5 h-5" />,
    example: 'Guild will not appear in public Explore or leaderboard results',
    severity: 'high'
  }
]

interface PrivacySettingsPanelProps {
  explorePrivacyMode: ExplorePrivacyModes
  onExplorePrivacyModeChange: (modes: ExplorePrivacyModes) => void
  obfuscationPercent: number
  onObfuscationPercentChange: (value: number) => void
  disabled?: boolean
  onExploreCacheSync?: () => void
  exploreCacheSyncing?: boolean
}

export function PrivacySettingsPanel({
  explorePrivacyMode,
  onExplorePrivacyModeChange,
  obfuscationPercent,
  onObfuscationPercentChange,
  disabled = false,
  onExploreCacheSync,
  exploreCacheSyncing = false
}: PrivacySettingsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const sectionId = useId()
  const contentId = `${sectionId}-content`
  const clampedPercent = Math.min(
    MAX_OBFUSCATION_PERCENT,
    Math.max(MIN_OBFUSCATION_PERCENT, obfuscationPercent)
  )
  // Align off-snap legacy values for display only; the stored value is unchanged.
  const sliderValue = useMemo(
    () => nearestObfuscationSnap(clampedPercent),
    [clampedPercent]
  )

  const handleObfuscationChange = (value: number) => {
    if (disabled) return
    const normalized = Math.min(
      MAX_OBFUSCATION_PERCENT,
      Math.max(MIN_OBFUSCATION_PERCENT, Math.round(value))
    )
    onObfuscationPercentChange(normalized)
  }

  return (
    <div className="space-y-6">
      <div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          aria-controls={contentId}
          className="flex min-h-[44px] w-full items-center gap-3 text-left group rounded-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--accent)"
        >
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-secondary-wh40k transition-transform" />
            ) : (
              <ChevronRight className="w-4 h-4 text-secondary-wh40k transition-transform" />
            )}
            <SectionLabel
              withDivider={false}
              helper={`${explorePrivacyMode.length} setting${
                explorePrivacyMode.length !== 1 ? 's' : ''
              } active`}
              className="transition-colors group-hover:text-(--accent)"
            >
              Public Explore &amp; Leaderboard Privacy
            </SectionLabel>
          </div>
          <div className="flex-1 border-t border-card-border/30" />
        </button>

        {isExpanded && (
          <p className="text-sm text-secondary-wh40k mt-3 mb-4">
            Control how your guild data appears on public Explore and
            leaderboard pages. You can select multiple privacy options that will
            be applied together. Changes take effect immediately.
          </p>
        )}
      </div>

      {isExpanded && (
        <div id={contentId} className="space-y-6">
          <div className="space-y-3">
            {PRIVACY_OPTIONS.map((option) => {
              const isSelected = explorePrivacyMode.includes(option.value)

              const handleToggle = () => {
                if (disabled) return

                if (option.value === 'hide_all') {
                  if (isSelected) {
                    onExplorePrivacyModeChange(['public']) // Default to public if deselecting hide_all
                  } else {
                    onExplorePrivacyModeChange(['hide_all']) // Only hide_all selected
                  }
                  return
                }

                if (option.value === 'public') {
                  if (isSelected) {
                    // Public cannot be deselected; one mode is always required.
                    return
                  } else {
                    onExplorePrivacyModeChange(['public']) // Only public selected
                  }
                  return
                }

                const currentModes = explorePrivacyMode.filter(
                  (mode) => mode !== 'public' && mode !== 'hide_all'
                )
                const newModes = isSelected
                  ? currentModes.filter((mode) => mode !== option.value)
                  : [...currentModes, option.value]

                if (newModes.length === 0) {
                  onExplorePrivacyModeChange(['public'])
                } else {
                  onExplorePrivacyModeChange(newModes)
                }
              }

              const optionId = `${sectionId}-${option.value}`

              return (
                <div
                  key={option.value}
                  className={cn(
                    'block space-y-4 rounded-lg border-2 p-4 transition-all focus-within:ring-2 focus-within:ring-(--accent) focus-within:ring-offset-2 focus-within:ring-offset-(--bg-primary)',
                    disabled && 'opacity-50',
                    isSelected
                      ? option.value === 'public'
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : option.value === 'hide_primes'
                          ? 'border-yellow-500 bg-yellow-500/10'
                          : option.severity === 'high'
                            ? 'border-red-500 bg-red-500/10'
                            : option.severity === 'medium'
                              ? 'border-yellow-500 bg-yellow-500/10'
                              : 'border-primary-wh40k bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]'
                      : 'border-(--card-border) hover:border-[color-mix(in_srgb,var(--primary)_50%,transparent)] hover:bg-card/50'
                  )}
                >
                  <input
                    id={optionId}
                    type="checkbox"
                    name="privacy-mode"
                    value={option.value}
                    checked={isSelected}
                    onChange={handleToggle}
                    disabled={disabled}
                    className="peer sr-only"
                  />

                  <label
                    htmlFor={optionId}
                    className={cn(
                      'flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md',
                      disabled && 'cursor-not-allowed'
                    )}
                  >
                    <div
                      className={cn(
                        'shrink-0 p-2 rounded-lg',
                        isSelected
                          ? option.value === 'public'
                            ? 'bg-emerald-500/20 text-emerald-500'
                            : option.value === 'hide_primes'
                              ? 'bg-yellow-500/20 text-yellow-500'
                              : option.severity === 'high'
                                ? 'bg-red-500/20 text-red-500'
                                : option.severity === 'medium'
                                  ? 'bg-yellow-500/20 text-yellow-500'
                                  : 'bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] text-(--primary)'
                          : 'bg-(--bg-secondary) text-secondary-wh40k'
                      )}
                    >
                      {option.icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="font-medium text-primary-wh40k">
                          {option.label}
                        </h4>
                        {isSelected && (
                          <div
                            className={cn(
                              'w-2 h-2 rounded-full',
                              option.value === 'public'
                                ? 'bg-emerald-500'
                                : option.value === 'hide_primes'
                                  ? 'bg-yellow-500'
                                  : option.severity === 'high'
                                    ? 'bg-red-500'
                                    : option.severity === 'medium'
                                      ? 'bg-yellow-500'
                                      : 'bg-primary-wh40k'
                            )}
                          />
                        )}
                      </div>

                      <p className="text-sm text-secondary-wh40k mb-2">
                        {option.description}
                      </p>

                      <div className="text-xs text-(--text-tertiary) font-mono bg-(--bg-secondary) px-2 py-1 rounded-sm">
                        Example: {option.example}
                      </div>
                    </div>
                  </label>

                  {option.value === 'obfuscate_values' && isSelected && (
                    <div className="space-y-2 pl-0 sm:pl-14">
                      <div className="flex items-center justify-between text-xs text-secondary-wh40k">
                        <span>Obfuscation strength</span>
                      </div>
                      <fieldset disabled={disabled} aria-disabled={disabled}>
                        <SnapPointSlider
                          snaps={OBFUSCATION_SNAPS}
                          value={sliderValue}
                          onChange={handleObfuscationChange}
                          accent="amber"
                          disabled={disabled}
                          formatValue={(v) => `${v}%`}
                          formatSnap={(s) => `${s}`}
                          ariaLabel="Obfuscation percent"
                        />
                      </fieldset>
                      <div className="flex justify-between text-[10px] uppercase tracking-wide text-(--text-tertiary)">
                        <span>lighter fuzz</span>
                        <span>heavier fuzz</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <div className="flex items-start gap-2">
                <Eye className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-medium text-blue-500 mb-1">
                    Privacy Notice
                  </h4>
                  <p className="text-sm text-secondary-wh40k">
                    These settings change what public Explore and leaderboard
                    pages show. Members of guilds in the same cluster can still
                    view this guild&apos;s per-battle data. Internal guild data,
                    dashboard analytics, and API responses remain unchanged.
                    Guild leaders and officers can always see full data when
                    logged in. See the{' '}
                    <a
                      href="/explore"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
                    >
                      public Explore page
                    </a>
                    .
                  </p>
                </div>
              </div>
            </div>

            {onExploreCacheSync && (
              <div className="p-4 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] border border-card-border/50 rounded-lg">
                <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="font-medium text-primary-wh40k mb-1">
                      Manual Cache Refresh
                    </h4>
                    <p className="text-sm text-secondary-wh40k">
                      Privacy changes are automatically applied, but you can
                      manually refresh the public Explore and leaderboard cache
                      if needed.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={onExploreCacheSync}
                    disabled={exploreCacheSyncing || disabled}
                    variant="outline"
                    size="sm"
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl whitespace-normal sm:whitespace-nowrap"
                  >
                    {exploreCacheSyncing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Refreshing…
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        Refresh public surfaces
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
