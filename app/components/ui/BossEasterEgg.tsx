'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.ui.BossEasterEgg')
import {
  bossEasterEggConfigs,
  defaultEasterEggConfig,
  type BossEasterEggConfig,
  type BossIntervention,
  type VisualEffectType
} from '@/app/lib/config/boss-easter-eggs'
import { useBossEasterEggSafe } from '@/app/components/seasonal/BossEasterEggProvider'
import { BossEasterEggInterventionMessage } from '@/app/components/ui/BossEasterEggInterventionMessage'
import { BossEasterEggVisualEffectsPartOne } from '@/app/components/ui/BossEasterEggVisualEffectsPartOne'
import { BossEasterEggVisualEffectsPartTwo } from '@/app/components/ui/BossEasterEggVisualEffectsPartTwo'

interface BossEasterEggProps {
  children: ReactNode
  bossName?: string
  triggerRefs?: RefObject<HTMLElement | null>[]
}

export function BossEasterEgg({
  children,
  bossName,
  triggerRefs
}: BossEasterEggProps) {
  const { isBossEasterEggEnabled } = useBossEasterEggSafe()
  const [isGlitching, setIsGlitching] = useState(false)
  const [showMessage, setShowMessage] = useState(false)
  const [currentIntervention, setCurrentIntervention] =
    useState<BossIntervention | null>(null)
  const [config, setConfig] = useState<BossEasterEggConfig>(
    defaultEasterEggConfig
  )
  const [activeVisualEffect, setActiveVisualEffect] =
    useState<VisualEffectType | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const interventionCount = useRef(0)
  const shownInterventions = useRef<Set<number>>(new Set())
  const lastTriggerTime = useRef(0)

  useEffect(() => {
    let nextConfig = defaultEasterEggConfig

    if (bossName) {
      const configKey = bossName.toLowerCase()
      const bossConfig = bossEasterEggConfigs[configKey]

      logger.debug(
        { configKey: configKey },
        'BossEasterEgg: Looking for boss config:'
      )
      logger.debug({ data: !!bossConfig }, 'BossEasterEgg: Config found:')

      if (bossConfig) {
        nextConfig = bossConfig
      }
    }

    // Deferred to avoid a synchronous setState in the effect.
    const id = setTimeout(() => {
      setConfig(nextConfig)
    }, 0)

    return () => {
      clearTimeout(id)
    }
  }, [bossName])

  const applyTranslations = useCallback(() => {
    if (!containerRef.current) return

    const walker = document.createTreeWalker(
      containerRef.current,
      NodeFilter.SHOW_TEXT,
      null
    )

    const textNodes: Text[] = []
    let node: Node | null

    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.trim()) {
        textNodes.push(node as Text)
      }
    }

    textNodes.forEach((textNode) => {
      if (
        textNode.nodeValue &&
        !textNode.nodeValue.startsWith('__ORIGINAL__')
      ) {
        const original = textNode.nodeValue
        let translated = original

        config.translations.forEach(({ original: pattern, translation }) => {
          translated = translated.replace(pattern, translation)
        })

        if (translated !== original) {
          textNode.nodeValue = `__ORIGINAL__${original}__TRANSLATED__${translated}`
          setTimeout(() => {
            if (textNode.nodeValue?.includes('__TRANSLATED__')) {
              textNode.nodeValue = translated
            }
          }, 100)
        }
      }
    })
  }, [config])

  const revertTranslations = useCallback(() => {
    if (!containerRef.current) return

    const walker = document.createTreeWalker(
      containerRef.current,
      NodeFilter.SHOW_TEXT,
      null
    )

    const textNodes: Text[] = []
    let node: Node | null

    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes('__ORIGINAL__')) {
        textNodes.push(node as Text)
      }
    }

    textNodes.forEach((textNode) => {
      if (textNode.nodeValue?.includes('__ORIGINAL__')) {
        const match = textNode.nodeValue.match(
          /__ORIGINAL__(.+?)__TRANSLATED__/
        )
        // The capture group always exists on a match but is typed `string | undefined`;
        // skip rather than coerce (`?? null` would blank the node).
        const original = match?.[1]
        if (original !== undefined) {
          textNode.nodeValue = original
        }
      }
    })
  }, [])

  const applyInterventionEffect = useCallback(
    (intervention: BossIntervention) => {
      switch (intervention.type) {
        case 'glitch':
        case 'data_corruption':
        case 'system_alert':
        case 'psychic_vision':
        case 'biomass_hunger':
        case 'waaagh_energy':
          setIsGlitching(true)
          applyTranslations()
          setTimeout(() => {
            revertTranslations()
            setIsGlitching(false)
          }, intervention.duration)
          break

        case 'warning':
        case 'disapproval':
        case 'tactical_override':
          setIsGlitching(true)
          if (intervention.glitchIntensity === 'heavy') {
            applyTranslations()
          }
          setTimeout(() => {
            if (intervention.glitchIntensity === 'heavy') {
              revertTranslations()
            }
            setIsGlitching(false)
          }, intervention.duration)
          break

        case 'analysis':
        case 'inspection':
        case 'curiosity':
        case 'ancient_wisdom':
          if (intervention.glitchIntensity !== 'none') {
            setIsGlitching(true)
            setTimeout(() => {
              setIsGlitching(false)
            }, intervention.duration * 0.6)
          }
          break

        default:
          if (intervention.glitchIntensity !== 'none') {
            setIsGlitching(true)
            setTimeout(() => {
              setIsGlitching(false)
            }, intervention.duration * 0.4)
          }
      }
    },
    [applyTranslations, revertTranslations]
  )

  const triggerVisualEffect = useCallback(() => {
    if (!config.visualEffects?.length) return

    for (const effect of config.visualEffects) {
      if (Math.random() < effect.chance) {
        setActiveVisualEffect(effect.type)
        setTimeout(() => {
          setActiveVisualEffect(null)
        }, effect.duration)
        break // Only one effect at a time
      }
    }
  }, [config.visualEffects])

  const performIntervention = useCallback(() => {
    const interventions = config.interventions
    if (!interventions.length) return

    let randomIndex: number
    const maxAttempts = 10
    let attempts = 0

    do {
      randomIndex = Math.floor(Math.random() * interventions.length)
      attempts++
    } while (
      shownInterventions.current.has(randomIndex) &&
      attempts < maxAttempts &&
      shownInterventions.current.size < interventions.length
    )

    shownInterventions.current.add(randomIndex)

    if (shownInterventions.current.size >= interventions.length) {
      shownInterventions.current.clear()
    }

    const intervention = interventions[randomIndex]
    if (!intervention) return
    interventionCount.current++

    setCurrentIntervention(intervention)
    setShowMessage(true)

    setTimeout(() => {
      setShowMessage(false)
      setTimeout(() => {
        applyInterventionEffect(intervention)
        triggerVisualEffect()
      }, 500)
    }, 4000)
  }, [config, applyInterventionEffect, triggerVisualEffect])

  useEffect(() => {
    if (!triggerRefs || !isBossEasterEggEnabled) return

    const handleClick = () => {
      const now = Date.now()
      if (now - lastTriggerTime.current < 15000) return // 15 second cooldown

      lastTriggerTime.current = now
      performIntervention()
    }

    const elements: HTMLElement[] = []

    triggerRefs.forEach((ref) => {
      if (ref.current) {
        const element = ref.current
        elements.push(element)
        element.addEventListener('click', handleClick)
        element.style.cursor = 'pointer'
        element.title = `Click to trigger ${config.bossName} easter egg`
      }
    })

    return () => {
      elements.forEach((element) => {
        element.removeEventListener('click', handleClick)
        element.style.cursor = ''
        element.title = ''
      })
    }
  }, [triggerRefs, config, performIntervention, isBossEasterEggEnabled])

  useEffect(() => {
    if (!isBossEasterEggEnabled) return

    let timeoutId: NodeJS.Timeout | null = null
    let intervalId: NodeJS.Timeout | null = null

    const triggerIntervention = () => {
      const chance = Math.random()
      const threshold = 0.1 // 10% chance per interval

      if (chance < threshold) {
        performIntervention()
      }
    }

    const initialDelay = 15000 + Math.random() * 15000

    timeoutId = setTimeout(() => {
      triggerIntervention()
      intervalId = setInterval(triggerIntervention, 120000)
    }, initialDelay)

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [performIntervention, isBossEasterEggEnabled])

  const getGlitchClass = useCallback(() => {
    if (!currentIntervention) return ''

    switch (currentIntervention.glitchIntensity) {
      case 'light':
        return 'boss-glitch-light'
      case 'medium':
        return 'boss-glitch-medium'
      case 'heavy':
        return 'boss-glitch-heavy'
      default:
        return ''
    }
  }, [currentIntervention])

  const getMessageTheme = useCallback(() => {
    const primaryMatch = config.primaryColor.match(/text-(\w+)-/)
    const primaryBase = primaryMatch ? primaryMatch[1] : 'red'

    return {
      border: `border-${primaryBase}-500`,
      bg: `bg-${primaryBase}-900/50`,
      title: config.titleOverride,
      titleColor: config.primaryColor,
      iconColor: config.secondaryColor
    }
  }, [config])

  const theme = getMessageTheme()

  return (
    <>
      <div ref={containerRef} className={isGlitching ? getGlitchClass() : ''}>
        {children}
      </div>

      {/* Unified intervention indicator */}
      {showMessage && currentIntervention && (
        <BossEasterEggInterventionMessage
          config={config}
          currentIntervention={currentIntervention}
          theme={theme}
        />
      )}

      {/* Visual Effects Overlays */}
      {activeVisualEffect && (
        <>
          <BossEasterEggVisualEffectsPartOne
            activeVisualEffect={activeVisualEffect}
          />
          <BossEasterEggVisualEffectsPartTwo
            activeVisualEffect={activeVisualEffect}
          />
        </>
      )}

      {/* Glitch effects styles */}
      <style jsx>{`
        .boss-glitch-light {
          animation: boss-glitch-light 0.2s infinite;
        }

        .boss-glitch-medium {
          animation: boss-glitch-medium 0.3s infinite;
        }

        .boss-glitch-heavy {
          animation: boss-glitch-heavy 0.15s infinite;
        }

        @keyframes boss-glitch-light {
          0% {
            transform: translate(0);
          }
          50% {
            transform: translate(-0.5px, 0.5px);
          }
          100% {
            transform: translate(0);
          }
        }

        @keyframes boss-glitch-medium {
          0% {
            transform: translate(0);
          }
          20% {
            transform: translate(-1px, 1px);
          }
          40% {
            transform: translate(-1px, -1px);
          }
          60% {
            transform: translate(1px, 1px);
          }
          80% {
            transform: translate(1px, -1px);
          }
          100% {
            transform: translate(0);
          }
        }

        @keyframes boss-glitch-heavy {
          0% {
            transform: translate(0) skew(0deg);
          }
          10% {
            transform: translate(-2px, 2px) skew(1deg);
          }
          20% {
            transform: translate(-2px, -2px) skew(-1deg);
          }
          30% {
            transform: translate(2px, 2px) skew(1deg);
          }
          40% {
            transform: translate(2px, -2px) skew(-1deg);
          }
          50% {
            transform: translate(-1px, 1px) skew(2deg);
          }
          60% {
            transform: translate(-1px, -1px) skew(-2deg);
          }
          70% {
            transform: translate(1px, 1px) skew(1deg);
          }
          80% {
            transform: translate(1px, -1px) skew(-1deg);
          }
          90% {
            transform: translate(-0.5px, 0.5px) skew(0.5deg);
          }
          100% {
            transform: translate(0) skew(0deg);
          }
        }

        /* Text effects */
        .boss-glitch-light * {
          text-shadow:
            0.5px 0 0 red,
            -0.5px 0 0 cyan;
        }

        .boss-glitch-medium * {
          text-shadow:
            1px 0 0 red,
            -1px 0 0 cyan,
            0 1px 0 yellow;
          animation: textGlitch-medium 0.2s infinite;
        }

        .boss-glitch-heavy * {
          text-shadow:
            1px 0 0 red,
            -1px 0 0 cyan,
            0 1px 0 yellow,
            0 -1px 0 blue;
          animation: textGlitch-heavy 0.1s infinite;
        }

        @keyframes textGlitch-medium {
          0% {
            text-shadow:
              1px 0 0 red,
              -1px 0 0 cyan;
            transform: translate(0);
          }
          50% {
            text-shadow:
              -1px 0 0 red,
              1px 0 0 cyan;
            transform: translate(-0.5px);
          }
          100% {
            text-shadow:
              1px 0 0 red,
              -1px 0 0 cyan;
            transform: translate(0);
          }
        }

        @keyframes textGlitch-heavy {
          0% {
            text-shadow:
              1px 0 0 red,
              -1px 0 0 cyan;
            transform: translate(0);
          }
          25% {
            text-shadow:
              -1px 0 0 red,
              1px 0 0 cyan;
            transform: translate(-1px);
          }
          50% {
            text-shadow:
              1px 0 0 cyan,
              -1px 0 0 red;
            transform: translate(1px);
          }
          75% {
            text-shadow:
              -1px 0 0 cyan,
              1px 0 0 red;
            transform: translate(0);
          }
          100% {
            text-shadow:
              1px 0 0 red,
              -1px 0 0 cyan;
            transform: translate(0);
          }
        }
      `}</style>
    </>
  )
}
