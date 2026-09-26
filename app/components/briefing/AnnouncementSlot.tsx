'use client'

/**
 * Mobile-first embla carousel; the slide is the tap target and autoplay honours
 * reduced motion. Tints use inline color-mix because Tailwind drops /N on var().
 */

import { useCallback, useEffect, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import Autoplay from 'embla-carousel-autoplay'
import Link from 'next/link'
import {
  Megaphone,
  Gift,
  Sparkles,
  Copy,
  Check,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  X
} from 'lucide-react'
import type { NewsItem } from '@/app/components/landing/NewsBanner'

interface AnnouncementSlotProps {
  items: NewsItem[]
  /** Separate prop because `NewsItem` is plain serialized DB data. */
  dismissibleIds?: readonly string[]
  /** Only renders when supplied AND the id opts in. */
  onDismissItem?: (id: string) => void
}

function iconFor(type: NewsItem['type']) {
  switch (type) {
    case 'promo':
      return <Gift className="h-5 w-5" aria-hidden />
    case 'feature':
      return <Sparkles className="h-5 w-5" aria-hidden />
    default:
      return <Megaphone className="h-5 w-5" aria-hidden />
  }
}

const LABEL: Record<NewsItem['type'], string> = {
  feature: 'New feature',
  promo: 'Promo code',
  announcement: 'Announcement',
  seasonal: 'Seasonal'
}

const ROTATE_MS = 6000

const accentMix = (percent: number) =>
  `color-mix(in srgb, var(--accent) ${percent}%, transparent)`

export default function AnnouncementSlot({
  items,
  dismissibleIds,
  onDismissItem
}: AnnouncementSlotProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true }, [
    Autoplay({
      delay: ROTATE_MS,
      stopOnInteraction: false,
      stopOnMouseEnter: true
    })
  ])

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi])
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi])
  const scrollTo = useCallback(
    (index: number) => emblaApi?.scrollTo(index),
    [emblaApi]
  )

  const onSelect = useCallback(() => {
    if (!emblaApi) return
    setSelectedIndex(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  // Also 'reInit': removing a slide reInits without 'select'.
  useEffect(() => {
    if (!emblaApi) return
    onSelect()
    emblaApi.on('select', onSelect)
    emblaApi.on('reInit', onSelect)
    return () => {
      emblaApi.off('select', onSelect)
      emblaApi.off('reInit', onSelect)
    }
  }, [emblaApi, onSelect])

  useEffect(() => {
    if (!emblaApi) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      emblaApi.plugins().autoplay?.stop()
    }
  }, [emblaApi])

  const copyCode = useCallback((code: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard?.writeText(code).catch(() => {})
    setCopiedCode(code)
    window.setTimeout(() => setCopiedCode(null), 2000)
  }, [])

  // Inside the slide's <Link>; both calls stop navigation.
  const dismissItem = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDismissItem?.(id)
    },
    [onDismissItem]
  )

  const count = items.length
  if (count === 0) return null

  // Clamp for a shrinking list so survivors stay keyboard-reachable; derived, not an effect.
  const activeIndex = Math.min(selectedIndex, count - 1)

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Announcements"
      className="group overflow-hidden rounded-xl border"
      style={{
        borderColor: accentMix(25),
        backgroundColor: accentMix(6)
      }}
    >
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex touch-pan-y">
          {items.map((item, i) => {
            const isActive = i === activeIndex
            const isDismissible = Boolean(
              onDismissItem && dismissibleIds?.includes(item.id)
            )
            const inner = (
              <div className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--accent)]"
                  style={{ backgroundColor: accentMix(14) }}
                >
                  {iconFor(item.type)}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-2xs font-bold uppercase tracking-wider text-[var(--accent)]">
                    {LABEL[item.type]}
                  </p>
                  <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    {item.title}
                  </p>
                  {item.description && !item.promoCode && (
                    <p className="truncate text-xs text-[var(--text-secondary)]">
                      {item.description}
                    </p>
                  )}
                  {item.promoCode && (
                    <button
                      type="button"
                      onClick={(e) => copyCode(item.promoCode!, e)}
                      tabIndex={isActive ? 0 : -1}
                      className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-dashed px-2 py-0.5 font-mono text-xs text-[var(--text-primary)] transition-colors duration-fast hover:bg-[var(--bg-primary)]"
                      style={{ borderColor: accentMix(50) }}
                    >
                      <span className="truncate">{item.promoCode}</span>
                      {copiedCode === item.promoCode ? (
                        <Check
                          className="h-3.5 w-3.5 shrink-0 text-[var(--success)]"
                          aria-hidden
                        />
                      ) : (
                        <Copy
                          className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]"
                          aria-hidden
                        />
                      )}
                    </button>
                  )}
                </div>

                {item.href && (
                  <span
                    className="shrink-0 text-[var(--text-tertiary)] transition-colors duration-fast group-hover:text-[var(--accent)]"
                    aria-hidden
                  >
                    {item.external ? (
                      <ExternalLink className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </span>
                )}

                {isDismissible && (
                  <button
                    type="button"
                    onClick={(e) => dismissItem(item.id, e)}
                    tabIndex={isActive ? 0 : -1}
                    aria-label={`Dismiss: ${item.title}`}
                    className="shrink-0 rounded-md p-1 text-[var(--text-tertiary)] transition-colors duration-fast hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>
            )

            const slideProps = {
              role: 'group',
              'aria-roledescription': 'slide',
              'aria-label': `${i + 1} of ${count}`
            } as const

            return item.href ? (
              <Link
                key={item.id}
                href={item.href}
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener noreferrer' : undefined}
                tabIndex={isActive ? 0 : -1}
                className="min-w-0 flex-[0_0_100%] transition-opacity duration-fast hover:opacity-90"
                {...slideProps}
              >
                {inner}
              </Link>
            ) : (
              <div
                key={item.id}
                className="min-w-0 flex-[0_0_100%]"
                {...slideProps}
              >
                {inner}
              </div>
            )
          })}
        </div>
      </div>

      {count > 1 && (
        <div className="flex items-center justify-center gap-1 pb-1.5">
          <button
            type="button"
            onClick={scrollPrev}
            aria-label="Previous announcement"
            className="hidden h-6 w-6 items-center justify-center rounded-full text-[var(--text-tertiary)] transition-colors duration-fast hover:text-[var(--text-primary)] sm:flex"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>

          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              onClick={() => scrollTo(i)}
              aria-label={`Announcement ${i + 1} of ${count}`}
              aria-current={i === activeIndex}
              className="flex h-6 w-6 items-center justify-center"
            >
              <span
                className="block h-1.5 rounded-full transition-all duration-base ease-default"
                style={{
                  width: i === activeIndex ? '16px' : '6px',
                  backgroundColor:
                    i === activeIndex ? 'var(--accent)' : 'var(--card-border)'
                }}
              />
            </button>
          ))}

          <button
            type="button"
            onClick={scrollNext}
            aria-label="Next announcement"
            className="hidden h-6 w-6 items-center justify-center rounded-full text-[var(--text-tertiary)] transition-colors duration-fast hover:text-[var(--text-primary)] sm:flex"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
    </section>
  )
}
