'use client'

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback
} from 'react'
import { createPortal } from 'react-dom'
import { useLocalStorage } from '@/app/lib/hooks/useLocalStorage'
// The global style block stays here: this provider mounts everything it styles.
import {
  ChristmasLights,
  ChristmasTree,
  HiddenElf,
  SantaEasterEgg,
  Snowflake,
  SnowmanDecoration,
  SparkleEffect
} from './WinterDecorations'
import {
  FireworksDisplay,
  FloatingGifts,
  RandomPresents,
  type Firework
} from './WinterInteractiveEffects'

interface WinterThemeContextType {
  isWinterThemeActive: boolean
  toggleWinterTheme: () => void
  activateWinterTheme: () => void
  deactivateWinterTheme: () => void
  snowIntensity: 'light' | 'medium' | 'heavy'
  setSnowIntensity: (intensity: 'light' | 'medium' | 'heavy') => void
  showLights: boolean
  setShowLights: (show: boolean) => void
  showElves: boolean
  setShowElves: (show: boolean) => void
}

const WinterThemeContext = createContext<WinterThemeContextType | null>(null)

export function useWinterTheme() {
  const context = useContext(WinterThemeContext)
  if (!context) {
    throw new Error('useWinterTheme must be used within WinterThemeProvider')
  }
  return context
}

const STORAGE_KEY = 'eot-winter-theme'

interface WinterSettings {
  active: boolean
  snowIntensity: 'light' | 'medium' | 'heavy'
  showLights: boolean
  showElves: boolean
}

