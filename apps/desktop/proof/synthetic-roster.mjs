export const syntheticRosterUnit = () => ({
  id: 'syntheticHero',
  name: '<img src=x onerror=alert(1)>',
  progressionIndex: 12,
  rank: 15,
  xp: 1000,
  xpLevel: 40,
  shards: 100,
  mythicShards: 0,
  abilities: [
    { id: 'syntheticActive', level: 35 },
    { id: 'syntheticPassive', level: 30 }
  ],
  upgrades: [0, 4],
  items: [
    { id: 'syntheticCrit', slotId: 'Slot1', level: 7, rarity: 'Legendary' }
  ]
})
