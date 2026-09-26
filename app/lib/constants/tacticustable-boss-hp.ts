/** Boss HP constants generated from the game-data catalog. */

export const BOSS_HP_BY_LEVEL_TACTICUSTABLE = {
  L1: 4895625,
  L2: 7343750,
  L3: 9791250,
  L4: 12237500,
  L5: 14687500
} as const

export const MYTHIC_BOSS_HP_BY_LEVEL_TACTICUSTABLE = {
  M1: 29375000,
  M2: 36718750,
  M3: 44062500,
  M4: 51406250,
  M5: 63125000
} as const

export const BOSS_HP_BY_NAME: Record<string, Record<string, number>> = {
  Avatar: {
    M5: 50000000,
    M4: 43750000,
    M3: 37500000,
    M2: 31250000,
    M1: 25000000,
    L5: 12500000,
    L4: 10400000,
    L3: 8330000,
    L2: 6250000,
    L1: 4165000
  },
  Belisarius: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  },
  Ghazghkull: {
    M5: 50000000,
    M4: 43750000,
    M3: 37500000,
    M2: 31250000,
    M1: 25000000,
    L5: 12500000,
    L4: 10400000,
    L3: 8330000,
    L2: 6250000,
    L1: 4165000
  },
  HiveTyrantGorgon: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  },
  HiveTyrantKronos: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  },
  HiveTyrantLeviathan: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  },
  Lion: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  },
  Magnus: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  },
  Mortarion: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  },
  Riptide: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  },
  Rogaldorn: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  },
  ScreamerKiller: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  },
  SilentKing: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  },
  TervigonGorgon: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  },
  TervigonKronos: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  },
  TervigonLeviathan: {
    M5: 65000000,
    M4: 52500000,
    M3: 45000000,
    M2: 37500000,
    M1: 30000000,
    L5: 15000000,
    L4: 12500000,
    L3: 10000000,
    L2: 7500000,
    L1: 5000000
  }
}

export const PRIME_HP_BY_BOSS: Record<
  string,
  Record<string, { prime1?: number; prime2?: number }>
