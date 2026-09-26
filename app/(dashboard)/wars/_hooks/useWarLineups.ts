'use client'

import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'
import type { AvatarFrame } from '@/app/lib/utils/avatar'
import { useHeroCatalog } from '@/app/lib/catalogs'
import {
  usePlayerRoster as useSharedPlayerRoster,
  type RosterHero
} from '@/app/lib/hooks/shared'
import { getRankName as getTacticusRankName } from '@/app/lib/tacticus/ranks'

export interface WarLineup {
  id: string
  user_id: string
  guild_code: string
  lineup_type: 'defensive' | 'offensive'
  lineup_name: string
  slot_number: number
  heroes: string[]
  machine_of_war: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface HeroMapping {
  unit_id: string
  display_name: string | null
  web_icon_url: string | null
  category: string | null
}

export type RosterUnit = RosterHero

export function useWarLineups(
  guildCode: string,
  lineupType: 'defensive' | 'offensive'
) {
  const supabase = dbClient()

  return useQuery({
    queryKey: ['war-lineups', guildCode, lineupType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('war_player_lineups')
        .select('*')
        .eq('guild_code', guildCode)
        .eq('lineup_type', lineupType)
        .order('slot_number')

      if (error) throw error
      return (data as unknown as WarLineup[]) || []
    },
    enabled: !!guildCode,
    staleTime: 30 * 1000
  })
}

export function useHeroMappings() {
  const heroCatalogQuery = useHeroCatalog()
  const data = useMemo<HeroMapping[]>(() => {
    const heroes = heroCatalogQuery.data?.getAll() ?? []
    return heroes.map((hero) => ({
      unit_id: hero.unitId,
      display_name: hero.displayName,
      web_icon_url: hero.iconUrl || null,
      category:
        hero.category === 'mow'
          ? 'MOW'
          : hero.category === 'hero'
            ? 'Hero'
            : null
    }))
  }, [heroCatalogQuery.data])

  return {
    ...heroCatalogQuery,
    data
  }
}

export function useAvatarFrames() {
  const supabase = dbClient()

  return useQuery({
    queryKey: ['avatar-frames'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_avatar_frames')
        .select('avatar_id, icon_url')

      if (error) throw error
      return (data as unknown as AvatarFrame[]) || []
    },
    staleTime: 24 * 60 * 60 * 1000
  })
}

export function usePlayerRoster() {
  const roster = useSharedPlayerRoster()

  return {
    data: roster.heroes as RosterUnit[],
    isLoading: roster.isLoading,
    error: roster.error,
    refetch: roster.refetch
  }
}

interface UpsertLineupParams {
  guildCode: string
  lineupType: 'defensive' | 'offensive'
  slotNumber: number
  lineupName: string
  heroes: string[]
  machineOfWar: string | null
  notes: string | null
}

export function useUpsertLineup() {
  const supabase = dbClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: UpsertLineupParams) => {
      const {
        data: { user }
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase.from('war_player_lineups').upsert(
        {
          user_id: user.id,
          guild_code: params.guildCode,
          lineup_type: params.lineupType,
          slot_number: params.slotNumber,
          lineup_name: params.lineupName,
          heroes: params.heroes,
          machine_of_war: params.machineOfWar,
          notes: params.notes,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'user_id,guild_code,lineup_type,slot_number'
        }
      )

      if (error) throw error
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({
        queryKey: ['war-lineups', params.guildCode, params.lineupType]
      })
    }
  })
}

export function useDeleteLineup() {
  const supabase = dbClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      guildCode,
      lineupType
    }: {
      id: string
      guildCode: string
      lineupType: string
    }) => {
      const { error } = await supabase
        .from('war_player_lineups')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { guildCode, lineupType }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ['war-lineups', result.guildCode, result.lineupType]
      })
    }
  })
}

export const getRankName = getTacticusRankName

const RANK_PREFIX: Record<string, string> = {
  Stone: 'St',
  Iron: 'I',
  Bronze: 'B',
  Silver: 'S',
  Gold: 'G',
  Diamond: 'D',
  Adamantium: 'A',
  Mythic: 'M'
}

const ROMAN_TO_NUM: Record<string, number> = { I: 1, II: 2, III: 3 }

export function getRankShortName(rank: number): string {
  const full = getRankName(rank)
  const [tier = '', roman] = full.split(' ')
  const prefix = RANK_PREFIX[tier] || tier?.slice(0, 1) || 'R'
  const num = roman ? ROMAN_TO_NUM[roman] : undefined
  return typeof num === 'number' ? `${prefix}${num}` : prefix
}

export function getRankColor(rank: number): string {
  if (rank >= 21) return 'text-red-500'
  if (rank >= 18) return 'text-orange-500'
  if (rank >= 15) return 'text-cyan-300'
  if (rank >= 12) return 'text-yellow-400'
  if (rank >= 9) return 'text-gray-300'
  if (rank >= 6) return 'text-orange-400'
  if (rank >= 3) return 'text-gray-400'
  return 'text-stone-500'
}

export function getRankBorderColor(rank: number): string {
  if (rank >= 21) return 'border-red-500/60 ring-red-500/30'
  if (rank >= 18) return 'border-orange-500/60 ring-orange-500/30'
  if (rank >= 15) return 'border-cyan-400/60 ring-cyan-400/30'
  if (rank >= 12) return 'border-yellow-500/60 ring-yellow-500/30'
  if (rank >= 9) return 'border-gray-400/60 ring-gray-400/30'
  if (rank >= 6) return 'border-orange-400/60 ring-orange-400/30'
  if (rank >= 3) return 'border-gray-500/60 ring-gray-500/30'
  return 'border-stone-500/40'
}

export const FACTIONS = [
  'Ultramarines',
  'Black Legion',
  'Orks',
  'Astra Militarum',
  'Necrons',
  'Death Guard',
  'Adepta Sororitas',
  'Black Templars',
  'Dark Angels',
  'Space Wolves',
  'World Eaters',
  'Thousand Sons',
  'Tyranids',
  "T'au Empire",
  'Aeldari',
  'Leagues of Votann'
]

export const ALLIANCES = ['Imperial', 'Chaos', 'Xenos']
