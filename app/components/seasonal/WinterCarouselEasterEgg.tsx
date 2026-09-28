'use client'

import { useState, useCallback, useEffect } from 'react'
import { Snowflake, Gift, TreePine, Star } from 'lucide-react'
import { useWinterTheme } from './WinterThemeProvider'

interface WinterCarouselEasterEggProps {
  onActivate?: () => void
}

export function WinterCarouselEasterEgg({
  onActivate
}: WinterCarouselEasterEggProps) {
  const { isWinterThemeActive, activateWinterTheme } = useWinterTheme()
  const [clickCount, setClickCount] = useState(0)
  const [showHint, setShowHint] = useState(false)
  const [showActivation, setShowActivation] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  const CLICKS_REQUIRED = 5

  const { toggleWinterTheme } = useWinterTheme()

  const handleClick = useCallback(() => {
    if (isWinterThemeActive) {
      toggleWinterTheme()
      return
    }

    setClickCount((prev) => {
      const newCount = prev + 1

      if (newCount >= 3 && newCount < CLICKS_REQUIRED) {
        setShowHint(true)
        setTimeout(() => setShowHint(false), 2000)
      }

      if (newCount >= CLICKS_REQUIRED) {
        setIsAnimating(true)
        setShowActivation(true)

        setTimeout(() => {
          activateWinterTheme()
          onActivate?.()

          setTimeout(() => {
            setShowActivation(false)
            setIsAnimating(false)
            setClickCount(0)
          }, 3000)
        }, 1500)

        return 0
      }

      return newCount
    })
  }, [isWinterThemeActive, activateWinterTheme, toggleWinterTheme, onActivate])

  useEffect(() => {
    if (clickCount > 0) {
      const timer = setTimeout(() => {
        setClickCount(0)
      }, 3000)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [clickCount])

  return (
    <>
      <button
        onClick={handleClick}
        className={`
          relative group cursor-pointer p-2 rounded-full transition-all duration-300
          ${
            isWinterThemeActive
              ? 'bg-blue-500/20 text-blue-400'
              : 'bg-transparent text-(--text-tertiary) hover:text-secondary-wh40k'
          }
          ${isAnimating ? 'animate-bounce' : ''}
        `}
        title={
          isWinterThemeActive
            ? 'Winter Theme Active!'
            : 'Click for a surprise...'
        }
        aria-label="Winter theme easter egg"
      >
        <Snowflake
          className={`h-5 w-5 transition-transform duration-500 ${
            isWinterThemeActive ? 'animate-spin text-blue-400' : ''
          } ${clickCount > 0 ? 'scale-110' : ''}`}
          style={{ animationDuration: '3s' }}
        />

        {/* Click progress indicator */}
        {clickCount > 0 && !isWinterThemeActive && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
            {['dot-1', 'dot-2', 'dot-3', 'dot-4', 'dot-5']
              .slice(0, CLICKS_REQUIRED)
              .map((dotId, dotIndex) => (
                <div
                  key={`progress-${dotId}`}
                  className={`w-1 h-1 rounded-full transition-all ${
                    dotIndex < clickCount ? 'bg-blue-400' : 'bg-(--card-border)'
                  }`}
                />
              ))}
          </div>
        )}
      </button>

      {/* Hint tooltip */}
      {showHint && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-bounce">
          <div className="bg-blue-900/90 text-blue-100 px-4 py-2 rounded-lg text-sm font-medium shadow-lg border border-blue-500/30">
            <Snowflake className="mr-2 inline h-4 w-4 text-blue-200" />
            Keep clicking... {CLICKS_REQUIRED - clickCount} more!
            <TreePine className="ml-2 inline h-4 w-4 text-green-300" />
          </div>
        </div>
      )}

      {/* Activation celebration */}
      {showActivation && (
        <div className="fixed inset-0 z-10000 pointer-events-none flex items-center justify-center">
          <div className="relative">
            {/* Burst animation */}
            <div className="absolute inset-0 flex items-center justify-center">
              {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(
                (rotation, burstIndex) => {
                  const BurstIcon =
                    [Snowflake, Star, TreePine, Gift][burstIndex % 4] ??
                    Snowflake
                  return (
                    <div
                      key={`burst-rotation-${rotation}`}
                      className="absolute animate-ping"
                      style={{
                        transform: `rotate(${rotation}deg) translateY(-80px)`,
                        animationDelay: `${burstIndex * 0.1}s`,
                        animationDuration: '1s'
                      }}
                    >
                      <BurstIcon className="h-6 w-6 text-yellow-200" />
                    </div>
                  )
                }
              )}
            </div>

            {/* Main message */}
            <div className="bg-linear-to-r from-blue-900/95 to-green-900/95 p-8 rounded-2xl shadow-2xl border-2 border-yellow-400/50 animate-pulse">
              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-3 text-4xl">
                  <span
                    className="animate-bounce text-sm font-bold uppercase tracking-wide text-yellow-200"
                    style={{ animationDelay: '0s' }}
                  >
                    Santa
                  </span>
                  <TreePine
                    className="h-9 w-9 animate-bounce text-green-300"
                    style={{ animationDelay: '0.1s' }}
                  />
                  <Snowflake
                    className="h-9 w-9 animate-bounce text-blue-200"
                    style={{ animationDelay: '0.2s' }}
                  />
                  <Gift
                    className="h-9 w-9 animate-bounce text-red-300"
                    style={{ animationDelay: '0.3s' }}
                  />
                </div>
                <h2 className="text-2xl font-bold text-white">
                  Winter Wonderland Activated!
                </h2>
                <p className="text-blue-200 text-center">
                  Enjoy the festive decorations, falling snow,
                  <br />
                  and keep an eye out for Santa!
                </p>
                <div className="flex items-center gap-2 text-yellow-300 text-sm">
                  <Star className="h-4 w-4 animate-spin" />
                  <span>Hidden elves are waiting to be found!</span>
                  <Star className="h-4 w-4 animate-spin" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function WinterCarouselItem() {
  const { isWinterThemeActive, toggleWinterTheme } = useWinterTheme()

  return (
    <div
      className="flex-[0_0_100%] min-w-0 cursor-pointer"
      onClick={toggleWinterTheme}
    >
      <div
        className={`
        rounded-xl border p-4 sm:p-5 transition-all
        ${
          isWinterThemeActive
            ? 'border-blue-500/60 bg-linear-to-r from-blue-500/30 via-green-500/20 to-blue-500/30'
            : 'border-blue-500/40 bg-linear-to-r from-blue-500/20 via-blue-600/10 to-blue-500/20 hover:border-blue-400/60'
        }
      `}
      >
        <div className="flex items-start gap-4">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              isWinterThemeActive ? 'bg-blue-500/30' : 'bg-blue-500/20'
            }`}
          >
            {isWinterThemeActive ? (
              <TreePine className="h-5 w-5 text-green-300" />
            ) : (
              <Snowflake className="h-5 w-5 text-blue-300" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                {isWinterThemeActive ? 'Active' : 'Seasonal'}
              </span>
              {isWinterThemeActive && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-green-500/20 text-green-400">
                  ON
                </span>
              )}
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-primary-wh40k">
              {isWinterThemeActive
                ? 'Winter Wonderland Active!'
                : 'Winter Wonderland Theme'}
            </h3>
            <p className="text-sm text-secondary-wh40k mt-1">
              {isWinterThemeActive
                ? 'Click to disable festive decorations'
                : 'Click to enable snow, lights, and holiday surprises!'}
            </p>
          </div>
          <div className="shrink-0 self-center flex items-center gap-1">
            {isWinterThemeActive ? (
              <>
                <TreePine className="h-5 w-5 text-green-400" />
                <Gift className="h-5 w-5 text-red-400" />
              </>
            ) : (
              <Snowflake className="h-5 w-5 text-blue-400" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
