'use client'

import { useCallback, useEffect, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import Autoplay from 'embla-carousel-autoplay'
import Link from 'next/link'
import {
  Megaphone,
  Gift,
  Sparkles,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Snowflake,
  Copy,
  Check,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { WinterCarouselEasterEgg } from '@/app/components/seasonal'

export interface NewsItem {
  id: string
  type: 'feature' | 'promo' | 'announcement' | 'seasonal'
  title: string
  description: string
  href?: string
  external?: boolean
  expiresAt?: Date
  promoCode?: string
}

interface NewsBannerProps {
  items: NewsItem[]
}

const getTypeConfig = (type: NewsItem['type']) => {
  switch (type) {
    case 'feature':
      return {
        icon: <Sparkles className="h-5 w-5" />,
        bgClass: 'from-blue-500/20 via-blue-600/10 to-blue-500/20',
        borderClass: 'border-blue-500/40',
        iconBgClass: 'bg-blue-500/20',
        iconColor: 'text-blue-400',
        label: 'New Feature'
      }
    case 'promo':
      return {
        icon: <Gift className="h-5 w-5" />,
        bgClass: 'from-emerald-500/20 via-emerald-600/10 to-emerald-500/20',
        borderClass: 'border-emerald-500/40',
        iconBgClass: 'bg-emerald-500/20',
        iconColor: 'text-emerald-400',
        label: 'Promo Code'
      }
    case 'seasonal':
      return {
        icon: <Snowflake className="h-5 w-5" />,
        bgClass: 'from-cyan-500/20 via-blue-600/10 to-cyan-500/20',
        borderClass: 'border-cyan-500/40',
        iconBgClass: 'bg-cyan-500/20',
        iconColor: 'text-cyan-400',
        label: 'Seasonal'
      }
    case 'announcement':
    default:
      return {
        icon: <Megaphone className="h-5 w-5" />,
        bgClass: 'from-amber-500/20 via-amber-600/10 to-amber-500/20',
        borderClass: 'border-amber-500/40',
        iconBgClass: 'bg-amber-500/20',
        iconColor: 'text-amber-400',
        label: 'Announcement'
      }
  }
}

export default function NewsBanner({ items }: NewsBannerProps) {
  const [isPaused, setIsPaused] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const toggleExpanded = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setExpandedItems((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }, [])

  const copyPromoCode = useCallback((code: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }, [])

  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: true, skipSnaps: false },
    [
      Autoplay({
        delay: 6000,
        stopOnInteraction: false,
        stopOnMouseEnter: true
      })
    ]
  )

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi])
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi])
  const scrollTo = useCallback(
    (index: number) => emblaApi?.scrollTo(index),
    [emblaApi]
  )

  const toggleAutoplay = useCallback(() => {
    const autoplay = emblaApi?.plugins()?.autoplay
    if (!autoplay) return

    if (isPaused) {
      autoplay.play()
    } else {
      autoplay.stop()
    }
    setIsPaused(!isPaused)
  }, [emblaApi, isPaused])

  const onSelect = useCallback(() => {
    if (!emblaApi) return
    setSelectedIndex(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  useEffect(() => {
    if (!emblaApi) return
    onSelect()
    emblaApi.on('select', onSelect)
    return () => {
      emblaApi.off('select', onSelect)
    }
  }, [emblaApi, onSelect])

  if (items.length === 0) return null

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-xl" ref={emblaRef}>
        <div className="flex">
          {items.map((item) => {
            const config = getTypeConfig(item.type)
            const isExpanded = expandedItems.has(item.id)
            const hasLongDescription =
              item.description && item.description.length > 80
            const content = (
              <div
                className={`flex-[0_0_100%] min-w-0 rounded-xl border ${config.borderClass} bg-gradient-to-r ${config.bgClass} p-4 sm:p-5`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${config.iconBgClass}`}
                  >
                    <span className={config.iconColor}>{config.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider ${config.iconColor}`}
                      >
                        {config.label}
                      </span>
                    </div>
                    {/* For promo items with a promo code, show the code prominently */}
                    {item.type === 'promo' && item.promoCode ? (
                      <>
                        <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)]">
                          {item.title}
                        </h3>
                        <button
                          onClick={(e) => copyPromoCode(item.promoCode!, e)}
                          className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/30 border border-emerald-500/50 hover:bg-emerald-500/40 transition-colors"
                        >
                          <span className="font-mono font-bold text-emerald-300 text-sm sm:text-base">
                            {item.promoCode}
                          </span>
                          {copiedCode === item.promoCode ? (
                            <Check className="h-4 w-4 text-emerald-300" />
                          ) : (
                            <Copy className="h-4 w-4 text-emerald-300/70" />
                          )}
                        </button>
                      </>
                    ) : (
                      <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)] truncate">
                        {item.title}
                      </h3>
                    )}
                    {item.description && (
                      <div className="mt-1">
                        <p
                          className={`text-sm text-[var(--text-secondary)] ${!isExpanded ? 'line-clamp-2' : ''}`}
                        >
                          {item.description}
                        </p>
                        {hasLongDescription && (
                          <button
                            onClick={(e) => toggleExpanded(item.id, e)}
                            className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="h-3 w-3" />
                                Show less
                              </>
                            ) : (
                              <>
                                <ChevronDown className="h-3 w-3" />
                                Show more
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {item.href && (
                    <div className="shrink-0 self-center">
                      {item.external ? (
                        <ExternalLink className="h-5 w-5 text-[var(--text-secondary)]" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-[var(--text-secondary)]" />
                      )}
                    </div>
                  )}
                </div>
              </div>
            )

            return item.href ? (
              <Link
                key={item.id}
                href={item.href}
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener noreferrer' : undefined}
                className="flex-[0_0_100%] min-w-0 block transition-opacity hover:opacity-90"
              >
                {content}
              </Link>
            ) : (
              <div key={item.id} className="flex-[0_0_100%] min-w-0">
                {content}
              </div>
            )
          })}
        </div>
      </div>

      {items.length > 1 && (
        <div className="flex items-center justify-between mt-3 px-1">
          <div className="flex items-center gap-2">
            <button
              onClick={scrollPrev}
              className="p-1.5 rounded-full border border-[var(--card-border)] bg-card/50 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
              aria-label="Previous slide"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={scrollNext}
              className="p-1.5 rounded-full border border-[var(--card-border)] bg-card/50 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
              aria-label="Next slide"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={toggleAutoplay}
              className="p-1.5 rounded-full border border-[var(--card-border)] bg-card/50 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
              aria-label={isPaused ? 'Resume autoplay' : 'Pause autoplay'}
            >
              {isPaused ? (
                <Play className="h-4 w-4" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
            </button>
            <WinterCarouselEasterEgg />
          </div>

          <div className="flex items-center">
            {items.map((item, index) => (
              <button
                key={item.id}
                onClick={() => scrollTo(index)}
                className="flex h-6 min-w-6 items-center justify-center px-0.5"
                aria-label={`Go to slide ${index + 1}`}
                aria-current={index === selectedIndex}
              >
                <span
                  className={`block h-2 rounded-full transition-all ${
                    index === selectedIndex
                      ? 'w-6 bg-[var(--accent)]'
                      : 'w-2 bg-[var(--card-border)] hover:bg-[var(--text-secondary)]'
                  }`}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
