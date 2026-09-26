'use client'

import {
  Users,
  Sword,
  Crown,
  Target,
  Star,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import { formatDamageWithPrivacy } from '@tacticus/app-core/explore-privacy'
import type { Rarity } from '@tacticus/app-core/rarity-utils'
import { getGuildCardClasses, isVotlwChampion } from '../utils'
import { PrimaryTargetView } from './PrimaryTargetView'
import { DetailedBossHits } from './DetailedBossHits'
import type { GuildData } from '../types'
import { formatGuildTag } from '@/app/lib/format/guild'

interface GuildCardProps {
  guild: GuildData
  isExpanded: boolean
  onToggleExpand: (guildCode: string) => void
  selectedRarities: Rarity[]
  defaultRarities: Rarity[]
  hasMounted: boolean
}

export function GuildCard({
  guild,
  isExpanded,
  onToggleExpand,
  selectedRarities,
  defaultRarities,
  hasMounted
}: GuildCardProps) {
  const isPremium = guild.is_premium === true

  return (
    <div className={getGuildCardClasses(guild)}>
      {isPremium && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
      )}
      {/* Guild Header */}
      <div
        className="p-4 cursor-pointer transition-colors duration-200 hover:bg-[var(--card-hover)]"
        onClick={() => onToggleExpand(guild.guild_code)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Ranking Badges */}
            <div className="flex gap-2">
              {guild.current_gr_ranking && (
                <div className="flex flex-col items-center">
                  <div
                    className={`flex items-center justify-center w-12 h-12 rounded-full ${isPremium ? 'bg-amber-500/20 border border-amber-500/50' : 'bg-green-500/20 border border-green-500/50'}`}
                  >
                    <span
                      className={`font-bold ${isPremium ? 'text-amber-400' : 'text-green-400'}`}
                    >
                      #{guild.current_gr_ranking}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--text-tertiary)] mt-1">
                    Raid
                  </span>
                </div>
              )}
              {(guild.current_war_rank || guild.war_rank) && (
                <div className="flex flex-col items-center">
                  <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-500/20 border border-red-500/50">
                    <span className="font-bold text-red-400">
                      #{guild.current_war_rank || guild.war_rank}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--text-tertiary)] mt-1">
                    War
                  </span>
                </div>
              )}
            </div>

            {/* Guild Info */}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold text-[var(--text-primary)]">
                  {guild.guild_name}
                </h3>
                {isPremium && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    <Crown className="w-3 h-3" />
                    Premium
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <span className="font-mono">{formatGuildTag(guild)}</span>
                {guild.cluster_name && (
                  <>
                    <span>•</span>
                    <span className="text-[var(--accent)]">
                      {guild.cluster_name}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="flex items-center gap-6">
            {/* distinct raiders this season, not roster size */}
            <div
              className="text-center hidden sm:block"
              title="Distinct players with recorded raid battles this season"
            >
              <div className="text-lg font-bold text-[var(--text-primary)]">
                {guild.active_players || '--'}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                Active Players
              </div>
            </div>
            <div className="text-center hidden md:block">
              <div className="text-lg font-bold text-[var(--text-primary)]">
                {guild.total_damage > 0
                  ? guild.isObfuscated
                    ? formatDamageWithPrivacy(
                        guild.total_damage,
                        'obfuscate_values',
                        guild.originalTotalDamage,
                        guild.obfuscationPercent ??
                          guild.explore_obfuscation_percent ??
                          undefined
                      )
                    : formatNumber(guild.total_damage)
                  : '--'}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                Total Damage
              </div>
            </div>
            <div className="text-center hidden lg:block">
              <div className="text-lg font-bold text-[var(--text-primary)]">
                {guild.veteran_count || 0}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                Veterans
              </div>
            </div>
            <div>
              {isExpanded ? (
                <ChevronUp className="w-5 h-5 text-[var(--text-secondary)]" />
              ) : (
                <ChevronDown className="w-5 h-5 text-[var(--text-secondary)]" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-[var(--card-border)] p-4 space-y-4">
          {/* Last Updated */}
          <div className="flex items-center justify-end mb-4">
            <div className="text-xs text-[var(--text-tertiary)]">
              Last updated:{' '}
              {hasMounted &&
                // eslint-disable-next-line no-restricted-syntax
                new Date(guild.last_updated).toLocaleString()}
              {!hasMounted && '\u2014'}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div title="Distinct players with recorded raid battles this season">
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mb-1">
                <Users className="w-4 h-4" />
                Active Players
              </div>
              <div className="text-xl font-bold text-[var(--text-primary)]">
                {guild.active_players || '--'}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mb-1">
                <Sword className="w-4 h-4" />
                Total Battles
              </div>
              <div className="text-xl font-bold text-[var(--text-primary)]">
                {formatNumber(guild.total_battles) || '--'}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mb-1">
                <Target className="w-4 h-4" />
                Avg Damage
              </div>
              <div className="text-xl font-bold text-[var(--text-primary)]">
                {guild.avg_damage_per_battle > 0
                  ? guild.isObfuscated
                    ? formatDamageWithPrivacy(
                        guild.avg_damage_per_battle,
                        'obfuscate_values',
                        guild.originalAvgDamagePerBattle,
                        guild.obfuscationPercent ??
                          guild.explore_obfuscation_percent ??
                          undefined
                      )
                    : formatNumber(guild.avg_damage_per_battle)
                  : '--'}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] mb-1">
                <Star className="w-4 h-4" />
                5-Season Veterans
              </div>
              <div className="text-xl font-bold text-[var(--text-primary)]">
                {guild.veteran_count || 0}
              </div>
            </div>
          </div>

          {/* Boss Targets */}
          {guild.top_boss_hits && guild.top_boss_hits.length > 0 && (
            <div>
              {isExpanded ? (
                <DetailedBossHits
                  bossHits={guild.top_boss_hits}
                  selectedRarities={selectedRarities}
                  defaultRarities={defaultRarities}
                  availableRarities={guild.available_rarities}
                />
              ) : (
                <PrimaryTargetView bossHits={guild.top_boss_hits} />
              )}
            </div>
          )}

          {/* VOTLW Champions */}
          {guild.votlw_champions && guild.votlw_champions.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-2">
                <Crown className="w-4 h-4 text-[var(--primary)]" />
                Recent VOTLW Champions
              </h4>
              <div className="flex flex-wrap gap-2">
                {(Array.isArray(guild.votlw_champions)
                  ? guild.votlw_champions.filter(isVotlwChampion)
                  : []
                )
                  .slice(0, 5)
                  .map((champ) => (
                    <div
                      // One per season, so unique even for a shared anonymous label.
                      key={`${champ.season}-${champ.player}`}
                      className="px-3 py-1 bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] rounded-full"
                    >
                      <span className="text-sm text-[var(--primary)]">
                        Season {champ.season}: {champ.player}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