export function WinterThemeProvider({
  children
}: {
  children: React.ReactNode
}) {
  const [settings, setSettings, mounted] = useLocalStorage<WinterSettings>(
    STORAGE_KEY,
    {
      active: false,
      snowIntensity: 'medium',
      showLights: true,
      showElves: true
    }
  )
  const [fireworks, setFireworks] = useState<Firework[]>([])
  const clickCountRef = React.useRef(0)
  const CLICKS_FOR_FIREWORK = 5

  const fireworksTimeoutsRef = React.useRef<Set<NodeJS.Timeout>>(new Set())

  const spawnFirework = useCallback((x: number, y: number) => {
    const colors = [
      '#ff0000',
      '#00ff00',
      '#ffff00',
      '#ff00ff',
      '#00ffff',
      '#ff8800',
      '#88ff00'
    ]
    const color = colors[Math.floor(Math.random() * colors.length)] ?? '#ff0000'
    const newFirework: Firework = {
      id: Date.now() + Math.random(),
      x,
      y,
      color,
      particles: Array.from({ length: 12 }).map((_, i) => ({
        angle: i * 30,
        distance: 50 + Math.random() * 50,
        delay: Math.random() * 0.2
      }))
    }

    setFireworks((prev) => [...prev.slice(-5), newFirework])

    const timeout = setTimeout(() => {
      setFireworks((prev) => prev.filter((f) => f.id !== newFirework.id))
      fireworksTimeoutsRef.current.delete(timeout)
    }, 1500)
    fireworksTimeoutsRef.current.add(timeout)
  }, [])

  useEffect(() => {
    const currentTimeouts = fireworksTimeoutsRef.current
    return () => {
      currentTimeouts.forEach(clearTimeout)
      currentTimeouts.clear()
    }
  }, [])

  useEffect(() => {
    if (!mounted || !settings.active) return

    const handleClick = (e: MouseEvent) => {
      clickCountRef.current++

      if (clickCountRef.current >= CLICKS_FOR_FIREWORK) {
        clickCountRef.current = 0
        spawnFirework(e.clientX, e.clientY)
      }
    }

    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [mounted, settings.active, spawnFirework])

  const toggleWinterTheme = useCallback(() => {
    setSettings((prev) => ({ ...prev, active: !prev.active }))
  }, [setSettings])

  const activateWinterTheme = useCallback(() => {
    setSettings((prev) => ({ ...prev, active: true }))
  }, [setSettings])

  const deactivateWinterTheme = useCallback(() => {
    setSettings((prev) => ({ ...prev, active: false }))
  }, [setSettings])

  const setSnowIntensity = useCallback(
    (intensity: 'light' | 'medium' | 'heavy') => {
      setSettings((prev) => ({ ...prev, snowIntensity: intensity }))
    },
    [setSettings]
  )

  const setShowLights = useCallback(
    (show: boolean) => {
      setSettings((prev) => ({ ...prev, showLights: show }))
    },
    [setSettings]
  )

  const setShowElves = useCallback(
    (show: boolean) => {
      setSettings((prev) => ({ ...prev, showElves: show }))
    },
    [setSettings]
  )

  const snowflakeCount =
    settings.snowIntensity === 'light'
      ? 30
      : settings.snowIntensity === 'medium'
        ? 60
        : 100

  const [snowflakes, setSnowflakes] = useState<
    Array<{ id: number; char: string; style: React.CSSProperties }>
  >([])

  useEffect(() => {
    const chars = ['*', '+', '.', 'x']
    const newSnowflakes = Array.from({ length: snowflakeCount }).map(
      (_, i) => ({
        id: i,
        char: chars[Math.floor(Math.random() * chars.length)] ?? '*',
        style: {
          left: `${Math.random() * 100}%`,
          animationDuration: `${8 + Math.random() * 12}s`,
          animationDelay: `${Math.random() * 5}s`,
          fontSize: `${8 + Math.random() * 16}px`,
          opacity: 0.4 + Math.random() * 0.6
        } as React.CSSProperties
      })
    )

    // requestAnimationFrame avoids a synchronous setState in the effect.
    const frame = requestAnimationFrame(() => {
      setSnowflakes(newSnowflakes)
    })
    return () => cancelAnimationFrame(frame)
  }, [snowflakeCount])

  const contextValue: WinterThemeContextType = {
    isWinterThemeActive: settings.active,
    toggleWinterTheme,
    activateWinterTheme,
    deactivateWinterTheme,
    snowIntensity: settings.snowIntensity,
    setSnowIntensity,
    showLights: settings.showLights,
    setShowLights,
    showElves: settings.showElves,
    setShowElves
  }

  return (
    <WinterThemeContext.Provider value={contextValue}>
      {children}

      {mounted &&
        settings.active &&
        createPortal(
          <div className="winter-theme-overlay" aria-hidden="true">
            {/* Snow */}
            <div className="winter-snow-container">
              {snowflakes.map((flake) => (
                <Snowflake
                  key={`snow-${flake.id}`}
                  char={flake.char}
                  style={flake.style}
                />
              ))}
            </div>

            {/* Christmas Lights */}
            {settings.showLights && <ChristmasLights />}

            {/* Sparkles */}
            <SparkleEffect />

            {/* Floating Gifts */}
            <FloatingGifts />

            {/* Clickable Presents */}
            <RandomPresents />

            {/* Santa Easter Egg */}
            <SantaEasterEgg />

            {/* Corner Decorations */}
            <div className="winter-corner-decoration winter-corner-bl">
              <SnowmanDecoration />
            </div>
            <div className="winter-corner-decoration winter-corner-br">
              <ChristmasTree />
            </div>

            {/* Hidden Elves */}
            {settings.showElves && (
              <>
                <HiddenElf position="left" />
                <HiddenElf position="right" />
                <HiddenElf position="bottom-left" />
                <HiddenElf position="bottom-right" />
              </>
            )}

            {/* Fireworks triggered by clicks */}
            <FireworksDisplay fireworks={fireworks} />
          </div>,
          document.body
        )}

      <style jsx global>{`
        .winter-theme-overlay {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 9999;
          overflow: hidden;
        }

        .winter-snow-container {
          position: absolute;
          inset: 0;
          overflow: hidden;
        }

        .winter-snowflake {
          position: absolute;
          top: -20px;
          color: white;
          text-shadow: 0 0 5px rgba(255, 255, 255, 0.8);
          animation: winter-fall linear infinite;
          user-select: none;
        }

        @keyframes winter-fall {
          0% {
            transform: translateY(-20px) rotate(0deg);
          }
          100% {
            transform: translateY(100vh) rotate(360deg);
          }
        }

        .winter-lights-container {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 30px;
          z-index: 10000;
        }

        .winter-lights-wire {
          position: absolute;
          top: 5px;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            #333 5%,
            #333 95%,
            transparent 100%
          );
          border-radius: 2px;
        }

        .winter-light-bulb {
          position: absolute;
          top: 8px;
          width: 12px;
          height: 16px;
          background: var(--bulb-color);
          border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
          box-shadow:
            0 0 10px var(--bulb-color),
            0 0 20px var(--bulb-color),
            0 0 30px var(--bulb-color);
          animation: winter-bulb-glow 1s ease-in-out infinite alternate;
          transform: translateX(-50%);
        }

        .winter-light-bulb::before {
          content: '';
          position: absolute;
          top: -4px;
          left: 50%;
          transform: translateX(-50%);
          width: 6px;
          height: 6px;
          background: #444;
          border-radius: 2px;
        }

        @keyframes winter-bulb-glow {
          0% {
            opacity: 0.6;
            filter: brightness(0.8);
          }
          100% {
            opacity: 1;
            filter: brightness(1.2);
          }
        }

        .winter-sparkle {
          position: fixed;
          font-size: 20px;
          animation: winter-sparkle-pop 1.5s ease-out forwards;
          pointer-events: none;
        }

        @keyframes winter-sparkle-pop {
          0% {
            transform: scale(0) rotate(0deg);
            opacity: 0;
          }
          50% {
            transform: scale(1.2) rotate(180deg);
            opacity: 1;
          }
          100% {
            transform: scale(0) rotate(360deg);
            opacity: 0;
          }
        }

        .winter-santa-sleigh {
          position: fixed;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          pointer-events: none;
          z-index: 10001;
        }

        .santa-container {
          display: flex;
          animation: winter-santa-bob 0.5s ease-in-out infinite alternate;
        }

        @keyframes winter-santa-bob {
          0% {
            transform: translateY(0);
          }
          100% {
            transform: translateY(-5px);
          }
        }

        .santa-trail {
          display: flex;
          margin-top: -10px;
        }

        .santa-trail .sparkle {
          animation: winter-trail-fade 0.5s ease-out infinite;
        }

        @keyframes winter-trail-fade {
          0% {
            opacity: 1;
          }
          100% {
            opacity: 0.2;
          }
        }

        .winter-hidden-elf {
          position: fixed;
          z-index: 10000;
          pointer-events: auto;
          cursor: pointer;
        }

        .winter-hidden-elf:hover {
          animation: winter-elf-wave 0.3s ease-in-out infinite;
        }

        @keyframes winter-elf-wave {
          0%,
          100% {
            transform: rotate(-5deg);
          }
          50% {
            transform: rotate(5deg);
          }
        }

        .winter-corner-decoration {
          position: fixed;
          z-index: 9998;
          pointer-events: none;
        }

        .winter-corner-bl {
          bottom: 20px;
          left: 20px;
        }

        .winter-corner-br {
          bottom: 20px;
          right: 20px;
        }

        .winter-snowman {
          position: relative;
          animation: winter-snowman-sway 3s ease-in-out infinite;
        }

        @keyframes winter-snowman-sway {
          0%,
          100% {
            transform: rotate(-2deg);
          }
          50% {
            transform: rotate(2deg);
          }
        }

        .snowman-sparkle {
          position: absolute;
          top: -10px;
          right: -5px;
          animation: winter-sparkle-float 2s ease-in-out infinite;
        }

        @keyframes winter-sparkle-float {
          0%,
          100% {
            transform: translateY(0) rotate(0deg);
            opacity: 0.5;
          }
          50% {
            transform: translateY(-10px) rotate(180deg);
            opacity: 1;
          }
        }

        .winter-tree {
          position: relative;
        }

        .tree-star {
          position: absolute;
          top: -15px;
          left: 50%;
          transform: translateX(-50%);
        }

        .tree-gifts {
          position: absolute;
          bottom: -20px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 2px;
        }

        /* Floating Gifts */
        .winter-floating-gift {
          position: fixed;
          top: -50px;
          animation: gift-float linear forwards;
          pointer-events: none;
          z-index: 9997;
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
        }

        @keyframes gift-float {
          0% {
            transform: translateY(0) rotate(0deg);
          }
          25% {
            transform: translateY(25vh) rotate(10deg);
          }
          50% {
            transform: translateY(50vh) rotate(-10deg);
          }
          75% {
            transform: translateY(75vh) rotate(10deg);
          }
          100% {
            transform: translateY(110vh) rotate(0deg);
          }
        }

        /* Clickable Presents */
        .winter-clickable-present {
          position: fixed;
          z-index: 10000;
          pointer-events: auto;
          animation: present-bob 2s ease-in-out infinite;
          filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.4));
        }

        @keyframes present-bob {
          0%,
          100% {
            transform: translateY(0) rotate(-3deg);
          }
          50% {
            transform: translateY(-8px) rotate(3deg);
          }
        }

        .winter-clickable-present:hover {
          animation: present-shake 0.3s ease-in-out infinite;
        }

        @keyframes present-shake {
          0%,
          100% {
            transform: rotate(-5deg);
          }
          50% {
            transform: rotate(5deg);
          }
        }

        .winter-present-burst {
          position: fixed;
          z-index: 10001;
          pointer-events: none;
        }

        .present-sparkle {
          position: absolute;
          font-size: 24px;
          animation: present-burst 0.8s ease-out forwards;
        }

        @keyframes present-burst {
          0% {
            transform: rotate(var(--angle)) translateY(0) scale(1);
            opacity: 1;
          }
          100% {
            transform: rotate(var(--angle)) translateY(60px) scale(0);
            opacity: 0;
          }
        }

        /* Theme classes for elements */
        .winter-glow {
          text-shadow:
            0 0 10px rgba(100, 200, 255, 0.5),
            0 0 20px rgba(100, 200, 255, 0.3);
        }

        .winter-frost-border {
          border: 2px solid rgba(200, 230, 255, 0.3) !important;
          box-shadow:
            inset 0 0 20px rgba(200, 230, 255, 0.1),
            0 0 10px rgba(200, 230, 255, 0.2);
        }

        /* Fireworks */
        .winter-firework {
          position: fixed;
          pointer-events: none;
          z-index: 10002;
          transform: translate(-50%, -50%);
        }

        .firework-burst {
          position: relative;
          width: 100px;
          height: 100px;
        }

        .firework-particle {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 8px;
          height: 8px;
          background: var(--fw-color, #ff0000);
          border-radius: 50%;
          box-shadow:
            0 0 6px var(--fw-color, #ff0000),
            0 0 12px var(--fw-color, #ff0000);
          animation: firework-explode 1s ease-out forwards;
          transform-origin: center;
        }

        @keyframes firework-explode {
          0% {
            transform: translate(-50%, -50%) rotate(var(--angle)) translateY(0);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) rotate(var(--angle))
              translateY(var(--distance));
            opacity: 0;
          }
        }

        .firework-sparkles {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }

        .firework-sparkle {
          position: absolute;
          font-size: 16px;
          animation: firework-sparkle-fly 1.2s ease-out forwards;
        }

        @keyframes firework-sparkle-fly {
          0% {
            transform: rotate(var(--angle)) translateY(0);
            opacity: 1;
          }
          100% {
            transform: rotate(var(--angle)) translateY(80px);
            opacity: 0;
          }
        }
      `}</style>
    </WinterThemeContext.Provider>
  )
}
