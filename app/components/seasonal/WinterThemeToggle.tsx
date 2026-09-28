'use client'

import { useState } from 'react'
import { Eye, Lightbulb, Snowflake, Sparkles, TreePine } from 'lucide-react'
import { useWinterTheme } from './WinterThemeProvider'

interface WinterThemeToggleProps {
  variant?: 'full' | 'compact' | 'icon'
  className?: string
}

const snowIntensityIconIds = {
  light: ['light-1'],
  medium: ['medium-1', 'medium-2'],
  heavy: ['heavy-1', 'heavy-2', 'heavy-3']
} as const

export function WinterThemeToggle({
  variant = 'full',
  className = ''
}: WinterThemeToggleProps) {
  const {
    isWinterThemeActive,
    toggleWinterTheme,
    snowIntensity,
    setSnowIntensity,
    showLights,
    setShowLights,
    showElves,
    setShowElves
  } = useWinterTheme()

  const [isExpanded, setIsExpanded] = useState(false)

  if (variant === 'icon') {
    return (
      <button
        onClick={toggleWinterTheme}
        className={`p-2 rounded-lg transition-all ${
          isWinterThemeActive
            ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 ring-2 ring-blue-500/50'
            : 'bg-(--card-bg) text-secondary-wh40k hover:text-primary-wh40k hover:bg-(--hover-bg)'
        } ${className}`}
        title={
          isWinterThemeActive ? 'Disable Winter Theme' : 'Enable Winter Theme'
        }
      >
        <Snowflake
          className={`h-5 w-5 ${isWinterThemeActive ? 'animate-spin' : ''}`}
          style={{ animationDuration: '3s' }}
        />
      </button>
    )
  }

  if (variant === 'compact') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <button
          onClick={toggleWinterTheme}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            isWinterThemeActive
              ? 'bg-linear-to-r from-blue-500/20 to-green-500/20 text-blue-300 border border-blue-500/30'
              : 'bg-(--card-bg) text-secondary-wh40k hover:text-primary-wh40k border border-(--card-border)'
          }`}
        >
          {isWinterThemeActive ? (
            <>
              <TreePine className="h-4 w-4 text-green-400" />
              <span>Winter Mode On</span>
              <Snowflake
                className="h-4 w-4 text-blue-400 animate-spin"
                style={{ animationDuration: '3s' }}
              />
            </>
          ) : (
            <>
              <Snowflake className="h-4 w-4" />
              <span>Enable Winter Theme</span>
            </>
          )}
        </button>
      </div>
    )
  }

  return (
    <div className={`card-wh40k p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-lg ${isWinterThemeActive ? 'bg-blue-500/20' : 'bg-(--card-bg)'}`}
          >
            <Snowflake
              className={`h-6 w-6 ${isWinterThemeActive ? 'text-blue-400 animate-spin' : 'text-secondary-wh40k'}`}
              style={{ animationDuration: '3s' }}
            />
          </div>
          <div>
            <h3 className="font-semibold text-primary-wh40k">
              Winter Wonderland Theme
            </h3>
            <p className="text-xs text-secondary-wh40k">
              Festive decorations and effects
            </p>
          </div>
        </div>
        <button
          onClick={toggleWinterTheme}
          className={`relative w-14 h-7 rounded-full transition-all ${
            isWinterThemeActive
              ? 'bg-linear-to-r from-blue-500 to-green-500'
              : 'bg-(--card-border)'
          }`}
        >
          <div
            className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all ${
              isWinterThemeActive ? 'left-8' : 'left-1'
            }`}
          >
            {isWinterThemeActive && (
              <Snowflake className="absolute inset-0 m-auto h-3 w-3 text-blue-500" />
            )}
          </div>
        </button>
      </div>

      {isWinterThemeActive && (
        <>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-between p-2 rounded-lg bg-(--card-bg) hover:bg-(--hover-bg) transition-colors text-sm"
          >
            <span className="text-secondary-wh40k">Customize Effects</span>
            <Sparkles
              className={`h-4 w-4 text-yellow-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
          </button>

          {isExpanded && (
            <div className="mt-3 space-y-3 p-3 rounded-lg bg-(--bg-tertiary) border border-(--card-border)">
              {/* Snow Intensity */}
              <div>
                <label className="text-xs font-medium text-secondary-wh40k mb-2 block">
                  Snow Intensity
                </label>
                <div className="flex gap-2">
                  {(['light', 'medium', 'heavy'] as const).map((intensity) => (
                    <button
                      key={intensity}
                      onClick={() => setSnowIntensity(intensity)}
                      className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all ${
                        snowIntensity === intensity
                          ? 'bg-blue-500 text-white'
                          : 'bg-(--card-bg) text-secondary-wh40k hover:bg-(--hover-bg)'
                      }`}
                    >
                      <span className="inline-flex items-center gap-0.5 align-middle">
                        {snowIntensityIconIds[intensity].map((iconId) => (
                          <Snowflake key={iconId} className="h-3 w-3" />
                        ))}
                      </span>
                      <span className="ml-1 capitalize">{intensity}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Christmas Lights */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-yellow-300" />
                  <span className="text-sm text-primary-wh40k">
                    Christmas Lights
                  </span>
                </div>
                <button
                  onClick={() => setShowLights(!showLights)}
                  className={`w-10 h-5 rounded-full transition-all ${
                    showLights ? 'bg-green-500' : 'bg-(--card-border)'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white shadow transition-all ${
                      showLights ? 'ml-5' : 'ml-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Hidden Elves */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-green-300" />
                  <span className="text-sm text-primary-wh40k">
                    Hidden Elves
                  </span>
                  <span className="text-xs text-(--text-tertiary)">
                    (find them!)
                  </span>
                </div>
                <button
                  onClick={() => setShowElves(!showElves)}
                  className={`w-10 h-5 rounded-full transition-all ${
                    showElves ? 'bg-green-500' : 'bg-(--card-border)'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white shadow transition-all ${
                      showElves ? 'ml-5' : 'ml-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Hint */}
              <p className="text-xs text-(--text-tertiary) italic pt-2 border-t border-(--card-border) flex items-center gap-2">
                <Sparkles className="h-3 w-3 text-yellow-300" />
                <span>Tip: Watch for Santa flying across your screen!</span>
              </p>
            </div>
          )}
        </>
      )}

      {!isWinterThemeActive && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-(--bg-tertiary) text-sm text-secondary-wh40k">
          <TreePine className="h-4 w-4 text-green-500" />
          <span>
            Enable to see snow, lights, decorations, and hidden surprises!
          </span>
        </div>
      )}
    </div>
  )
}
