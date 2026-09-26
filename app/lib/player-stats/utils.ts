export type PartialBattleRow = {
  remainingHp?: number
  maxHp?: number
  damageDealt?: number
  damageType?: string
}

export const isSweepBattle = (row: PartialBattleRow) =>
  row.remainingHp === 0 &&
  (row.maxHp ?? 0) > 0 &&
  (row.damageDealt ?? 0) < (row.maxHp ?? 0) &&
  row.damageType === 'Battle'

export const buildBossKey = (
  name?: string | null,
  rarity?: string | null,
  set?: number | null
) => `${name || ''}_${rarity || ''}_${set ?? 0}`
