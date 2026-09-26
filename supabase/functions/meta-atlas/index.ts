import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors-headers.ts'
import {
  jsonResponse,
  corsOptionsResponse
} from '../_shared/response-helpers.ts'
import { createServiceClient } from '../_shared/supabase-client.ts'
import { requireAuth } from '../_shared/auth-guard.ts'

interface MetaAtlasRequest {
  min_attacks?: number
  seasons?: string[]
  format?: 'json' | 'csv'
  include_coverage?: boolean
}

interface MetaAtlasRow {
  team_hash: string
  team_composition: string
  meta_team: string | null
  boss_type: string
  boss_unit_id: string | null
  map_id: string | null
  sub_boss_name: string
  encounter_type: string
  rarity: string
  set_num: number | null
  rarity_set: string | null
  season: string
  attack_count: number
  damage_max: number
  damage_p90: number
  damage_p75: number
  damage_avg: number
}

interface CoverageStats {
  total_team_boss_combos: number
  total_attacks: number
  boss_types_covered: number
  rarities_covered: number
  seasons_covered: number
  avg_attacks_per_combo: number
}

function validateApiKey(request: Request): boolean {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey) return false

  const validKeys = Deno.env.get('META_ATLAS_API_KEYS')?.split(',') || []
  return validKeys.some((key) => key.trim() === apiKey.trim())
}

function escapeCSVField(value: string | number | null): string {
  if (value === null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCSV(data: MetaAtlasRow[]): string {
  const headers = [
    'team_hash',
    'team_composition',
    'meta_team',
    'boss_type',
    'boss_unit_id',
    'map_id',
    'sub_boss_name',
    'encounter_type',
    'boss_rarity',
    'boss_set_num',
    'rarity_set',
    'season_number',
    'num_attacks',
    'damage_100th',
    'damage_90th',
    'damage_75th',
    'damage_avg'
  ]

  const rows = data.map((row) =>
    [
      escapeCSVField(row.team_hash),
      escapeCSVField(row.team_composition),
      escapeCSVField(row.meta_team),
      escapeCSVField(row.boss_type),
      escapeCSVField(row.boss_unit_id),
      escapeCSVField(row.map_id),
      escapeCSVField(row.sub_boss_name),
      escapeCSVField(row.encounter_type),
      escapeCSVField(row.rarity),
      escapeCSVField(row.set_num),
      escapeCSVField(row.rarity_set),
      escapeCSVField(row.season),
      escapeCSVField(row.attack_count),
      escapeCSVField(row.damage_max),
      escapeCSVField(Math.round(row.damage_p90)),
      escapeCSVField(Math.round(row.damage_p75)),
      escapeCSVField(Math.round(row.damage_avg))
    ].join(',')
  )

  return [headers.join(','), ...rows].join('\n')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsOptionsResponse()
  }

  const authError = requireAuth(req)
  if (authError) return authError

  try {
    if (!validateApiKey(req)) {
      return jsonResponse(
        { error: 'Unauthorized', details: 'Invalid or missing API key' },
        { status: 401 }
      )
    }

    if (req.method !== 'POST') {
      return jsonResponse(
        { error: 'Method not allowed', details: 'Use POST' },
        { status: 405 }
      )
    }

    let body: MetaAtlasRequest = {}
    try {
      const text = await req.text()
      if (text) {
        body = JSON.parse(text)
      }
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const minAttacks = body.min_attacks ?? 50
    const seasons = body.seasons ?? null
    const format = body.format ?? 'json'
    const includeCoverage = body.include_coverage ?? false

    if (typeof minAttacks !== 'number' || minAttacks < 1 || minAttacks > 1000) {
      return jsonResponse(
        {
          error: 'Invalid min_attacks',
          details: 'Must be a number between 1 and 1000'
        },
        { status: 400 }
      )
    }

    if (format !== 'json' && format !== 'csv') {
      return jsonResponse(
        { error: 'Invalid format', details: 'Must be "json" or "csv"' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    let data: MetaAtlasRow[]
    let coverage: CoverageStats | undefined

    if (seasons && seasons.length > 0) {
      const { data: rpcData, error } = await supabase.rpc(
        'get_meta_atlas_anonymous',
        {
          p_min_attacks: minAttacks,
          p_exclude_overkills: true,
          p_exclude_retreats: true,
          p_retreat_threshold: 10000,
          p_seasons: seasons
        }
      )

      if (error) throw error
      data = rpcData || []
    } else {
      const query = supabase
        .from('meta_atlas_data')
        .select('*')
        .gte('attack_count', minAttacks)
        .order('attack_count', { ascending: false })

      const { data: cacheData, error } = await query

      if (error) throw error
      data = cacheData || []
    }

    if (includeCoverage) {
      const { data: coverageData, error: coverageError } = await supabase.rpc(
        'get_meta_atlas_coverage',
        {
          p_min_attacks: minAttacks
        }
      )

      if (coverageError) throw coverageError
      coverage = coverageData?.[0]
    }

    if (format === 'csv') {
      const csv = toCSV(data)
      const date = new Date().toISOString().split('T')[0]
      return new Response(csv, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="meta_atlas_${date}.csv"`
        }
      })
    }

    const response = {
      success: true,
      params: {
        min_attacks: minAttacks,
        seasons: seasons,
        format: format
      },
      ...(coverage && { coverage }),
      count: data.length,
      data: data.map((row) => ({
        team_hash: row.team_hash,
        team_composition: row.team_composition,
        meta_team: row.meta_team,
        boss_type: row.boss_type,
        boss_unit_id: row.boss_unit_id,
        map_id: row.map_id,
        sub_boss_name: row.sub_boss_name,
        encounter_type: row.encounter_type,
        boss_rarity: row.rarity,
        boss_set_num: row.set_num,
        rarity_set: row.rarity_set,
        season_number: row.season,
        num_attacks: row.attack_count,
        damage_100th: row.damage_max,
        damage_90th: Math.round(row.damage_p90),
        damage_75th: Math.round(row.damage_p75)
      }))
    }

    return jsonResponse(response)
  } catch (error) {
    console.error('Meta Atlas API error:', error)
    return jsonResponse(
      {
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
})
