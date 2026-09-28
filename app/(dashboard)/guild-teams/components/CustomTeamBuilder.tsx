'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Image from 'next/image'
import { Plus, X, Search } from 'lucide-react'
import type { RaidTeamHero } from '@/app/lib/constants/guild-raid-teams'

interface HeroMappingInfo {
  id: number
  unit_id: string
  display_name: string | null
  web_icon_url: string | null
  category: string | null
}

interface CustomTeamBuilderProps {
  customHeroes: RaidTeamHero[]
  onHeroesChange: (heroes: RaidTeamHero[]) => void
  heroMappings: Record<string, HeroMappingInfo>
}

const TIERS = ['core', 'secondary', 'tertiary'] as const
const TIER_LABELS: Record<string, string> = {
  core: 'Core',
  secondary: 'Secondary',
  tertiary: 'Tertiary'
}
const TIER_BORDER: Record<string, string> = {
  core: 'border-yellow-500/40',
  secondary: 'border-blue-500/30',
  tertiary: 'border-card-border/30'
}

export function CustomTeamBuilder({
  customHeroes,
  onHeroesChange,
  heroMappings
}: CustomTeamBuilderProps) {
  const [openTier, setOpenTier] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openTier) return
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpenTier(null)
        setSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openTier])

  const usedUnitIds = useMemo(
    () => new Set(customHeroes.map((h) => h.unitId)),
    [customHeroes]
  )

  const availableHeroes = useMemo(() => {
    const entries = Object.values(heroMappings)
      .filter((m) => !usedUnitIds.has(m.unit_id))
      .sort((a, b) =>
        (a.display_name ?? a.unit_id).localeCompare(b.display_name ?? b.unit_id)
      )

    if (!searchQuery.trim()) return entries
    const q = searchQuery.trim().toLowerCase()
    return entries.filter(
      (m) =>
        (m.display_name ?? '').toLowerCase().includes(q) ||
        m.unit_id.toLowerCase().includes(q)
    )
  }, [heroMappings, usedUnitIds, searchQuery])

  const addHero = (unitId: string, tier: 'core' | 'secondary' | 'tertiary') => {
    const mapping = heroMappings[unitId]
    if (!mapping) return
    const hero: RaidTeamHero = {
      unitId,
      displayName: mapping.display_name ?? unitId,
      tier
    }
    onHeroesChange([...customHeroes, hero])
    setSearchQuery('')
  }

  const removeHero = (unitId: string) => {
    onHeroesChange(customHeroes.filter((h) => h.unitId !== unitId))
  }

  return (
    <div className="bg-card/40 rounded-lg p-3">
      <div className="text-xs text-secondary-wh40k uppercase tracking-wider mb-2">
        Build Your Team
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {TIERS.map((tier) => {
          const tierHeroes = customHeroes.filter((h) => h.tier === tier)
          return (
            <div
              key={tier}
              className={`rounded-lg border ${TIER_BORDER[tier]} bg-card/30 p-2`}
            >
              <div className="text-xs font-semibold text-secondary-wh40k uppercase tracking-wider mb-2">
                {TIER_LABELS[tier]}
              </div>

              {/* Selected heroes */}
              <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
                {tierHeroes.map((hero) => {
                  const mapping = heroMappings[hero.unitId]
                  return (
                    <div
                      key={hero.unitId}
                      className="flex items-center gap-1 bg-card/60 rounded-sm px-1.5 py-0.5 text-xs text-primary-wh40k"
                    >
                      {mapping?.web_icon_url && (
                        <Image
                          src={mapping.web_icon_url}
                          alt=""
                          width={16}
                          height={16}
                          className="rounded-xs"
                          unoptimized
                        />
                      )}
                      <span className="truncate max-w-[80px]">
                        {mapping?.display_name ?? hero.displayName}
                      </span>
                      <button
                        onClick={() => removeHero(hero.unitId)}
                        className="text-secondary-wh40k hover:text-red-400 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )
                })}
              </div>

              {/* Add button + dropdown */}
              <div
                className="relative"
                ref={openTier === tier ? dropdownRef : undefined}
              >
                <button
                  onClick={() => {
                    setOpenTier(openTier === tier ? null : tier)
                    setSearchQuery('')
                  }}
                  className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add Hero
                </button>

                {openTier === tier && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-(--card-bg) border border-(--card-border) rounded-lg shadow-xl w-56 max-h-[280px] flex flex-col">
                    <div className="p-1.5 border-b border-(--card-border)">
                      <div className="flex items-center gap-1.5 bg-(--card-bg) rounded-sm px-2 py-1">
                        <Search className="w-3 h-3 text-secondary-wh40k" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search heroes..."
                          className="bg-transparent text-xs text-primary-wh40k placeholder-gray-500 focus:outline-hidden w-full"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {availableHeroes.length === 0 && (
                        <div className="px-2 py-3 text-xs text-secondary-wh40k text-center">
                          No heroes available
                        </div>
                      )}
                      {availableHeroes.map((mapping) => (
                        <button
                          key={mapping.unit_id}
                          onClick={() => addHero(mapping.unit_id, tier)}
                          className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-card/50 transition-colors"
                        >
                          {mapping.web_icon_url && (
                            <Image
                              src={mapping.web_icon_url}
                              alt=""
                              width={18}
                              height={18}
                              className="rounded-xs"
                              unoptimized
                            />
                          )}
                          <span className="text-xs text-primary-wh40k truncate">
                            {mapping.display_name ?? mapping.unit_id}
                          </span>
                          {mapping.category && (
                            <span className="text-[10px] text-secondary-wh40k ml-auto">
                              {mapping.category}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
