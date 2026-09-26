import { NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import {
  createTeamDAG,
  findUpgradePaths,
  type TeamData
} from '@/app/lib/meta/team-progression'
import { getUserAccessLevels } from '@/app/lib/services/feature-release-service'
import { requireFeatureAccess } from '@/app/lib/services/feature-access-gate'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.hero-impact')
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import type { EOTGRData } from '@tacticus/app-core/types'

interface BossImpact {
  boss_type: string
  rarity_set: string
  current_team: string
  current_damage_p90: number
  upgraded_team: string
  upgraded_damage_p90: number
  damage_increase: number
  percent_increase: number
  meta_team: string | null
}

interface HeroUpgradeImpact {
  hero_name: string
  total_damage_increase: number
  boss_impacts: BossImpact[]
}

export const POST = withErrorHandler(async (request: Request) => {
  try {
    const body = await request.json()
    const { player_name, guild_code, season } = body

    if (!player_name || !guild_code) {
      throw Errors.fromResponse(400, {
        error: 'player_name and guild_code are required'
      })
    }

    const authSupabase = await db()
    const user = await requireSessionUser(authSupabase, () =>
      Errors.fromResponse(401, { error: 'Authentication required' })
    )

    const accessLevels = await getUserAccessLevels(user.id)
    if (accessLevels.guild_code !== guild_code && !accessLevels.is_app_admin) {
      throw Errors.fromResponse(403, {
        error: 'You can only view hero impact for your own guild'
      })
    }

    await requireFeatureAccess(
      user.id,
      'meta_atlas',
      'Meta Atlas feature access required'
    )

    const supabase = serviceDb()

    const { data: playerBattles, error: battlesError } = await supabase
      .from('EOT_GR_data')
      .select(
        'Name, unitId, heroDetails, machineOfWarDetails, damageDealt, tier, set'
      )
      .eq('displayName', player_name)
      .eq('Guild', guild_code)
      .eq('Season', season || '')
      .not('heroDetails', 'is', null)
      .order('damageDealt', { ascending: false })

    if (battlesError) throw battlesError

    if (!playerBattles || playerBattles.length === 0) {
      return NextResponse.json({
        player_name,
        hero_impacts: [],
        message: 'No battle data found'
      })
    }

    const { data: bossMapping } = await supabase
      .from('boss_mapping')
      .select('unit_id, boss_type, boss_name')
      .not('unit_id', 'is', null)

    const bossDisplayNames = new Map<string, string>()
    for (const bm of bossMapping || []) {
      if (bm.unit_id && bm.boss_name) {
        bossDisplayNames.set(bm.unit_id, bm.boss_name)
      }
    }

    type BattleRow = Pick<
      EOTGRData,
      | 'Name'
      | 'unitId'
      | 'heroDetails'
      | 'machineOfWarDetails'
      | 'damageDealt'
      | 'tier'
      | 'set'
    >

    const playerTeamsByBoss = new Map<
      string,
      {
        composition: string
        damage: number
        rarity_set: string
        unitId: string
        displayName: string
      }
    >()

    const battleRows: BattleRow[] = playerBattles
    for (const battle of battleRows) {
      const bossKey = battle.unitId
        ? `${battle.unitId}_${battle.set}`
        : `${battle.Name}_${battle.set}`
      if (!playerTeamsByBoss.has(bossKey)) {
        let heroes: string[] = []
        let mow: string | null = null

        try {
          const heroDetails = battle.heroDetails
            ? JSON.parse(battle.heroDetails)
            : null

          if (Array.isArray(heroDetails)) {
            heroes = heroDetails
              .map(
                (h: { unitId?: string; name?: string }) =>
                  h.unitId || h.name || ''
              )
              .filter(Boolean)
          }

          if (battle.machineOfWarDetails) {
            const mowDetails = JSON.parse(battle.machineOfWarDetails) as {
              unitId?: string
              name?: string
            }
            mow = mowDetails?.unitId || mowDetails?.name || null
          }
        } catch {
          continue
        }

        if (heroes.length > 0) {
          const composition = mow
            ? `${heroes.join(', ')} + ${mow}`
            : heroes.join(', ')

          playerTeamsByBoss.set(bossKey, {
            composition,
            damage: battle.damageDealt || 0,
            rarity_set: `${battle.set || ''}${battle.tier || ''}`,
            unitId: battle.unitId || '',
            displayName:
              bossDisplayNames.get(battle.unitId || '') ||
              battle.Name ||
              'Unknown'
          })
        }
      }
    }

    const bossUnitIds = [
      ...new Set(
        battleRows
          .map((b) => b.unitId)
          .filter((unitId): unitId is string => Boolean(unitId))
      )
    ]
    const bossTypes = [
      ...new Set(
        battleRows
          .map((b) => b.Name)
          .filter((name): name is string => Boolean(name))
      )
    ]

    const { data: metaData, error: metaError } = await supabase
      .from('meta_atlas_data')
      .select(
        'team_hash, team_composition, meta_team, boss_type, boss_unit_id, rarity_set, damage_p90, attack_count'
      )
      .or(
        `boss_unit_id.in.(${bossUnitIds.join(',')}),boss_type.in.(${bossTypes.join(',')})`
      )
      .gte('attack_count', 20)
      .order('damage_p90', { ascending: false })

    if (metaError) throw metaError

    interface MetaRow {
      team_hash: string
      team_composition: string | null
      meta_team: string | null
      boss_type: string | null
      boss_unit_id: string | null
      rarity_set: string | null
      damage_p90: number | null
      attack_count: number | null
    }

    const metaByBoss = new Map<string, TeamData[]>()
    for (const row of (metaData || []) as MetaRow[]) {
      if (!row.team_composition || row.damage_p90 == null) continue

      const raritySetBase = row.rarity_set?.replace(/\d+$/, '') || ''
      const keyByUnitId = row.boss_unit_id
        ? `${row.boss_unit_id}_${raritySetBase}`
        : null
      const keyByType = `${row.boss_type}_${raritySetBase}`

      const teamData = {
        team_composition: row.team_composition,
        damage_p90: row.damage_p90,
        attack_count: row.attack_count || 0,
        meta_team: row.meta_team
      }

      if (keyByUnitId) {
        if (!metaByBoss.has(keyByUnitId)) {
          metaByBoss.set(keyByUnitId, [])
        }
        metaByBoss.get(keyByUnitId)!.push(teamData)
      }

      if (!metaByBoss.has(keyByType)) {
        metaByBoss.set(keyByType, [])
      }
      metaByBoss.get(keyByType)!.push(teamData)
    }

    const heroImpactMap = new Map<string, BossImpact[]>()

    for (const [bossKey, playerTeam] of playerTeamsByBoss) {
      const metaTeams = metaByBoss.get(bossKey) || []
      const displayName =
        playerTeam.displayName || bossKey.split('_')[0] || bossKey

      if (metaTeams.length < 2) continue

      const dag = createTeamDAG(metaTeams, { minCommonMembers: 5 })
      const upgrades = findUpgradePaths(dag, playerTeam.composition)

      for (const upgrade of upgrades) {
        const heroName = upgrade.swappedIn

        if (!heroImpactMap.has(heroName)) {
          heroImpactMap.set(heroName, [])
        }

        heroImpactMap.get(heroName)!.push({
          boss_type: displayName,
          rarity_set: playerTeam.rarity_set,
          current_team: playerTeam.composition,
          current_damage_p90: playerTeam.damage,
          upgraded_team: upgrade.to.composition,
          upgraded_damage_p90: upgrade.to.damageP90,
          damage_increase: Math.round(upgrade.damageIncrease),
          percent_increase: Math.round(upgrade.percentIncrease * 10) / 10,
          meta_team: upgrade.to.metaTeam
        })
      }
    }

    const heroImpacts: HeroUpgradeImpact[] = []

    for (const [heroName, impacts] of heroImpactMap) {
      const totalIncrease = impacts.reduce(
        (sum, i) => sum + i.damage_increase,
        0
      )
      heroImpacts.push({
        hero_name: heroName,
        total_damage_increase: totalIncrease,
        boss_impacts: impacts.sort(
          (a, b) => b.damage_increase - a.damage_increase
        )
      })
    }

    heroImpacts.sort(
      (a, b) => b.total_damage_increase - a.total_damage_increase
    )

    return NextResponse.json({
      player_name,
      hero_impacts: heroImpacts.slice(0, 20),
      total_heroes_analyzed: heroImpacts.length
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Hero impact analysis error')
    throw Errors.fromResponse(500, { error: 'Failed to analyze hero impact' })
  }
})
