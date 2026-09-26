'use client'

// Styles live in WinterThemeProvider's global style block, which mounts with them.

import React, { useState, useEffect } from 'react'
import {
  Bell,
  Gift,
  Snowflake as SnowflakeIcon,
  Sparkles,
  Star,
  TreePine
} from 'lucide-react'

type WinterFloatingIcon = 'gift' | 'tree' | 'star' | 'bell' | 'sparkle' | 'snow'

const WINTER_FLOATING_ICONS = {
  gift: Gift,
  tree: TreePine,
  star: Star,
  bell: Bell,
  sparkle: Sparkles,
  snow: SnowflakeIcon
} as const

export function FloatingGifts() {
  const [gifts, setGifts] = useState<
    Array<{
      id: number
      x: number
      icon: WinterFloatingIcon
      delay: number
      duration: number
    }>
  >([])
  const timeoutsRef = React.useRef<Set<NodeJS.Timeout>>(new Set())

  useEffect(() => {
    const currentTimeouts = timeoutsRef.current
    const giftIcons: WinterFloatingIcon[] = [
      'gift',
      'sparkle',
      'tree',
      'star',
      'bell',
      'snow'
    ]

    const spawnGift = () => {
      if (Math.random() < 0.3) {
        const icon =
          giftIcons[Math.floor(Math.random() * giftIcons.length)] ?? 'gift'
        const newGift = {
          id: Date.now() + Math.random(),
          x: Math.random() * 100,
          icon,
          delay: Math.random() * 2,
          duration: 15 + Math.random() * 10
        }

        setGifts((prev) => [...prev.slice(-8), newGift])

        const timeout = setTimeout(
          () => {
            setGifts((prev) => prev.filter((g) => g.id !== newGift.id))
            currentTimeouts.delete(timeout)
          },
          (newGift.duration + newGift.delay) * 1000
        )
        currentTimeouts.add(timeout)
      }
    }

    const interval = setInterval(spawnGift, 3000)
    spawnGift()

    return () => {
      clearInterval(interval)
      currentTimeouts.forEach(clearTimeout)
      currentTimeouts.clear()
    }
  }, [])

  return (
    <>
      {gifts.map((gift) => (
        <div
          key={gift.id}
          className="winter-floating-gift"
          style={{
            left: `${gift.x}%`,
            animationDuration: `${gift.duration}s`,
            animationDelay: `${gift.delay}s`
          }}
        >
          {(() => {
            const FloatingIcon = WINTER_FLOATING_ICONS[gift.icon]
            return <FloatingIcon className="h-8 w-8 text-red-200" />
          })()}
        </div>
      ))}
    </>
  )
}

function ClickablePresent({
  x,
  y,
  onCollect
}: {
  x: number
  y: number
  onCollect: () => void
}) {
  const [isCollected, setIsCollected] = useState(false)

  const handleClick = () => {
    if (!isCollected) {
      setIsCollected(true)
      onCollect()
    }
  }

  if (isCollected) {
    return (
      <div
        className="winter-present-burst"
        style={{ left: `${x}%`, top: `${y}%` }}
      >
        {[
          { key: 'sparkle', Icon: Sparkles },
          { key: 'star', Icon: Star },
          { key: 'snow', Icon: SnowflakeIcon },
          { key: 'gift', Icon: Gift }
        ].map(({ key, Icon }, i) => (
          <span
            key={key}
            className="present-sparkle"
            style={{ '--angle': `${i * 90}deg` } as React.CSSProperties}
          >
            <Icon className="h-4 w-4" />
          </span>
        ))}
      </div>
    )
  }

  return (
    <div
      className="winter-clickable-present"
      style={{ left: `${x}%`, top: `${y}%` }}
      onClick={handleClick}
    >
      <Gift className="h-10 w-10 cursor-pointer text-red-300 hover:scale-125 transition-transform" />
    </div>
  )
}

export function RandomPresents() {
  const [presents, setPresents] = useState<
    Array<{ id: number; x: number; y: number }>
  >([])
  const timeoutsRef = React.useRef<Set<NodeJS.Timeout>>(new Set())

  useEffect(() => {
    const currentTimeouts = timeoutsRef.current
    const spawnPresent = () => {
      if (presents.length < 3 && Math.random() < 0.2) {
        const newPresent = {
          id: Date.now(),
          x: 10 + Math.random() * 80,
          y: 20 + Math.random() * 60
        }
        setPresents((prev) => [...prev, newPresent])
      }
    }

    const interval = setInterval(spawnPresent, 8000)
    const initialTimeout = setTimeout(spawnPresent, 2000)
    currentTimeouts.add(initialTimeout)

    return () => {
      clearInterval(interval)
      currentTimeouts.forEach(clearTimeout)
      currentTimeouts.clear()
    }
  }, [presents.length])

  const collectPresent = (id: number) => {
    const timeout = setTimeout(() => {
      setPresents((prev) => prev.filter((p) => p.id !== id))
      timeoutsRef.current.delete(timeout)
    }, 800)
    timeoutsRef.current.add(timeout)
  }

  return (
    <>
      {presents.map((present) => (
        <ClickablePresent
          key={present.id}
          x={present.x}
          y={present.y}
          onCollect={() => collectPresent(present.id)}
        />
      ))}
    </>
  )
}

export interface Firework {
  id: number
  x: number
  y: number
  color: string
  particles: Array<{ angle: number; distance: number; delay: number }>
}

export function FireworksDisplay({ fireworks }: { fireworks: Firework[] }) {
  return (
    <>
      {fireworks.map((fw) => (
        <div
          key={fw.id}
          className="winter-firework"
          style={{ left: `${fw.x}px`, top: `${fw.y}px` }}
        >
          <div
            className="firework-burst"
            style={{ '--fw-color': fw.color } as React.CSSProperties}
          >
            {fw.particles.map((p) => (
              <div
                key={`${p.angle}-${p.distance}`}
                className="firework-particle"
                style={
                  {
                    '--angle': `${p.angle}deg`,
                    '--distance': `${p.distance}px`,
                    animationDelay: `${p.delay}s`
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
          <div className="firework-sparkles">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, angleIndex) => (
              <span
                key={`fw-sparkle-angle-${angle}`}
                className="firework-sparkle"
                style={
                  {
                    '--angle': `${angle}deg`,
                    animationDelay: `${angleIndex * 0.05}s`
                  } as React.CSSProperties
                }
              >
                <Sparkles className="h-3 w-3" />
              </span>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
