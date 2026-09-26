'use client'

import { useCallback, useMemo, useRef, useState, useEffect, useId } from 'react'
import { Search, X, ChevronDown, Check } from 'lucide-react'
import type { CurrentSeasonBoss } from '../types'
import { getBossDisplayName } from '@/app/lib/utils/bossNames'

interface BossOption extends CurrentSeasonBoss {
  seasons?: string[]
  isCurrentSeason?: boolean
}

interface BossSearchComboboxProps {
  bosses: BossOption[]
  currentSeasonBosses: BossOption[]
  allBosses: string[]
  selectedBoss: string | null
  onSelectBoss: (bossType: string | null) => void
  searchValue: string
  onSearchChange: (value: string) => void
  showAllBosses: boolean
  onToggleShowAll: () => void
  currentSeason?: string | null
  placeholder?: string
}

export function BossSearchCombobox({
  currentSeasonBosses,
  allBosses,
  selectedBoss,
  onSelectBoss,
  searchValue,
  onSearchChange,
  showAllBosses,
  onToggleShowAll,
  currentSeason,
  placeholder = 'Search bosses...'
}: BossSearchComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [isInteractive, setIsInteractive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  useEffect(() => setIsInteractive(true), [])

  const displayBosses = useMemo(() => {
    const searchLower = searchValue.toLowerCase().trim()

    const bossMap = new Map<string, BossOption>()

    currentSeasonBosses.forEach((boss) => {
      bossMap.set(boss.boss_type, {
        ...boss,
        isCurrentSeason: true
      })
    })

    if (showAllBosses || searchLower) {
      allBosses.forEach((bossType) => {
        if (!bossMap.has(bossType)) {
          // Curated names, so reworked tokens ('BelisariusRW') do not render as 'Belisarius RW'.
          const bossName = getBossDisplayName(bossType)
          bossMap.set(bossType, {
            boss_type: bossType,
            boss_name: bossName,
            isCurrentSeason: false
          })
        }
      })
    }

    let result = Array.from(bossMap.values())

    if (searchLower) {
      result = result.filter(
        (boss) =>
          boss.boss_name.toLowerCase().includes(searchLower) ||
          boss.boss_type.toLowerCase().includes(searchLower)
      )
    }

    return result.sort((a, b) => {
      if (a.isCurrentSeason && !b.isCurrentSeason) return -1
      if (!a.isCurrentSeason && b.isCurrentSeason) return 1
      return a.boss_name.localeCompare(b.boss_name)
    })
  }, [currentSeasonBosses, allBosses, showAllBosses, searchValue])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
        setHighlightedIndex(-1)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-boss-item]')
      const item = items[highlightedIndex]
      if (item) {
        item.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedIndex])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onSearchChange(e.target.value)
      setIsOpen(true)
      setHighlightedIndex(-1)
    },
    [onSearchChange]
  )

  const handleSelect = useCallback(
    (bossType: string) => {
      onSelectBoss(bossType)
      onSearchChange(
        displayBosses.find((b) => b.boss_type === bossType)?.boss_name ||
          bossType
      )
      setIsOpen(false)
      setHighlightedIndex(-1)
    },
    [onSelectBoss, onSearchChange, displayBosses]
  )

  const handleClear = useCallback(() => {
    onSelectBoss(null)
    onSearchChange('')
    setHighlightedIndex(-1)
    inputRef.current?.focus()
  }, [onSelectBoss, onSearchChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        setIsOpen(true)
        setHighlightedIndex(
          displayBosses.length === 0
            ? -1
            : e.key === 'ArrowDown'
              ? 0
              : displayBosses.length - 1
        )
        return
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlightedIndex((prev) =>
            displayBosses.length === 0
              ? -1
              : prev < displayBosses.length - 1
                ? prev + 1
                : 0
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightedIndex((prev) =>
            displayBosses.length === 0
              ? -1
              : prev > 0
                ? prev - 1
                : displayBosses.length - 1
          )
          break
        case 'Enter':
          e.preventDefault()
          if (highlightedIndex >= 0 && displayBosses[highlightedIndex]) {
            handleSelect(displayBosses[highlightedIndex].boss_type)
          }
          break
        case 'Escape':
          setIsOpen(false)
          setHighlightedIndex(-1)
          break
      }
    },
    [isOpen, highlightedIndex, displayBosses, handleSelect]
  )

  const handleDisclosureClick = useCallback(() => {
    if (isOpen) {
      setIsOpen(false)
      setHighlightedIndex(-1)
      return
    }
    setIsOpen(true)
    setHighlightedIndex(
      selectedBoss
        ? displayBosses.findIndex((boss) => boss.boss_type === selectedBoss)
        : -1
    )
    inputRef.current?.focus()
  }, [displayBosses, isOpen, selectedBoss])

  const activeOptionId =
    isOpen && highlightedIndex >= 0
      ? `${listboxId}-option-${highlightedIndex}`
      : undefined

  return (
    <div
      ref={containerRef}
      data-interactive={isInteractive || undefined}
      className="relative w-full sm:w-64"
    >
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]"
        />
        <input
          ref={inputRef}
          type="text"
          value={searchValue}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-label="Search bosses"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          className={`min-h-11 w-full bg-[var(--card-bg)] py-2 pl-9 text-sm text-white placeholder-gray-500 border border-[var(--card-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${searchValue || selectedBoss ? 'pr-24' : 'pr-12'}`}
        />
        <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center">
          {(searchValue || selectedBoss) && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear boss search"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded transition-colors hover:bg-gray-700"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            </button>
          )}
          <button
            type="button"
            onClick={handleDisclosureClick}
            aria-label={isOpen ? 'Close boss options' : 'Open boss options'}
            aria-expanded={isOpen}
            aria-controls={listboxId}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded transition-colors hover:bg-gray-700"
          >
            <ChevronDown
              aria-hidden="true"
              className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-[var(--dropdown-bg-solid)] border border-[var(--card-border)] rounded-lg shadow-xl max-h-80 overflow-hidden">
          {/* Toggle for showing all bosses */}
          <div className="px-3 py-2 border-b border-[var(--card-border)] bg-card/50">
            <label className="flex min-h-11 items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={showAllBosses}
                onChange={onToggleShowAll}
                className="w-4 h-4 rounded border-[var(--card-border)] bg-gray-700 text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
              />
              <span className="text-[var(--text-primary)]">
                Show all seasons
                {currentSeason && (
                  <span className="text-[var(--text-secondary)] ml-1">
                    (current: S{currentSeason})
                  </span>
                )}
              </span>
            </label>
          </div>

          {/* Boss list */}
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label="Boss options"
            className="overflow-y-auto max-h-60"
          >
            {displayBosses.length === 0 ? (
              <div className="px-3 py-4 text-center text-[var(--text-secondary)] text-sm">
                No bosses found matching &quot;{searchValue}&quot;
              </div>
            ) : (
              displayBosses.map((boss, index) => (
                <button
                  key={boss.boss_type}
                  id={`${listboxId}-option-${index}`}
                  data-boss-item
                  type="button"
                  role="option"
                  aria-selected={selectedBoss === boss.boss_type}
                  onClick={() => handleSelect(boss.boss_type)}
                  className={`
                    min-h-11 w-full px-3 py-2 text-left flex items-center justify-between gap-2
                    transition-colors text-sm
                    ${highlightedIndex === index ? 'bg-purple-500/20' : 'hover:bg-[var(--hover-bg)]'}
                    ${selectedBoss === boss.boss_type ? 'text-purple-300' : 'text-white'}
                  `}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate">{boss.boss_name}</span>
                    {boss.isCurrentSeason && (
                      <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-green-500/20 text-green-400 rounded">
                        Current
                      </span>
                    )}
                  </div>
                  {selectedBoss === boss.boss_type && (
                    <Check
                      aria-hidden="true"
                      className="w-4 h-4 text-purple-400 shrink-0"
                    />
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer with count */}
          <div className="px-3 py-1.5 border-t border-[var(--card-border)] bg-card/50">
            <span className="text-xs text-[var(--text-secondary)]">
              {displayBosses.length} boss
              {displayBosses.length !== 1 ? 'es' : ''}
              {!showAllBosses && ' in current season'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
