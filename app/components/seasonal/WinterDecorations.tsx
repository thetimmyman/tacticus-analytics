'use client'

// Styles live in WinterThemeProvider's global style block, which mounts with them.

import React, { useState, useEffect } from 'react'
import {
  Gift,
  Search,
  Snowflake as SnowflakeIcon,
  Sparkles,
  Star,
  TreePine
} from 'lucide-react'

export function Snowflake({
  style,
  char
}: {
  style: React.CSSProperties
  char: string
}) {
  return (
    <div className="winter-snowflake" style={style}>
      {char}
    </div>
  )
}

export function ChristmasLights() {
  const colors = [
    '#ff0000',
    '#00ff00',
    '#ffff00',
    '#0088ff',
    '#ff00ff',
    '#ff8800'
  ]
  const bulbCount = 20

  const bulbs = Array.from({ length: bulbCount }, (_, i) => ({
    id: `bulb-position-${i}`,
    position: (i / bulbCount) * 100,
    delay: i * 0.15,
    color: colors[i % colors.length]
  }))

  return (
    <div className="winter-lights-container">
      <div className="winter-lights-wire" />
      {bulbs.map((bulb) => (
        <div
          key={bulb.id}
          className="winter-light-bulb"
          style={
            {
              left: `${bulb.position}%`,
              animationDelay: `${bulb.delay}s`,
              '--bulb-color': bulb.color
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

export function HiddenElf({
  position
}: {
  position: 'left' | 'right' | 'bottom-left' | 'bottom-right'
}) {
  const [isVisible, setIsVisible] = useState(false)
  const [isPeeking, setIsPeeking] = useState(false)
  const peekIntervalRef = React.useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const showTimer = setTimeout(
      () => {
        setIsVisible(true)
        peekIntervalRef.current = setInterval(
          () => {
            setIsPeeking((prev) => !prev)
          },
          2000 + Math.random() * 3000
        )
      },
      Math.random() * 10000 + 5000
    )

    return () => {
      clearTimeout(showTimer)
      if (peekIntervalRef.current) clearInterval(peekIntervalRef.current)
    }
  }, [])

  if (!isVisible) return null

  const positionStyles: Record<string, React.CSSProperties> = {
    left: {
      left: '-20px',
      top: '30%',
      transform: isPeeking ? 'translateX(15px)' : 'translateX(0)'
    },
    right: {
      right: '-20px',
      top: '40%',
      transform: isPeeking
        ? 'translateX(-15px) scaleX(-1)'
        : 'translateX(0) scaleX(-1)'
    },
    'bottom-left': {
      left: '10%',
      bottom: '-15px',
      transform: isPeeking ? 'translateY(-10px)' : 'translateY(0)'
    },
    'bottom-right': {
      right: '10%',
      bottom: '-15px',
      transform: isPeeking ? 'translateY(-10px)' : 'translateY(0)'
    }
  }

  return (
    <div
      className="winter-hidden-elf"
      style={{
        ...positionStyles[position],
        transition: 'transform 0.5s ease-in-out'
      }}
      title="You found an elf!"
    >
      <span className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-green-500/20 text-green-200 hover:scale-125 transition-transform">
        <Search className="h-4 w-4" />
      </span>
    </div>
  )
}

export function SantaEasterEgg() {
  const [showSanta, setShowSanta] = useState(false)
  const [santaPosition, setSantaPosition] = useState(0)
  const flyIntervalRef = React.useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const santaTimer = setInterval(() => {
      if (Math.random() < 0.1) {
        setShowSanta(true)
        setSantaPosition(-100)

        if (flyIntervalRef.current) clearInterval(flyIntervalRef.current)

        flyIntervalRef.current = setInterval(() => {
          setSantaPosition((prev) => {
            if (prev > window.innerWidth + 200) {
              if (flyIntervalRef.current) {
                clearInterval(flyIntervalRef.current)
                flyIntervalRef.current = null
              }
              setShowSanta(false)
              return prev
            }
            return prev + 3
          })
        }, 16)
      }
    }, 30000)

    return () => {
      clearInterval(santaTimer)
      if (flyIntervalRef.current) clearInterval(flyIntervalRef.current)
    }
  }, [])

  if (!showSanta) return null

  return (
    <div
      className="winter-santa-sleigh"
      style={{
        left: `${santaPosition}px`,
        top: '10%'
      }}
    >
      <div className="santa-container">
        <span className="rounded-full bg-red-500/80 px-2 py-1 text-xs font-bold uppercase tracking-wide text-white">
          Santa
        </span>
        <Gift className="-ml-1 h-7 w-7 text-red-300" />
        <TreePine className="-ml-1 h-7 w-7 text-green-300" />
        <Gift className="-ml-1 h-7 w-7 text-red-300" />
      </div>
      <div className="santa-trail">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((sparkleIndex) => (
          <span
            key={`santa-trail-sparkle-${sparkleIndex}`}
            className="sparkle"
            style={{
              animationDelay: `${sparkleIndex * 0.1}s`,
              opacity: 1 - sparkleIndex * 0.1
            }}
          >
            <Sparkles className="h-3 w-3" />
          </span>
        ))}
      </div>
    </div>
  )
}

export function SparkleEffect() {
  const [sparkles, setSparkles] = useState<
    Array<{ id: number; x: number; y: number }>
  >([])
  const timeoutsRef = React.useRef<Set<NodeJS.Timeout>>(new Set())

  useEffect(() => {
    const currentTimeouts = timeoutsRef.current
    const interval = setInterval(() => {
      if (Math.random() < 0.3) {
        const newSparkle = {
          id: Date.now(),
          x: Math.random() * 100,
          y: Math.random() * 100
        }
        setSparkles((prev) => [...prev.slice(-10), newSparkle])

        const timeout = setTimeout(() => {
          setSparkles((prev) => prev.filter((s) => s.id !== newSparkle.id))
          currentTimeouts.delete(timeout)
        }, 1500)
        currentTimeouts.add(timeout)
      }
    }, 500)

    return () => {
      clearInterval(interval)
      currentTimeouts.forEach(clearTimeout)
      currentTimeouts.clear()
    }
  }, [])

  return (
    <>
      {sparkles.map((sparkle) => (
        <div
          key={sparkle.id}
          className="winter-sparkle"
          style={{
            left: `${sparkle.x}%`,
            top: `${sparkle.y}%`
          }}
        >
          <Star className="h-4 w-4 fill-current" />
        </div>
      ))}
    </>
  )
}

export function SnowmanDecoration() {
  return (
    <div className="winter-snowman">
      <div className="snowman-body">
        <div className="flex flex-col items-center">
          <div className="h-5 w-5 rounded-full bg-white/90 border border-blue-100" />
          <div className="h-8 w-8 -mt-1 rounded-full bg-white/90 border border-blue-100" />
          <div className="h-11 w-11 -mt-1 rounded-full bg-white/90 border border-blue-100" />
        </div>
      </div>
      <div className="snowman-sparkle">
        <SnowflakeIcon className="h-4 w-4 text-blue-200" />
      </div>
    </div>
  )
}

export function ChristmasTree() {
  return (
    <div className="winter-tree">
      <TreePine className="h-16 w-16 text-green-300" />
      <div className="tree-star">
        <Star className="h-6 w-6 animate-pulse fill-current text-yellow-300" />
      </div>
      <div className="tree-gifts">
        <Gift className="h-6 w-6 text-red-300" />
        <Sparkles className="h-5 w-5 text-pink-300" />
        <Gift className="h-6 w-6 text-red-300" />
      </div>
    </div>
  )
}