> = {
  Avatar: {
    M5: { prime1: 3500000, prime2: 3500000 },
    M4: { prime1: 3062500, prime2: 3062500 },
    M3: { prime1: 2625000, prime2: 2625000 },
    M2: { prime1: 2187500, prime2: 2187500 },
    M1: { prime1: 1750000, prime2: 1750000 },
    L5: { prime1: 875000, prime2: 875000 },
    L4: { prime1: 728000, prime2: 728000 },
    L3: { prime1: 583100, prime2: 583100 },
    L2: { prime1: 437500, prime2: 437500 },
    L1: { prime1: 291550, prime2: 291550 }
  },
  Belisarius: {
    M5: { prime1: 3900000, prime2: 4550000 },
    M4: { prime1: 3150000, prime2: 3675000 },
    M3: { prime1: 2700000, prime2: 3150000 },
    M2: { prime1: 2250000, prime2: 2625000 },
    M1: { prime1: 1800000, prime2: 2100000 },
    L5: { prime1: 900000, prime2: 1050000 },
    L4: { prime1: 750000, prime2: 875000 },
    L3: { prime1: 600000, prime2: 700000 },
    L2: { prime1: 450000, prime2: 525000 },
    L1: { prime1: 300000, prime2: 350000 }
  },
  Ghazghkull: {
    M5: { prime1: 3632249, prime2: 3632249 },
    M4: { prime1: 3308512, prime2: 3308512 },
    M3: { prime1: 3000000, prime2: 3000000 },
    M2: { prime1: 2500000, prime2: 2500000 },
    M1: { prime1: 2000000, prime2: 2000000 },
    L5: { prime1: 1000000, prime2: 1000000 },
    L4: { prime1: 832000, prime2: 832000 },
    L3: { prime1: 666400, prime2: 666400 },
    L2: { prime1: 500000, prime2: 500000 },
    L1: { prime1: 333200, prime2: 333200 }
  },
  HiveTyrantGorgon: {
    M5: { prime1: 5200000, prime2: 5200000 },
    M4: { prime1: 4200000, prime2: 4200000 },
    M3: { prime1: 3600000, prime2: 3600000 },
    M2: { prime1: 3000000, prime2: 3000000 },
    M1: { prime1: 2400000, prime2: 2400000 },
    L5: { prime1: 1200000, prime2: 1200000 },
    L4: { prime1: 1000000, prime2: 1000000 },
    L3: { prime1: 800000, prime2: 800000 },
    L2: { prime1: 600000, prime2: 600000 },
    L1: { prime1: 400000, prime2: 400000 }
  },
  HiveTyrantKronos: {
    M5: { prime1: 5200000, prime2: 5200000 },
    M4: { prime1: 4200000, prime2: 4200000 },
    M3: { prime1: 3600000, prime2: 3600000 },
    M2: { prime1: 3000000, prime2: 3000000 },
    M1: { prime1: 2400000, prime2: 2400000 },
    L5: { prime1: 1200000, prime2: 1200000 },
    L4: { prime1: 1000000, prime2: 1000000 },
    L3: { prime1: 800000, prime2: 800000 },
    L2: { prime1: 600000, prime2: 600000 },
    L1: { prime1: 400000, prime2: 400000 }
  },
  HiveTyrantLeviathan: {
    M5: { prime1: 5200000, prime2: 5200000 },
    M4: { prime1: 4200000, prime2: 4200000 },
    M3: { prime1: 3600000, prime2: 3600000 },
    M2: { prime1: 3000000, prime2: 3000000 },
    M1: { prime1: 2400000, prime2: 2400000 },
    L5: { prime1: 1200000, prime2: 1200000 },
    L4: { prime1: 1000000, prime2: 1000000 },
    L3: { prime1: 800000, prime2: 800000 },
    L2: { prime1: 600000, prime2: 600000 },
    L1: { prime1: 400000, prime2: 400000 }
  },
  Lion: {
    M5: { prime1: 5200000, prime2: 5200000 },
    M4: { prime1: 4200000, prime2: 4200000 },
    M3: { prime1: 3600000, prime2: 3600000 },
    M2: { prime1: 3000000, prime2: 3000000 },
    M1: { prime1: 2400000, prime2: 2400000 },
    L5: { prime1: 1200000, prime2: 1200000 },
    L4: { prime1: 1000000, prime2: 1000000 },
    L3: { prime1: 800000, prime2: 800000 },
    L2: { prime1: 600000, prime2: 600000 },
    L1: { prime1: 400000, prime2: 400000 }
  },
  Magnus: {
    M5: { prime1: 3900000, prime2: 4550000 },
    M4: { prime1: 3150000, prime2: 3675000 },
    M3: { prime1: 2700000, prime2: 3150000 },
    M2: { prime1: 2250000, prime2: 2625000 },
    M1: { prime1: 1800000, prime2: 2100000 },
    L5: { prime1: 900000, prime2: 1050000 },
    L4: { prime1: 750000, prime2: 875000 },
    L3: { prime1: 600000, prime2: 700000 },
    L2: { prime1: 450000, prime2: 525000 },
    L1: { prime1: 300000, prime2: 350000 }
  },
  Mortarion: {
    M5: { prime1: 4550000, prime2: 760200 },
    M4: { prime1: 3675000, prime2: 692300 },
    M3: { prime1: 3150000, prime2: 627900 },
    M2: { prime1: 2625000, prime2: 593600 },
    M1: { prime1: 2100000, prime2: 533400 },
    L5: { prime1: 1050000, prime2: 500500 },
    L4: { prime1: 875000, prime2: 380800 },
    L3: { prime1: 700000, prime2: 289100 },
    L2: { prime1: 525000, prime2: 231000 },
    L1: { prime1: 350000, prime2: 175000 }
  },
  Riptide: {
    M5: { prime1: 3900000, prime2: 3900000 },
    M4: { prime1: 3150000, prime2: 3150000 },
    M3: { prime1: 2700000, prime2: 2700000 },
    M2: { prime1: 2250000, prime2: 2250000 },
    M1: { prime1: 1800000, prime2: 1800000 },
    L5: { prime1: 900000, prime2: 900000 },
    L4: { prime1: 750000, prime2: 750000 },
    L3: { prime1: 600000, prime2: 600000 },
    L2: { prime1: 450000, prime2: 450000 },
    L1: { prime1: 300000, prime2: 300000 }
  },
  Rogaldorn: {
    M5: { prime1: 5200000, prime2: 4550000 },
    M4: { prime1: 4200000, prime2: 3675000 },
    M3: { prime1: 3600000, prime2: 3150000 },
    M2: { prime1: 3000000, prime2: 2625000 },
    M1: { prime1: 2400000, prime2: 2100000 },
    L5: { prime1: 1200000, prime2: 1050000 },
    L4: { prime1: 1000000, prime2: 875000 },
    L3: { prime1: 800000, prime2: 700000 },
    L2: { prime1: 600000, prime2: 525000 },
    L1: { prime1: 400000, prime2: 350000 }
  },
  ScreamerKiller: {
    M5: { prime1: 5200000, prime2: 5200000 },
    M4: { prime1: 4200000, prime2: 4200000 },
    M3: { prime1: 3600000, prime2: 3600000 },
    M2: { prime1: 3000000, prime2: 3000000 },
    M1: { prime1: 2400000, prime2: 2400000 },
    L5: { prime1: 1200000, prime2: 1200000 },
    L4: { prime1: 1000000, prime2: 1000000 },
    L3: { prime1: 800000, prime2: 800000 },
    L2: { prime1: 600000, prime2: 600000 },
    L1: { prime1: 400000, prime2: 400000 }
  },
  SilentKing: {
    M5: { prime1: 5200000, prime2: 5200000 },
    M4: { prime1: 4200000, prime2: 4200000 },
    M3: { prime1: 3600000, prime2: 3600000 },
    M2: { prime1: 3000000, prime2: 3000000 },
    M1: { prime1: 2400000, prime2: 2400000 },
    L5: { prime1: 1200000, prime2: 1200000 },
    L4: { prime1: 1000000, prime2: 1000000 },
    L3: { prime1: 800000, prime2: 800000 },
    L2: { prime1: 600000, prime2: 600000 },
    L1: { prime1: 400000, prime2: 400000 }
  },
  TervigonGorgon: {
    M5: { prime1: 5200000, prime2: 5200000 },
    M4: { prime1: 4200000, prime2: 4200000 },
    M3: { prime1: 3600000, prime2: 3600000 },
    M2: { prime1: 3000000, prime2: 3000000 },
    M1: { prime1: 2400000, prime2: 2400000 },
    L5: { prime1: 1200000, prime2: 1200000 },
    L4: { prime1: 1000000, prime2: 1000000 },
    L3: { prime1: 800000, prime2: 800000 },
    L2: { prime1: 600000, prime2: 600000 },
    L1: { prime1: 400000, prime2: 400000 }
  },
  TervigonKronos: {
    M5: { prime1: 5200000, prime2: 5200000 },
    M4: { prime1: 4200000, prime2: 4200000 },
    M3: { prime1: 3600000, prime2: 3600000 },
    M2: { prime1: 3000000, prime2: 3000000 },
    M1: { prime1: 2400000, prime2: 2400000 },
    L5: { prime1: 1200000, prime2: 1200000 },
    L4: { prime1: 1000000, prime2: 1000000 },
    L3: { prime1: 800000, prime2: 800000 },
    L2: { prime1: 600000, prime2: 600000 },
    L1: { prime1: 400000, prime2: 400000 }
  },
  TervigonLeviathan: {
    M5: { prime1: 5200000, prime2: 5200000 },
    M4: { prime1: 4200000, prime2: 4200000 },
    M3: { prime1: 3600000, prime2: 3600000 },
    M2: { prime1: 3000000, prime2: 3000000 },
    M1: { prime1: 2400000, prime2: 2400000 },
    L5: { prime1: 1200000, prime2: 1200000 },
    L4: { prime1: 1000000, prime2: 1000000 },
    L3: { prime1: 800000, prime2: 800000 },
    L2: { prime1: 600000, prime2: 600000 },
    L1: { prime1: 400000, prime2: 400000 }
  }
}
