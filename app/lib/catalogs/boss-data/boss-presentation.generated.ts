// Generated presentation catalog from the app's game-data and image assets.
// Do not edit by hand.

export interface GeneratedBossTier {
  name: string
  level: number
  health: number
  damage: number
  armor: number
}

export interface GeneratedBossOption {
  id: string
  name: string
  portrait: string
  traits: string[]
  size: { width: number; height: number }
  tiers: GeneratedBossTier[]
  maps: Array<{
    id: string
    name: string
    terrain: string[]
    backgroundImage: string
  }>
}

export const generatedBossEncounterAliases = {
  avatar: 'AvatarOfKhaine',
  avatarofkhaine: 'AvatarOfKhaine',
  belisarius: 'BelisariusRW',
  belisariuscawl: 'BelisariusRW',
  belisariusrw: 'BelisariusRW',
  ghazghkull: 'Ghazghkull',
  ghazghkullmagurukthraka: 'Ghazghkull',
  guildboss10boss1admecbelisarius: 'BelisariusRW',
  guildboss11boss1tauriptide: 'Riptide',
  guildboss12boss1darkalion: 'Lion',
  guildboss1boss1tyrantervigonleviathan: 'TervigonLeviathan',
  guildboss1boss2tyrantervigonkronos: 'TervigonKronos',
  guildboss1boss3tyrantervigongorgon: 'TervigonGorgon',
  guildboss2boss1tyranhivetyrantleviathan: 'HiveTyrantLeviathan',
  guildboss2boss2tyranhivetyrantkronos: 'HiveTyrantKronos',
  guildboss2boss3tyranhivetyrantgorgon: 'HiveTyrantGorgon',
  guildboss3boss1necrosilentking: 'SilentKing',
  guildboss4boss1orksghazghkull: 'Ghazghkull',
  guildboss5boss1deathmortarion: 'Mortarion',
  guildboss6boss1tyranscreamerkiller: 'ScreamerKiller',
  guildboss7boss1astrarogaldorn: 'RogalDorn',
  guildboss8boss1eldaravatar: 'AvatarOfKhaine',
  guildboss9boss1thousmagnus: 'Magnus',
  hivetyrant: 'HiveTyrantLeviathan',
  hivetyrantgorgon: 'HiveTyrantGorgon',
  hivetyranthivefleetgorgon: 'HiveTyrantGorgon',
  hivetyranthivefleetkronos: 'HiveTyrantKronos',
  hivetyranthivefleetleviathan: 'HiveTyrantLeviathan',
  hivetyrantkronos: 'HiveTyrantKronos',
  hivetyrantleviathan: 'HiveTyrantLeviathan',
  lion: 'Lion',
  lioneljonson: 'Lion',
  magnus: 'Magnus',
  magnusthered: 'Magnus',
  mortarion: 'Mortarion',
  mortarionthedeathlord: 'Mortarion',
  riptide: 'Riptide',
  rogal: 'RogalDorn',
  rogaldorn: 'RogalDorn',
  rogaldornbattletank: 'RogalDorn',
  screamer: 'ScreamerKiller',
  screamerkiller: 'ScreamerKiller',
  silentking: 'SilentKing',
  szarekh: 'SilentKing',
  tervigon: 'TervigonLeviathan',
  tervigongorgon: 'TervigonGorgon',
  tervigonhivefleetgorgon: 'TervigonGorgon',
  tervigonhivefleetkronos: 'TervigonKronos',
  tervigonhivefleetleviathan: 'TervigonLeviathan',
  tervigonkronos: 'TervigonKronos',
  tervigonleviathan: 'TervigonLeviathan',
  xv104riptidebattlesuit: 'Riptide'
} as const satisfies Record<string, string>

export const generatedBossActiveAbilityIds = {
  abraxas: ['MasterOfTheTutelaries'],
  actus: ['DefendTheDivineWork'],
  aethana: ['Loki_SwoopingHawk'],
  aethanabarantharal: ['Loki_SwoopingHawk'],
  arkarzarabraxas: ['MasterOfTheTutelaries'],
  avatar: [
    'TheWailingDoomSweeps',
    'TheWailingDoomStrikes',
    'TheWrathOfKhaineUnleashedReworked'
  ],
  avatarofkhaine: [
    'TheWailingDoomSweeps',
    'TheWailingDoomStrikes',
    'TheWrathOfKhaineUnleashedReworked'
  ],
  baraqiel: ['PlasmaCannon'],
  belisarius: [
    'InvocationOfMachineVengeance',
    'ArcScourge',
    'SolarAtomizer',
    'ShroudPsalm'
  ],
  belisariuscawl: [
    'InvocationOfMachineVengeance',
    'ArcScourge',
    'SolarAtomizer',
    'ShroudPsalm'
  ],
  belisariusrw: [
    'InvocationOfMachineVengeance',
    'ArcScourge',
    'SolarAtomizer',
    'ShroudPsalm'
  ],
  corrodius: ['Poxwalkers'],
  corrodiusachebile: ['Poxwalkers'],
  eldryon: ['Executioner'],
  eldryonynaduin: ['Executioner'],
  forcas: ['CalibaniteGreatsword'],
  forcasoathsworn: ['CalibaniteGreatsword'],
  ghazghkull: ['NeedsMoreDakka', 'DaGreatWaaagh', 'EreWeGo'],
  ghazghkullmagurukthraka: ['NeedsMoreDakka', 'DaGreatWaaagh', 'EreWeGo'],
  gibbascrapz: ['GrotTank'],
  gibbascrapzdaspezulist: ['GrotTank'],
  guildboss10boss1admecbelisarius: [
    'InvocationOfMachineVengeance',
    'ArcScourge',
    'SolarAtomizer',
    'ShroudPsalm'
  ],
  guildboss10miniboss1admecmarshall: ['DoctrinaImperatives'],
  guildboss10miniboss2admecmanipulus: ['DefendTheDivineWork'],
  guildboss11boss1tauriptide: ['NovaBoost', 'NovaCharge', 'NovaShield'],
  guildboss11miniboss1taumarksman: ['SeekerMissileFrequencyLock'],
  guildboss11miniboss2taucrisis: ['EarlyWarningOverride'],
  guildboss12boss1darkalion: [
    'InstrumentsOfVengeance',
    'MartialExemplar',
    'TheLionsWrath'
  ],
  guildboss12miniboss1darkaterminator: ['PlasmaCannon'],
  guildboss12miniboss2darkacompanion: ['CalibaniteGreatsword'],
  guildboss1boss1tyrantervigonleviathan: ['SpawnTermagants', 'Catalyst'],
  guildboss1boss2tyrantervigonkronos: ['SpawnTermagants2', 'Catalyst'],
  guildboss1boss3tyrantervigongorgon: ['SpawnTermagants3', 'Catalyst'],
  guildboss1miniboss1tyranwarriorleviathan: [
    'ScythingTalons',
    'CallRipperSwarms'
  ],
  guildboss1miniboss2tyranwarriorkronos: [
    'ScythingTalons',
    'CallRipperSwarms2'
  ],
  guildboss1miniboss3tyranwarriorgorgon: [
    'ScythingTalons',
    'CallRipperSwarms3'
  ],
  guildboss2boss1tyranhivetyrantleviathan: [
    'CallRipperSwarms',
    'Catalyst',
    'StranglethornCannon'
  ],
  guildboss2boss2tyranhivetyrantkronos: [
    'CallRipperSwarms2',
    'Catalyst',
    'StranglethornCannon'
  ],
  guildboss2boss3tyranhivetyrantgorgon: [
    'CallRipperSwarms3',
    'Catalyst',
    'StranglethornCannon'
  ],
  guildboss3boss1necrosilentking: [
    'BreathOfSilence',
    'AnnihilatorBeam',
    'MyWillBeDone'
  ],
  guildboss4boss1orksghazghkull: ['NeedsMoreDakka', 'DaGreatWaaagh', 'EreWeGo'],
  guildboss4miniboss1orksbigmek: ['GrotTank'],
  guildboss4miniboss2orksnob: ['UnstoppableMomentumReworked'],
  guildboss5boss1deathmortarion: [
    'MortarionsPlagueWind',
    'TheLantern',
    'ReapingScythe'
  ],
  guildboss5miniboss1deathrotbone: ['RevitalizingMalignancy'],
  guildboss5miniboss2deathblightbringer: ['Poxwalkers'],
  guildboss6boss1tyranscreamerkiller: [
    'DeathScream',
    'UnparalleledFerocity',
    'LivingBatteringRam'
  ],
  guildboss6miniboss1tyranneurothrope: ['SpiritLeech'],
  guildboss6miniboss2tyranwingedprime: ['AlphaWarrior'],
  guildboss7boss1astrarogaldorn: ['PoundThemToDust', 'GunnersKillOnSight'],
  guildboss7miniboss1astraprimarispsy: ['PsychicMaelstrom'],
  guildboss7miniboss2astraordnance: ['BasiliskBarrage'],
  guildboss8boss1eldaravatar: [
    'TheWailingDoomSweeps',
    'TheWailingDoomStrikes',
    'TheWrathOfKhaineUnleashedReworked'
  ],
  guildboss8miniboss1eldarautarch: ['Loki_SwoopingHawk'],
  guildboss8miniboss2eldarfarseer: ['Executioner'],
  guildboss9boss1thousmagnus: [
    'TzeentchsFirestorm',
    'TreasonOfTzeentch',
    'BladeOfMagnus'
  ],
  guildboss9miniboss1thoussorcerer: ['AttemptedPossession'],
  guildboss9miniboss2thousinfernalmaster: ['MasterOfTheTutelaries'],
  hivetyrant: ['CallRipperSwarms', 'Catalyst', 'StranglethornCannon'],
  hivetyrantgorgon: ['CallRipperSwarms3', 'Catalyst', 'StranglethornCannon'],
  hivetyranthivefleetgorgon: [
    'CallRipperSwarms3',
    'Catalyst',
    'StranglethornCannon'
  ],
  hivetyranthivefleetkronos: [
    'CallRipperSwarms2',
    'Catalyst',
    'StranglethornCannon'
  ],
  hivetyranthivefleetleviathan: [
    'CallRipperSwarms',
    'Catalyst',
    'StranglethornCannon'
  ],
  hivetyrantkronos: ['CallRipperSwarms2', 'Catalyst', 'StranglethornCannon'],
  hivetyrantleviathan: ['CallRipperSwarms', 'Catalyst', 'StranglethornCannon'],
  kairatarthaumachus: ['AttemptedPossession'],
  lion: ['InstrumentsOfVengeance', 'MartialExemplar', 'TheLionsWrath'],
  lioneljonson: ['InstrumentsOfVengeance', 'MartialExemplar', 'TheLionsWrath'],
  magnus: ['TzeentchsFirestorm', 'TreasonOfTzeentch', 'BladeOfMagnus'],
  magnusthered: ['TzeentchsFirestorm', 'TreasonOfTzeentch', 'BladeOfMagnus'],
  manipulusactusfulgorosus: ['DefendTheDivineWork'],
  mortarion: ['MortarionsPlagueWind', 'TheLantern', 'ReapingScythe'],
  mortarionthedeathlord: [
    'MortarionsPlagueWind',
    'TheLantern',
    'ReapingScythe'
  ],
  nauseousrotbone: ['RevitalizingMalignancy'],
  neurothrope: ['SpiritLeech'],
  ologtanksmasha: ['UnstoppableMomentumReworked'],
  revas: ['EarlyWarningOverride'],
  riptide: ['NovaBoost', 'NovaCharge', 'NovaShield'],
  rogaldorn: ['PoundThemToDust', 'GunnersKillOnSight'],
  rogaldornbattletank: ['PoundThemToDust', 'GunnersKillOnSight'],
  screamerkiller: ['DeathScream', 'UnparalleledFerocity', 'LivingBatteringRam'],
  shasuiviorlashosyl: ['SeekerMissileFrequencyLock'],
  shasvreviorlarevas: ['EarlyWarningOverride'],
  shosyl: ['SeekerMissileFrequencyLock'],
  sibylldevine: ['PsychicMaelstrom'],
  silentking: ['BreathOfSilence', 'AnnihilatorBeam', 'MyWillBeDone'],
  szarekh: ['BreathOfSilence', 'AnnihilatorBeam', 'MyWillBeDone'],
  tangida: ['DoctrinaImperatives'],
  tanksmasha: ['UnstoppableMomentumReworked'],
  tervigon: ['SpawnTermagants', 'Catalyst'],
  tervigongorgon: ['SpawnTermagants3', 'Catalyst'],
  tervigonhivefleetgorgon: ['SpawnTermagants3', 'Catalyst'],
  tervigonhivefleetkronos: ['SpawnTermagants2', 'Catalyst'],
  tervigonhivefleetleviathan: ['SpawnTermagants', 'Catalyst'],
  tervigonkronos: ['SpawnTermagants2', 'Catalyst'],
  tervigonleviathan: ['SpawnTermagants', 'Catalyst'],
  thaddeusnoble: ['BasiliskBarrage'],
  thaumachus: ['AttemptedPossession'],
  tyranidprime: ['ScythingTalons', 'CallRipperSwarms3'],
  tyranidprimegorgon: ['ScythingTalons', 'CallRipperSwarms3'],
  tyranidprimekronos: ['ScythingTalons', 'CallRipperSwarms2'],
  tyranidprimeleviathan: ['ScythingTalons', 'CallRipperSwarms'],
  wingedprime: ['AlphaWarrior'],
  wingedtyranidprime: ['AlphaWarrior'],
  xv104riptidebattlesuit: ['NovaBoost', 'NovaCharge', 'NovaShield']
} as const satisfies Record<string, readonly string[]>

export const generatedBossTraitsByLookupKey = {
  abraxas: ['Boss', 'Immune', 'WeaverOfFate', 'Psyker'],
  actus: ['Boss', 'Immune', 'Flying', 'Mechanic', 'Mechanical'],
  aethana: ['Boss', 'Immune', 'Flying', 'TeleportStrike'],
  aethanabarantharal: ['Boss', 'Immune', 'Flying', 'TeleportStrike'],
  arkarzarabraxas: ['Boss', 'Immune', 'WeaverOfFate', 'Psyker'],
  avatar: ['Boss', 'Immune', 'BigTarget', 'Daemon'],
  avatarofkhaine: ['Boss', 'Immune', 'BigTarget', 'Daemon'],
  baraqiel: [
    'Boss',
    'Immune',
    'TeleportStrike',
    'CrushingStrike',
    'HeavyWeapon',
    'TerminatorArmour'
  ],
  belisarius: ['Boss', 'Immune', 'BigTarget', 'Mechanical'],
  belisariuscawl: ['Boss', 'Immune', 'BigTarget', 'Mechanical'],
  belisariusrw: ['Boss', 'Immune', 'BigTarget', 'Mechanical'],
  corrodius: ['Boss', 'Immune', 'ContagionsOfNurgle', 'Resilient'],
  corrodiusachebile: ['Boss', 'Immune', 'ContagionsOfNurgle', 'Resilient'],
  eldryon: ['Boss', 'Immune', 'Psyker'],
  eldryonynaduin: ['Boss', 'Immune', 'Psyker'],
  forcas: ['Boss', 'Immune', 'Camouflage', 'Parry'],
  forcasoathsworn: ['Boss', 'Immune', 'Camouflage', 'Parry'],
  ghazghkull: ['BigTarget', 'Dakka', 'Immune', 'Boss', 'Mechanical'],
  ghazghkullmagurukthraka: [
    'BigTarget',
    'Dakka',
    'Immune',
    'Boss',
    'Mechanical'
  ],
  gibbascrapz: ['Boss', 'GetStuckIn', 'Mechanic', 'Immune'],
  gibbascrapzdaspezulist: ['Boss', 'GetStuckIn', 'Mechanic', 'Immune'],
  guildboss10boss1admecbelisarius: [
    'Boss',
    'Immune',
    'BigTarget',
    'Mechanical'
  ],
  guildboss10miniboss1admecmarshall: ['Boss', 'Immune', 'Mechanical'],
  guildboss10miniboss2admecmanipulus: [
    'Boss',
    'Immune',
    'Flying',
    'Mechanic',
    'Mechanical'
  ],
  guildboss11boss1tauriptide: [
    'Boss',
    'Immune',
    'BigTarget',
    'Flying',
    'IndirectFire',
    'Vehicle',
    'Mechanical'
  ],
  guildboss11miniboss1taumarksman: [
    'Boss',
    'Immune',
    'RangedSpecialist',
    'Camouflage'
  ],
  guildboss11miniboss2taucrisis: [
    'Boss',
    'Immune',
    'RangedSpecialist',
    'BigTarget',
    'Flying',
    'Mechanical'
  ],
  guildboss12boss1darkalion: [
    'Boss',
    'Immune',
    'BigTarget',
    'BeastSlayer',
    'Overwatch',
    'Parry'
  ],
  guildboss12miniboss1darkaterminator: [
    'Boss',
    'Immune',
    'TeleportStrike',
    'CrushingStrike',
    'HeavyWeapon',
    'TerminatorArmour'
  ],
  guildboss12miniboss2darkacompanion: ['Boss', 'Immune', 'Camouflage', 'Parry'],
  guildboss1boss1tyrantervigonleviathan: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune'
  ],
  guildboss1boss2tyrantervigonkronos: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune'
  ],
  guildboss1boss3tyrantervigongorgon: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune'
  ],
  guildboss1miniboss1tyranwarriorleviathan: [
    'Synapse',
    'BigTarget',
    'ShadowInTheWarp',
    'Boss',
    'Immune'
  ],
  guildboss1miniboss2tyranwarriorkronos: [
    'Synapse',
    'BigTarget',
    'ShadowInTheWarp',
    'Boss',
    'Immune'
  ],
  guildboss1miniboss3tyranwarriorgorgon: [
    'Synapse',
    'BigTarget',
    'ShadowInTheWarp',
    'Boss',
    'Immune'
  ],
  guildboss2boss1tyranhivetyrantleviathan: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune',
    'Flying'
  ],
  guildboss2boss2tyranhivetyrantkronos: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune',
    'Flying'
  ],
  guildboss2boss3tyranhivetyrantgorgon: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune',
    'Flying'
  ],
  guildboss3boss1necrosilentking: ['BigTarget', 'Immune', 'Mechanical', 'Boss'],
  guildboss4boss1orksghazghkull: [
    'BigTarget',
    'Dakka',
    'Immune',
    'Boss',
    'Mechanical'
  ],
  guildboss4miniboss1orksbigmek: ['Boss', 'GetStuckIn', 'Mechanic', 'Immune'],
  guildboss4miniboss2orksnob: [
    'Boss',
    'GetStuckIn',
    'BeastSlayer',
    'Unstoppable',
    'Immune'
  ],
  guildboss5boss1deathmortarion: [
    'Boss',
    'Immune',
    'ContagionsOfNurgle',
    'Daemon',
    'Flying',
    'Psyker',
    'BigTarget'
  ],
  guildboss5miniboss1deathrotbone: [
    'Boss',
    'Immune',
    'ContagionsOfNurgle',
    'Healer',
    'Resilient'
  ],
  guildboss5miniboss2deathblightbringer: [
    'Boss',
    'Immune',
    'ContagionsOfNurgle',
    'Resilient'
  ],
  guildboss6boss1tyranscreamerkiller: [
    'Boss',
    'Immune',
    'BigTarget',
    'InstinctiveBehaviour',
    'SuppressiveFire'
  ],
  guildboss6miniboss1tyranneurothrope: [
    'Boss',
    'Immune',
    'Synapse',
    'Flying',
    'Psyker',
    'ShadowInTheWarp',
    'RangedSpecialist'
  ],
  guildboss6miniboss2tyranwingedprime: [
    'Boss',
    'Immune',
    'Synapse',
    'Flying',
    'FinalJustice'
  ],
  guildboss7boss1astrarogaldorn: [
    'Boss',
    'Immune',
    'BigTarget',
    'Mechanical',
    'Vehicle'
  ],
  guildboss7miniboss1astraprimarispsy: ['Boss', 'Immune', 'Psyker'],
  guildboss7miniboss2astraordnance: [
    'Boss',
    'Immune',
    'SuppressiveFire',
    'IndirectFire'
  ],
  guildboss8boss1eldaravatar: ['Boss', 'Immune', 'BigTarget', 'Daemon'],
  guildboss8miniboss1eldarautarch: [
    'Boss',
    'Immune',
    'Flying',
    'TeleportStrike'
  ],
  guildboss8miniboss2eldarfarseer: ['Boss', 'Immune', 'Psyker'],
  guildboss9boss1thousmagnus: [
    'Boss',
    'Immune',
    'WeaverOfFate',
    'BigTarget',
    'Daemon',
    'Flying',
    'Psyker'
  ],
  guildboss9miniboss1thoussorcerer: [
    'Boss',
    'Immune',
    'WeaverOfFate',
    'Flying',
    'Psyker'
  ],
  guildboss9miniboss2thousinfernalmaster: [
    'Boss',
    'Immune',
    'WeaverOfFate',
    'Psyker'
  ],
  hivetyrant: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune',
    'Flying'
  ],
  hivetyrantgorgon: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune',
    'Flying'
  ],
  hivetyranthivefleetgorgon: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune',
    'Flying'
  ],
  hivetyranthivefleetkronos: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune',
    'Flying'
  ],
  hivetyranthivefleetleviathan: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune',
    'Flying'
  ],
  hivetyrantkronos: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune',
    'Flying'
  ],
  hivetyrantleviathan: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune',
    'Flying'
  ],
  kairatarthaumachus: ['Boss', 'Immune', 'WeaverOfFate', 'Flying', 'Psyker'],
  lion: ['Boss', 'Immune', 'BigTarget', 'BeastSlayer', 'Overwatch', 'Parry'],
  lioneljonson: [
    'Boss',
    'Immune',
    'BigTarget',
    'BeastSlayer',
    'Overwatch',
    'Parry'
  ],
  magnus: [
    'Boss',
    'Immune',
    'WeaverOfFate',
    'BigTarget',
    'Daemon',
    'Flying',
    'Psyker'
  ],
  magnusthered: [
    'Boss',
    'Immune',
    'WeaverOfFate',
    'BigTarget',
    'Daemon',
    'Flying',
    'Psyker'
  ],
  manipulusactusfulgorosus: [
    'Boss',
    'Immune',
    'Flying',
    'Mechanic',
    'Mechanical'
  ],
  mortarion: [
    'Boss',
    'Immune',
    'ContagionsOfNurgle',
    'Daemon',
    'Flying',
    'Psyker',
    'BigTarget'
  ],
  mortarionthedeathlord: [
    'Boss',
    'Immune',
    'ContagionsOfNurgle',
    'Daemon',
    'Flying',
    'Psyker',
    'BigTarget'
  ],
  nauseousrotbone: [
    'Boss',
    'Immune',
    'ContagionsOfNurgle',
    'Healer',
    'Resilient'
  ],
  neurothrope: [
    'Boss',
    'Immune',
    'Synapse',
    'Flying',
    'Psyker',
    'ShadowInTheWarp',
    'RangedSpecialist'
  ],
  ologtanksmasha: [
    'Boss',
    'GetStuckIn',
    'BeastSlayer',
    'Unstoppable',
    'Immune'
  ],
  revas: [
    'Boss',
    'Immune',
    'RangedSpecialist',
    'BigTarget',
    'Flying',
    'Mechanical'
  ],
  riptide: [
    'Boss',
    'Immune',
    'BigTarget',
    'Flying',
    'IndirectFire',
    'Vehicle',
    'Mechanical'
  ],
  rogaldorn: ['Boss', 'Immune', 'BigTarget', 'Mechanical', 'Vehicle'],
  rogaldornbattletank: ['Boss', 'Immune', 'BigTarget', 'Mechanical', 'Vehicle'],
  screamerkiller: [
    'Boss',
    'Immune',
    'BigTarget',
    'InstinctiveBehaviour',
    'SuppressiveFire'
  ],
  shasuiviorlashosyl: ['Boss', 'Immune', 'RangedSpecialist', 'Camouflage'],
  shasvreviorlarevas: [
    'Boss',
    'Immune',
    'RangedSpecialist',
    'BigTarget',
    'Flying',
    'Mechanical'
  ],
  shosyl: ['Boss', 'Immune', 'RangedSpecialist', 'Camouflage'],
  sibylldevine: ['Boss', 'Immune', 'Psyker'],
  silentking: ['BigTarget', 'Immune', 'Mechanical', 'Boss'],
  szarekh: ['BigTarget', 'Immune', 'Mechanical', 'Boss'],
  tangida: ['Boss', 'Immune', 'Mechanical'],
  tanksmasha: ['Boss', 'GetStuckIn', 'BeastSlayer', 'Unstoppable', 'Immune'],
  tervigon: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune'
  ],
  tervigongorgon: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune'
  ],
  tervigonhivefleetgorgon: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune'
  ],
  tervigonhivefleetkronos: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune'
  ],
  tervigonhivefleetleviathan: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune'
  ],
  tervigonkronos: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune'
  ],
  tervigonleviathan: [
    'Synapse',
    'ShadowInTheWarp',
    'Psyker',
    'Boss',
    'BigTarget',
    'Immune'
  ],
  thaddeusnoble: ['Boss', 'Immune', 'SuppressiveFire', 'IndirectFire'],
  thaumachus: ['Boss', 'Immune', 'WeaverOfFate', 'Flying', 'Psyker'],
  tyranidprime: ['Synapse', 'BigTarget', 'ShadowInTheWarp', 'Boss', 'Immune'],
  tyranidprimegorgon: [
    'Synapse',
    'BigTarget',
    'ShadowInTheWarp',
    'Boss',
    'Immune'
  ],
  tyranidprimekronos: [
    'Synapse',
    'BigTarget',
    'ShadowInTheWarp',
    'Boss',
    'Immune'
  ],
  tyranidprimeleviathan: [
    'Synapse',
    'BigTarget',
    'ShadowInTheWarp',
    'Boss',
    'Immune'
  ],
  wingedprime: ['Boss', 'Immune', 'Synapse', 'Flying', 'FinalJustice'],
  wingedtyranidprime: ['Boss', 'Immune', 'Synapse', 'Flying', 'FinalJustice'],
  xv104riptidebattlesuit: [
    'Boss',
    'Immune',
    'BigTarget',
    'Flying',
    'IndirectFire',
    'Vehicle',
    'Mechanical'
  ]
} as const satisfies Record<string, readonly string[]>

export const generatedBossFootprintSizes = {
  avatar: 7,
  avatarofkhaine: 7,
  belisarius: 3,
  belisariuscawl: 3,
  belisariusrw: 3,
  ghazghkull: 3,
  ghazghkullmagurukthraka: 3,
  guildboss10boss1admecbelisarius: 3,
  guildboss11boss1tauriptide: 7,
  guildboss12boss1darkalion: 3,
  guildboss1boss1tyrantervigonleviathan: 3,
  guildboss1boss2tyrantervigonkronos: 3,
  guildboss1boss3tyrantervigongorgon: 3,
  guildboss2boss1tyranhivetyrantleviathan: 3,
  guildboss2boss2tyranhivetyrantkronos: 3,
  guildboss2boss3tyranhivetyrantgorgon: 3,
  guildboss3boss1necrosilentking: 1,
  guildboss4boss1orksghazghkull: 3,
  guildboss5boss1deathmortarion: 7,
  guildboss6boss1tyranscreamerkiller: 3,
  guildboss7boss1astrarogaldorn: 7,
  guildboss8boss1eldaravatar: 7,
  guildboss9boss1thousmagnus: 7,
  hivetyrant: 3,
  hivetyrantgorgon: 3,
  hivetyranthivefleetgorgon: 3,
  hivetyranthivefleetkronos: 3,
  hivetyranthivefleetleviathan: 3,
  hivetyrantkronos: 3,
  hivetyrantleviathan: 3,
  lion: 3,
  lioneljonson: 3,
  magnus: 7,
  magnusthered: 7,
  mortarion: 7,
  mortarionthedeathlord: 7,
  riptide: 7,
  rogaldorn: 7,
  rogaldornbattletank: 7,
  screamerkiller: 3,
  silentking: 1,
  szarekh: 1,
  tervigon: 3,
  tervigongorgon: 3,
  tervigonhivefleetgorgon: 3,
  tervigonhivefleetkronos: 3,
  tervigonhivefleetleviathan: 3,
  tervigonkronos: 3,
  tervigonleviathan: 3,
  xv104riptidebattlesuit: 7
} as const satisfies Record<string, number>

export const generatedBossPrimeNames = {
  avatar: {
    prime1: 'Aethana',
    prime2: 'Eldryon'
  },
  avatarofkhaine: {
    prime1: 'Aethana',
    prime2: 'Eldryon'
  },
  belisarius: {
    prime1: "Tan Gi'da",
    prime2: 'Actus'
  },
  belisariuscawl: {
    prime1: "Tan Gi'da",
    prime2: 'Actus'
  },
  belisariusrw: {
    prime1: "Tan Gi'da",
    prime2: 'Actus'
  },
  ghazghkull: {
    prime1: 'Gibbascrapz',
    prime2: 'Tanksmasha'
  },
  ghazghkullmagurukthraka: {
    prime1: 'Gibbascrapz',
    prime2: 'Tanksmasha'
  },
  guildboss10boss1admecbelisarius: {
    prime1: "Tan Gi'da",
    prime2: 'Actus'
  },
  guildboss11boss1tauriptide: {
    prime1: "Sho'syl",
    prime2: "Re'vas"
  },
  guildboss12boss1darkalion: {
    prime1: 'Baraqiel',
    prime2: 'Forcas'
  },
  guildboss1boss1tyrantervigonleviathan: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  guildboss1boss2tyrantervigonkronos: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  guildboss1boss3tyrantervigongorgon: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  guildboss2boss1tyranhivetyrantleviathan: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  guildboss2boss2tyranhivetyrantkronos: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  guildboss2boss3tyranhivetyrantgorgon: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  guildboss3boss1necrosilentking: {
    prime1: 'Triarchal Menhir 1',
    prime2: 'Triarchal Menhir 2'
  },
  guildboss4boss1orksghazghkull: {
    prime1: 'Gibbascrapz',
    prime2: 'Tanksmasha'
  },
  guildboss5boss1deathmortarion: {
    prime1: 'Nauseous Rotbone',
    prime2: 'Corrodius'
  },
  guildboss6boss1tyranscreamerkiller: {
    prime1: 'Neurothrope',
    prime2: 'Winged Prime'
  },
  guildboss7boss1astrarogaldorn: {
    prime1: 'Sibyll Devine',
    prime2: 'Thaddeus Noble'
  },
  guildboss8boss1eldaravatar: {
    prime1: 'Aethana',
    prime2: 'Eldryon'
  },
  guildboss9boss1thousmagnus: {
    prime1: 'Thaumachus',
    prime2: 'Abraxas'
  },
  hivetyrant: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  hivetyrantgorgon: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  hivetyranthivefleetgorgon: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  hivetyranthivefleetkronos: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  hivetyranthivefleetleviathan: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  hivetyrantkronos: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  hivetyrantleviathan: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  lion: {
    prime1: 'Baraqiel',
    prime2: 'Forcas'
  },
  lioneljonson: {
    prime1: 'Baraqiel',
    prime2: 'Forcas'
  },
  magnus: {
    prime1: 'Thaumachus',
    prime2: 'Abraxas'
  },
  magnusthered: {
    prime1: 'Thaumachus',
    prime2: 'Abraxas'
  },
  mortarion: {
    prime1: 'Nauseous Rotbone',
    prime2: 'Corrodius'
  },
  mortarionthedeathlord: {
    prime1: 'Nauseous Rotbone',
    prime2: 'Corrodius'
  },
  riptide: {
    prime1: "Sho'syl",
    prime2: "Re'vas"
  },
  rogaldorn: {
    prime1: 'Sibyll Devine',
    prime2: 'Thaddeus Noble'
  },
  rogaldornbattletank: {
    prime1: 'Sibyll Devine',
    prime2: 'Thaddeus Noble'
  },
  screamerkiller: {
    prime1: 'Neurothrope',
    prime2: 'Winged Prime'
  },
  silentking: {
    prime1: 'Triarchal Menhir 1',
    prime2: 'Triarchal Menhir 2'
  },
  szarekh: {
    prime1: 'Triarchal Menhir 1',
    prime2: 'Triarchal Menhir 2'
  },
  tervigon: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  tervigongorgon: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  tervigonhivefleetgorgon: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  tervigonhivefleetkronos: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  tervigonhivefleetleviathan: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  tervigonkronos: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  tervigonleviathan: {
    prime1: 'Tyranid Prime 1',
    prime2: 'Tyranid Prime 2'
  },
  xv104riptidebattlesuit: {
    prime1: "Sho'syl",
    prime2: "Re'vas"
  }
} as const satisfies Record<string, { prime1: string; prime2: string }>

export const generatedBossOptions = [
  {
    id: 'avatar',
    name: 'Avatar of Khaine',
    portrait: '/images/bosses/portraits/avatarofkhaine_main.png',
    traits: ['Boss', 'Immune', 'BigTarget', 'Daemon'],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1000000,
        damage: 389,
        armor: 304
      },
      {
        name: 'E2',
        level: 2,
        health: 1250000,
        damage: 480,
        armor: 375
      },
      {
        name: 'E3',
        level: 3,
        health: 1500000,
        damage: 557,
        armor: 435
      },
      {
        name: 'E4',
        level: 4,
        health: 1750000,
        damage: 686,
        armor: 535
      },
      {
        name: 'E5',
        level: 5,
        health: 2080000,
        damage: 797,
        armor: 622
      },
      {
        name: 'L1',
        level: 1,
        health: 4165000,
        damage: 998,
        armor: 779
      },
      {
        name: 'L2',
        level: 2,
        health: 6250000,
        damage: 1319,
        armor: 1029
      },
      {
        name: 'L3',
        level: 3,
        health: 8330000,
        damage: 1651,
        armor: 1288
      },
      {
        name: 'L4',
        level: 4,
        health: 10400000,
        damage: 2176,
        armor: 1697
      },
      {
        name: 'L5',
        level: 5,
        health: 12500000,
        damage: 2861,
        armor: 2231
      },
      {
        name: 'M1',
        level: 1,
        health: 25000000,
        damage: 3326,
        armor: 2593
      },
      {
        name: 'M2',
        level: 2,
        health: 31250000,
        damage: 3765,
        armor: 2935
      },
      {
        name: 'M3',
        level: 3,
        health: 37500000,
        damage: 4091,
        armor: 3189
      },
      {
        name: 'M4',
        level: 4,
        health: 43750000,
        damage: 4630,
        armor: 3609
      },
      {
        name: 'M5',
        level: 5,
        health: 50000000,
        damage: 5213,
        armor: 4064
      }
    ],
    maps: [
      {
        id: 'GB_Khaine_02',
        name: 'Khaine 02',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Khaine_02&boss=avatar'
      },
      {
        id: 'GB_Khaine_05',
        name: 'Khaine 05',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Khaine_05&boss=avatar'
      },
      {
        id: 'GB_Khaine_01',
        name: 'Khaine 01',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Khaine_01&boss=avatar'
      }
    ]
  },
  {
    id: 'belisarius',
    name: 'Belisarius Cawl',
    portrait: '/images/bosses/portraits/belisarius_main.png',
    traits: ['Boss', 'Immune', 'BigTarget', 'Mechanical'],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 389,
        armor: 260
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 480,
        armor: 321
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 557,
        armor: 372
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 686,
        armor: 458
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 797,
        armor: 532
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 998,
        armor: 666
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 1319,
        armor: 880
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 1651,
        armor: 1102
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 2176,
        armor: 1452
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 2861,
        armor: 1909
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 3326,
        armor: 2219
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 3765,
        armor: 2512
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 4091,
        armor: 2730
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 4630,
        armor: 3090
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 5213,
        armor: 3479
      }
    ],
    maps: [
      {
        id: 'GB_Belisarius_01',
        name: 'Belisarius 01',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Belisarius_01&boss=belisarius'
      },
      {
        id: 'GB_Belisarius_02',
        name: 'Belisarius 02',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Belisarius_02&boss=belisarius'
      },
      {
        id: 'GB_Belisarius_03',
        name: 'Belisarius 03',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Belisarius_03&boss=belisarius'
      }
    ]
  },
  {
    id: 'ghazghkull',
    name: 'Ghazghkull Mag Uruk Thraka',
    portrait: '/images/bosses/portraits/ghazghkull_main.png',
    traits: ['BigTarget', 'Dakka', 'Immune', 'Boss', 'Mechanical'],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1000000,
        damage: 323,
        armor: 138
      },
      {
        name: 'E2',
        level: 2,
        health: 1250000,
        damage: 399,
        armor: 170
      },
      {
        name: 'E3',
        level: 3,
        health: 1500000,
        damage: 463,
        armor: 197
      },
      {
        name: 'E4',
        level: 4,
        health: 1750000,
        damage: 570,
        armor: 242
      },
      {
        name: 'E5',
        level: 5,
        health: 2080000,
        damage: 663,
        armor: 281
      },
      {
        name: 'L1',
        level: 1,
        health: 4165000,
        damage: 830,
        armor: 352
      },
      {
        name: 'L2',
        level: 2,
        health: 6250000,
        damage: 1097,
        armor: 465
      },
      {
        name: 'L3',
        level: 3,
        health: 8330000,
        damage: 1373,
        armor: 582
      },
      {
        name: 'L4',
        level: 4,
        health: 10400000,
        damage: 1809,
        armor: 767
      },
      {
        name: 'L5',
        level: 5,
        health: 12500000,
        damage: 2378,
        armor: 1008
      },
      {
        name: 'M1',
        level: 1,
        health: 25000000,
        damage: 2764,
        armor: 1172
      },
      {
        name: 'M2',
        level: 2,
        health: 31250000,
        damage: 3129,
        armor: 1327
      },
      {
        name: 'M3',
        level: 3,
        health: 37500000,
        damage: 3400,
        armor: 1442
      },
      {
        name: 'M4',
        level: 4,
        health: 43750000,
        damage: 3848,
        armor: 1632
      },
      {
        name: 'M5',
        level: 5,
        health: 50000000,
        damage: 4333,
        armor: 1838
      }
    ],
    maps: [
      {
        id: 'GB_Dakka_01',
        name: 'Dakka 01',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Dakka_01&boss=ghazghkull'
      },
      {
        id: 'GB_Dakka_04',
        name: 'Dakka 04',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Dakka_04&boss=ghazghkull'
      },
      {
        id: 'GB_Dakka_02',
        name: 'Dakka 02',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Dakka_02&boss=ghazghkull'
      },
      {
        id: 'GB_Dakka_05',
        name: 'Dakka 05',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Dakka_05&boss=ghazghkull'
      },
      {
        id: 'GB_Dakka_03',
        name: 'Dakka 03',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Dakka_03&boss=ghazghkull'
      },
      {
        id: 'GB_Dakka_03_1',
        name: 'Dakka 03 1',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Dakka_03_1&boss=ghazghkull'
      }
    ]
  },
  {
    id: 'hivetyrantgorgon',
    name: 'Hive Tyrant (Hive Fleet Gorgon)',
    portrait: '/images/bosses/portraits/hivetyrantgorgon_main.png',
    traits: [
      'Synapse',
      'ShadowInTheWarp',
      'Psyker',
      'Boss',
      'BigTarget',
      'Immune',
      'Flying'
    ],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 254,
        armor: 212
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 314,
        armor: 262
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 364,
        armor: 304
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 448,
        armor: 374
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 521,
        armor: 435
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 652,
        armor: 545
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 862,
        armor: 720
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 1079,
        armor: 901
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 1422,
        armor: 1187
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 1869,
        armor: 1560
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 2173,
        armor: 1813
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 2460,
        armor: 2052
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 2673,
        armor: 2230
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 3025,
        armor: 2524
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 3406,
        armor: 2842
      }
    ],
    maps: [
      {
        id: 'GB_04',
        name: '04',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_04&boss=hivetyrantgorgon'
      },
      {
        id: 'GB_03',
        name: '03',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_03&boss=hivetyrantgorgon'
      },
      {
        id: 'GB_support_09',
        name: 'Prime Support 09',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_09&boss=hivetyrantgorgon'
      },
      {
        id: 'GB_support_11',
        name: 'Prime Support 11',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_11&boss=hivetyrantgorgon'
      },
      {
        id: 'GB_support_05',
        name: 'Prime Support 05',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_05&boss=hivetyrantgorgon'
      },
      {
        id: 'GB_support_06',
        name: 'Prime Support 06',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_06&boss=hivetyrantgorgon'
      }
    ]
  },
  {
    id: 'hivetyrantkronos',
    name: 'Hive Tyrant (Hive Fleet Kronos)',
    portrait: '/images/bosses/portraits/hivetyrantkronos_main.png',
    traits: [
      'Synapse',
      'ShadowInTheWarp',
      'Psyker',
      'Boss',
      'BigTarget',
      'Immune',
      'Flying'
    ],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 289,
        armor: 179
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 357,
        armor: 221
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 414,
        armor: 256
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 510,
        armor: 315
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 593,
        armor: 366
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 742,
        armor: 458
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 981,
        armor: 605
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 1228,
        armor: 757
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 1618,
        armor: 998
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 2127,
        armor: 1312
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 2472,
        armor: 1525
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 2798,
        armor: 1726
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 3041,
        armor: 1876
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 3442,
        armor: 2123
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 3876,
        armor: 2390
      }
    ],
    maps: [
      {
        id: 'GB_06',
        name: '06',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_06&boss=hivetyrantkronos'
      },
      {
        id: 'GB_02',
        name: '02',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_02&boss=hivetyrantkronos'
      },
      {
        id: 'GB_support_07',
        name: 'Prime Support 07',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_07&boss=hivetyrantkronos'
      },
      {
        id: 'GB_support_08',
        name: 'Prime Support 08',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_08&boss=hivetyrantkronos'
      },
      {
        id: 'GB_support_01',
        name: 'Prime Support 01',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_01&boss=hivetyrantkronos'
      },
      {
        id: 'GB_support_02',
        name: 'Prime Support 02',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_02&boss=hivetyrantkronos'
      }
    ]
  },
  {
    id: 'hivetyrantleviathan',
    name: 'Hive Tyrant (Hive Fleet Leviathan)',
    portrait: '/images/bosses/portraits/hivetyrantleviathan_main.png',
    traits: [
      'Synapse',
      'ShadowInTheWarp',
      'Psyker',
      'Boss',
      'BigTarget',
      'Immune',
      'Flying'
    ],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 323,
        armor: 138
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 399,
        armor: 170
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 463,
        armor: 197
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 570,
        armor: 242
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 663,
        armor: 281
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 830,
        armor: 352
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 1097,
        armor: 465
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 1373,
        armor: 582
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 1809,
        armor: 767
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 2378,
        armor: 1008
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 2764,
        armor: 1172
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 3129,
        armor: 1327
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 3400,
        armor: 1442
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 3848,
        armor: 1632
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 4333,
        armor: 1838
      }
    ],
    maps: [
      {
        id: 'GB_02',
        name: '02',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_02&boss=hivetyrantleviathan'
      },
      {
        id: 'GB_05',
        name: '05',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_05&boss=hivetyrantleviathan'
      },
      {
        id: 'GB_01',
        name: '01',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_01&boss=hivetyrantleviathan'
      },
      {
        id: 'GB_support_03',
        name: 'Prime Support 03',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_03&boss=hivetyrantleviathan'
      },
      {
        id: 'GB_support_04',
        name: 'Prime Support 04',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_04&boss=hivetyrantleviathan'
      },
      {
        id: 'GB_support_01',
        name: 'Prime Support 01',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_01&boss=hivetyrantleviathan'
      },
      {
        id: 'GB_support_02',
        name: 'Prime Support 02',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_02&boss=hivetyrantleviathan'
      }
    ]
  },
  {
    id: 'lion',
    name: "Lion El'Jonson",
    portrait: '/images/bosses/portraits/lion_main.png',
    traits: [
      'Boss',
      'Immune',
      'BigTarget',
      'BeastSlayer',
      'Overwatch',
      'Parry'
    ],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 304,
        armor: 337
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 375,
        armor: 416
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 435,
        armor: 483
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 535,
        armor: 595
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 622,
        armor: 692
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 779,
        armor: 866
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 1029,
        armor: 1144
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 1288,
        armor: 1432
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 1697,
        armor: 1887
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 2231,
        armor: 2481
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 2593,
        armor: 2884
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 2935,
        armor: 3264
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 3189,
        armor: 3547
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 3609,
        armor: 4015
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 4064,
        armor: 4521
      }
    ],
    maps: [
      {
        id: 'GB_Lion_02',
        name: 'Lion 02',
        terrain: ['normal'],
        backgroundImage: '/api/battle/board-image?board=GB_Lion_02&boss=lion'
      },
      {
        id: 'GB_Lion_03',
        name: 'Lion 03',
        terrain: ['normal'],
        backgroundImage: '/api/battle/board-image?board=GB_Lion_03&boss=lion'
      },
      {
        id: 'GB_Lion_01',
        name: 'Lion 01',
        terrain: ['normal'],
        backgroundImage: '/api/battle/board-image?board=GB_Lion_01&boss=lion'
      }
    ]
  },
  {
    id: 'magnus',
    name: 'Magnus the Red',
    portrait: '/images/bosses/portraits/magnus_main.png',
    traits: [
      'Boss',
      'Immune',
      'WeaverOfFate',
      'BigTarget',
      'Daemon',
      'Flying',
      'Psyker'
    ],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 338,
        armor: 233
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 417,
        armor: 288
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 484,
        armor: 334
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 596,
        armor: 411
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 693,
        armor: 478
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 868,
        armor: 598
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 1147,
        armor: 790
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 1436,
        armor: 989
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 1892,
        armor: 1303
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 2487,
        armor: 1713
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 2891,
        armor: 1991
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 3272,
        armor: 2254
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 3556,
        armor: 2449
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 4025,
        armor: 2772
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 4532,
        armor: 3121
      }
    ],
    maps: [
      {
        id: 'GB_Magnus_03',
        name: 'Magnus 03',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Magnus_03&boss=magnus'
      },
      {
        id: 'GB_Magnus_02',
        name: 'Magnus 02',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Magnus_02&boss=magnus'
      }
    ]
  },
  {
    id: 'mortarion',
    name: 'Mortarion, the Death Lord',
    portrait: '/images/bosses/portraits/mortarion_main.png',
    traits: [
      'Boss',
      'Immune',
      'ContagionsOfNurgle',
      'Daemon',
      'Flying',
      'Psyker',
      'BigTarget'
    ],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 304,
        armor: 911
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 375,
        armor: 1125
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 435,
        armor: 1305
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 535,
        armor: 1606
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 622,
        armor: 1867
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 779,
        armor: 2337
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 1029,
        armor: 3088
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 1288,
        armor: 3866
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 1697,
        armor: 5095
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 2231,
        armor: 6698
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 2593,
        armor: 7786
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 2935,
        armor: 8813
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 3189,
        armor: 9577
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 3609,
        armor: 10840
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 4064,
        armor: 12206
      }
    ],
    maps: [
      {
        id: 'GB_Mortarion_03',
        name: 'Mortarion 03',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Mortarion_03&boss=mortarion'
      },
      {
        id: 'GB_Mortarion_04',
        name: 'Mortarion 04',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Mortarion_04&boss=mortarion'
      },
      {
        id: 'GB_Mortarion_01',
        name: 'Mortarion 01',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Mortarion_01&boss=mortarion'
      }
    ]
  },
  {
    id: 'rogaldorn',
    name: 'Rogal Dorn Battle Tank',
    portrait: '/images/bosses/portraits/rogaldorn_main.png',
    traits: ['Boss', 'Immune', 'BigTarget', 'Mechanical', 'Vehicle'],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 389,
        armor: 517
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 480,
        armor: 639
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 557,
        armor: 741
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 686,
        armor: 912
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 797,
        armor: 1060
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 998,
        armor: 1327
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 1319,
        armor: 1754
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 1651,
        armor: 2196
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 2176,
        armor: 2894
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 2861,
        armor: 3804
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 3326,
        armor: 4422
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 3765,
        armor: 5005
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 4091,
        armor: 5439
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 4630,
        armor: 6156
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 5213,
        armor: 6932
      }
    ],
    maps: [
      {
        id: 'GB_RogalDorn_04',
        name: 'RogalDorn 04',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_RogalDorn_04&boss=rogaldorn'
      },
      {
        id: 'GB_RogalDorn_06',
        name: 'RogalDorn 06',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_RogalDorn_06&boss=rogaldorn'
      },
      {
        id: 'GB_RogalDorn_02',
        name: 'RogalDorn 02',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_RogalDorn_02&boss=rogaldorn'
      },
      {
        id: 'GB_RogalDorn_03',
        name: 'RogalDorn 03',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_RogalDorn_03&boss=rogaldorn'
      },
      {
        id: 'GB_RogalDorn_05',
        name: 'RogalDorn 05',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_RogalDorn_05&boss=rogaldorn'
      }
    ]
  },
  {
    id: 'screamerkiller',
    name: 'Screamer-Killer',
    portrait: '/images/bosses/portraits/screamerkiller_main.png',
    traits: [
      'Boss',
      'Immune',
      'BigTarget',
      'InstinctiveBehaviour',
      'SuppressiveFire'
    ],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 323,
        armor: 389
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 399,
        armor: 480
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 463,
        armor: 557
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 570,
        armor: 686
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 663,
        armor: 797
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 830,
        armor: 998
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 1097,
        armor: 1319
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 1373,
        armor: 1651
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 1809,
        armor: 2176
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 2378,
        armor: 2861
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 2764,
        armor: 3326
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 3129,
        armor: 3765
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 3400,
        armor: 4091
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 3848,
        armor: 4630
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 4333,
        armor: 5213
      }
    ],
    maps: [
      {
        id: 'GB_Screamer_03',
        name: 'Screamer 03',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Screamer_03&boss=screamerkiller'
      },
      {
        id: 'GB_Screamer_04',
        name: 'Screamer 04',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Screamer_04&boss=screamerkiller'
      },
      {
        id: 'GB_Screamer_01',
        name: 'Screamer 01',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Screamer_01&boss=screamerkiller'
      },
      {
        id: 'GB_Screamer_support_08',
        name: 'Prime Support 08',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Screamer_support_08&boss=screamerkiller'
      },
      {
        id: 'GB_Screamer_support_04',
        name: 'Prime Support 04',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Screamer_support_04&boss=screamerkiller'
      },
      {
        id: 'GB_Screamer_support_02',
        name: 'Prime Support 02',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Screamer_support_02&boss=screamerkiller'
      },
      {
        id: 'GB_Screamer_support_06',
        name: 'Prime Support 06',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Screamer_support_06&boss=screamerkiller'
      }
    ]
  },
  {
    id: 'silentking',
    name: 'Szarekh',
    portrait: '/images/bosses/portraits/silentking_main.png',
    traits: ['BigTarget', 'Immune', 'Mechanical', 'Boss'],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 143,
        armor: 143
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 177,
        armor: 177
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 205,
        armor: 205
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 252,
        armor: 252
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 293,
        armor: 293
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 367,
        armor: 367
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 485,
        armor: 485
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 607,
        armor: 607
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 800,
        armor: 800
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 1052,
        armor: 1052
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 1223,
        armor: 1223
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 1384,
        armor: 1384
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 1504,
        armor: 1504
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 1702,
        armor: 1702
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 1916,
        armor: 1916
      }
    ],
    maps: [
      {
        id: 'GB_SK_04',
        name: 'SK 04',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_SK_04&boss=silentking'
      },
      {
        id: 'GB_SK_03',
        name: 'SK 03',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_SK_03&boss=silentking'
      },
      {
        id: 'GB_SK_02',
        name: 'SK 02',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_SK_02&boss=silentking'
      }
    ]
  },
  {
    id: 'tervigongorgon',
    name: 'Tervigon (Hive Fleet Gorgon)',
    portrait: '/images/bosses/portraits/tervigongorgon_main.png',
    traits: [
      'Synapse',
      'ShadowInTheWarp',
      'Psyker',
      'Boss',
      'BigTarget',
      'Immune'
    ],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 254,
        armor: 212
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 314,
        armor: 262
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 364,
        armor: 304
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 448,
        armor: 374
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 521,
        armor: 435
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 652,
        armor: 545
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 862,
        armor: 720
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 1079,
        armor: 901
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 1422,
        armor: 1187
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 1869,
        armor: 1560
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 2173,
        armor: 1813
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 2460,
        armor: 2052
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 2673,
        armor: 2230
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 3025,
        armor: 2524
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 3406,
        armor: 2842
      }
    ],
    maps: [
      {
        id: 'GB_03',
        name: '03',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_03&boss=tervigongorgon'
      },
      {
        id: 'GB_04',
        name: '04',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_04&boss=tervigongorgon'
      },
      {
        id: 'GB_support_05',
        name: 'Prime Support 05',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_05&boss=tervigongorgon'
      },
      {
        id: 'GB_support_06',
        name: 'Prime Support 06',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_06&boss=tervigongorgon'
      },
      {
        id: 'GB_support_09',
        name: 'Prime Support 09',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_09&boss=tervigongorgon'
      },
      {
        id: 'GB_support_11',
        name: 'Prime Support 11',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_11&boss=tervigongorgon'
      }
    ]
  },
  {
    id: 'tervigonkronos',
    name: 'Tervigon (Hive Fleet Kronos)',
    portrait: '/images/bosses/portraits/tervigonkronos_main.png',
    traits: [
      'Synapse',
      'ShadowInTheWarp',
      'Psyker',
      'Boss',
      'BigTarget',
      'Immune'
    ],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 289,
        armor: 179
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 357,
        armor: 221
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 414,
        armor: 256
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 510,
        armor: 315
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 593,
        armor: 366
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 742,
        armor: 458
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 981,
        armor: 605
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 1228,
        armor: 757
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 1618,
        armor: 998
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 2127,
        armor: 1312
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 2472,
        armor: 1525
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 2798,
        armor: 1726
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 3041,
        armor: 1876
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 3442,
        armor: 2123
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 3876,
        armor: 2390
      }
    ],
    maps: [
      {
        id: 'GB_01',
        name: '01',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_01&boss=tervigonkronos'
      },
      {
        id: 'GB_06',
        name: '06',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_06&boss=tervigonkronos'
      },
      {
        id: 'GB_support_03',
        name: 'Prime Support 03',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_03&boss=tervigonkronos'
      },
      {
        id: 'GB_support_04',
        name: 'Prime Support 04',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_04&boss=tervigonkronos'
      },
      {
        id: 'GB_support_07',
        name: 'Prime Support 07',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_07&boss=tervigonkronos'
      },
      {
        id: 'GB_support_08',
        name: 'Prime Support 08',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_08&boss=tervigonkronos'
      }
    ]
  },
  {
    id: 'tervigonleviathan',
    name: 'Tervigon (Hive Fleet Leviathan)',
    portrait: '/images/bosses/portraits/tervigonleviathan_main.png',
    traits: [
      'Synapse',
      'ShadowInTheWarp',
      'Psyker',
      'Boss',
      'BigTarget',
      'Immune'
    ],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 323,
        armor: 138
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 399,
        armor: 170
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 463,
        armor: 197
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 570,
        armor: 242
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 663,
        armor: 281
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 830,
        armor: 352
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 1097,
        armor: 465
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 1373,
        armor: 582
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 1809,
        armor: 767
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 2378,
        armor: 1008
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 2764,
        armor: 1172
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 3129,
        armor: 1327
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 3400,
        armor: 1442
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 3848,
        armor: 1632
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 4333,
        armor: 1838
      }
    ],
    maps: [
      {
        id: 'GB_05',
        name: '05',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_05&boss=tervigonleviathan'
      },
      {
        id: 'GB_01',
        name: '01',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_01&boss=tervigonleviathan'
      },
      {
        id: 'GB_support_01',
        name: 'Prime Support 01',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_01&boss=tervigonleviathan'
      },
      {
        id: 'GB_support_02',
        name: 'Prime Support 02',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_support_02&boss=tervigonleviathan'
      }
    ]
  },
  {
    id: 'riptide',
    name: 'XV104 Riptide Battlesuit',
    portrait: '/images/bosses/portraits/riptide_main.png',
    traits: [
      'Boss',
      'Immune',
      'BigTarget',
      'Flying',
      'IndirectFire',
      'Vehicle',
      'Mechanical'
    ],
    size: {
      width: 2,
      height: 2
    },
    tiers: [
      {
        name: 'E1',
        level: 1,
        health: 1200000,
        damage: 323,
        armor: 389
      },
      {
        name: 'E2',
        level: 2,
        health: 1500000,
        damage: 399,
        armor: 480
      },
      {
        name: 'E3',
        level: 3,
        health: 1800000,
        damage: 463,
        armor: 557
      },
      {
        name: 'E4',
        level: 4,
        health: 2100000,
        damage: 570,
        armor: 686
      },
      {
        name: 'E5',
        level: 5,
        health: 2500000,
        damage: 663,
        armor: 797
      },
      {
        name: 'L1',
        level: 1,
        health: 5000000,
        damage: 830,
        armor: 998
      },
      {
        name: 'L2',
        level: 2,
        health: 7500000,
        damage: 1097,
        armor: 1319
      },
      {
        name: 'L3',
        level: 3,
        health: 10000000,
        damage: 1373,
        armor: 1651
      },
      {
        name: 'L4',
        level: 4,
        health: 12500000,
        damage: 1809,
        armor: 2176
      },
      {
        name: 'L5',
        level: 5,
        health: 15000000,
        damage: 2378,
        armor: 2861
      },
      {
        name: 'M1',
        level: 1,
        health: 30000000,
        damage: 2764,
        armor: 3326
      },
      {
        name: 'M2',
        level: 2,
        health: 37500000,
        damage: 3129,
        armor: 3765
      },
      {
        name: 'M3',
        level: 3,
        health: 45000000,
        damage: 3400,
        armor: 4091
      },
      {
        name: 'M4',
        level: 4,
        health: 52500000,
        damage: 3848,
        armor: 4630
      },
      {
        name: 'M5',
        level: 5,
        health: 65000000,
        damage: 4333,
        armor: 5213
      }
    ],
    maps: [
      {
        id: 'GB_Riptide_01',
        name: 'Riptide 01',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Riptide_01&boss=riptide'
      },
      {
        id: 'GB_Riptide_03',
        name: 'Riptide 03',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Riptide_03&boss=riptide'
      },
      {
        id: 'GB_Riptide_02',
        name: 'Riptide 02',
        terrain: ['normal'],
        backgroundImage:
          '/api/battle/board-image?board=GB_Riptide_02&boss=riptide'
      }
    ]
  }
] satisfies GeneratedBossOption[]

export const generatedNpcPortraitsByStaticId = {
  GuildBoss10LootObjArcheotecCrate:
    '/images/game-assets/npcs/loots_pod_common.png',
  GuildBoss10Minion1AdmecRuststalker:
    '/images/game-assets/npcs/admec_ruststalker.png',
  GuildBoss10Minion2AdmecDestroyer:
    '/images/game-assets/npcs/admec_destroyer.png',
  GuildBoss10Npc1AdmecTechpriest:
    '/images/game-assets/npcs/admec_techpriest.png',
  GuildBoss10Npc2AdmecElectropriest:
    '/images/game-assets/npcs/admec_electropriest.png',
  GuildBoss11Npc1TauFireWarrior:
    '/images/game-assets/npcs/tauta_firewarrior.png',
  GuildBoss11Npc2TauDroneSniper:
    '/images/game-assets/npcs/tauta_drone_sniper.png',
  GuildBoss11Npc3TauDroneShield:
    '/images/game-assets/npcs/tauta_drone_shield.png',
  GuildBoss11Npc4TauStealthSuit:
    '/images/game-assets/npcs/tauta_stealthsuit.png',
  GuildBoss12Npc1DarkaInfiltrator:
    '/images/game-assets/npcs/darka_infiltrator.png',
  GuildBoss12Npc2DarkaHellblaster:
    '/images/game-assets/npcs/darka_hellblaster.png',
  GuildBoss12Npc3DarkaTerminator:
    '/images/game-assets/npcs/darka_terminator.png',
  GuildBoss12Npc4DarkaWatcher: '/images/game-assets/npcs/darka_watcher.png',
  GuildBoss1Npc1TyranTermagantLeviathan:
    '/images/game-assets/npcs/tyran_termagant.png',
  GuildBoss1Npc2TyranTermagantKronos:
    '/images/game-assets/npcs/tyran_termagant.png',
  GuildBoss1Npc3TyranTermagantGorgon:
    '/images/game-assets/npcs/tyran_termagant.png',
  GuildBoss1Npc4TyranHormagauntLeviathan:
    '/images/game-assets/npcs/tyran_hormagaunt.png',
  GuildBoss1Npc5TyranHormagauntKronos:
    '/images/game-assets/npcs/tyran_hormagaunt.png',
  GuildBoss1Npc6TyranHormagauntGorgon:
    '/images/game-assets/npcs/tyran_hormagaunt.png',
  GuildBoss2Npc1TyranRipperSwarmLeviathan:
    '/images/game-assets/npcs/tyran_ripper.png',
  GuildBoss2Npc2TyranRipperSwarmKronos:
    '/images/game-assets/npcs/tyran_ripper.png',
  GuildBoss2Npc3TyranRipperSwarmGorgon:
    '/images/game-assets/npcs/tyran_ripper.png',
  GuildBoss3Minion1NecroMesophet: '/images/game-assets/npcs/necro_mesophet.png',
  GuildBoss3Minion2NecroHapthatra:
    '/images/game-assets/npcs/necro_hapthatra.png',
  GuildBoss3Minion3NecroMenhir: '/images/game-assets/npcs/necro_menhir.png',
  GuildBoss3Npc1NecroWarrior: '/images/game-assets/npcs/necro_warrior.png',
  GuildBoss3Npc2NecroFlayedOne: '/images/game-assets/npcs/necro_flayedone.png',
  GuildBoss3Npc3NecroDeathmark: '/images/game-assets/npcs/necro_deathmark.png',
  GuildBoss3Npc4NecroDestroyer: '/images/game-assets/npcs/necro_destroyer.png',
  GuildBoss3Npc5NecroSwarm: '/images/game-assets/npcs/necro_scarab.png',
  GuildBoss3Npc6NecroSmnDeathmark:
    '/images/game-assets/npcs/necro_deathmark.png',
  GuildBoss4LootObjExplOilDrumReworked:
    '/images/game-assets/npcs/loots_expoildrum.png',
  GuildBoss4Minion1OrksKillaKan: '/images/game-assets/npcs/orkss_killakan.png',
  GuildBoss4Minion2OrksRuntherd: '/images/game-assets/npcs/orkss_runtherd.png',
  GuildBoss4Npc1OrksGrot: '/images/game-assets/npcs/orkss_grot.png',
  GuildBoss4Npc2OrksOrkBoy: '/images/game-assets/npcs/orkss_boy.png',
  GuildBoss4Npc3OrksGrotTank: '/images/game-assets/npcs/orkss_tank.png',
  GuildBoss4Npc4OrksStormboy: '/images/game-assets/npcs/orkss_stormboy.png',
  GuildBoss5Minion1DeathBlightlord:
    '/images/game-assets/npcs/death_blightlord.png',
  GuildBoss5Npc1Poxwalker: '/images/game-assets/npcs/death_poxwalker.png',
  GuildBoss5Npc2PoxwalkerSummon: '/images/game-assets/npcs/death_poxwalker.png',
  GuildBoss6Npc1TyranHormagaunt:
    '/images/game-assets/npcs/tyran_hormagaunt.png',
  GuildBoss6Npc2TyranRipperSwarm: '/images/game-assets/npcs/tyran_ripper.png',
  GuildBoss6Npc3TyranTermagant: '/images/game-assets/npcs/tyran_termagant.png',
  GuildBoss6Npc4TyranWarrior: '/images/game-assets/npcs/tyran_warrior.png',
  GuildBoss6Npc5TyranBarbgaunt: '/images/game-assets/npcs/tyran_barbgaunt.png',
  GuildBoss7Npc1AstraGuardsman: '/images/game-assets/npcs/astra_guardsman.png',
  GuildBoss7Npc1AstraGuardsmanSummon:
    '/images/game-assets/npcs/astra_guardsman.png',
  GuildBoss7Npc2AstraLascannon: '/images/game-assets/npcs/astra_lascannon.png',
  GuildBoss7Npc3AstraVoxcaster: '/images/game-assets/npcs/astra_voxcaster.png',
  GuildBoss7Npc4Mortar: '/images/game-assets/npcs/astra_mortar.png',
  GuildBoss8Npc1EldarGuardian: '/images/game-assets/npcs/aelda_guardian.png',
  GuildBoss8Npc2EldarWarlock: '/images/game-assets/npcs/aelda_warlock.png',
  GuildBoss8Npc3EldarHarlequin: '/images/game-assets/npcs/aelda_harlequin.png',
  GuildBoss8Npc4EldarWraithguard:
    '/images/game-assets/npcs/aelda_wraithguard.png',
  GuildBoss8Npc5EldarGuardianSummon:
    '/images/game-assets/npcs/aelda_guardian.png',
  GuildBoss9Npc1ThousPinkHorror: '/images/game-assets/npcs/thous_horror.png',
  GuildBoss9Npc2ThousScreamer: '/images/game-assets/npcs/thous_screamer.png',
  GuildBoss9Npc3ThousRubricMarine: '/images/game-assets/npcs/thous_rubric.png',
  GuildBoss9Npc4ThousTerminator:
    '/images/game-assets/npcs/thous_terminator.png',
  GuildBoss9Npc5ThousScreamerSummon:
    '/images/game-assets/npcs/thous_screamer.png'
} as const satisfies Record<string, string>

export const generatedNpcPortraitsByUnitId = {
  admecNpc2Techpriest: '/images/game-assets/npcs/admec_techpriest.png',
  admecNpc3Electropriest: '/images/game-assets/npcs/admec_electropriest.png',
  astraNpc1Guardsman: '/images/game-assets/npcs/astra_guardsman.png',
  astraNpc2Lascannon: '/images/game-assets/npcs/astra_lascannon.png',
  astraNpc3Voxcaster: '/images/game-assets/npcs/astra_voxcaster.png',
  astraNpc4Mortar: '/images/game-assets/npcs/astra_mortar.png',
  darkaNpc1Infiltrator: '/images/game-assets/npcs/darka_infiltrator.png',
  darkaNpc2Hellblaster: '/images/game-assets/npcs/darka_hellblaster.png',
  darkaNpc3Terminator: '/images/game-assets/npcs/darka_terminator.png',
  darkaNpc4Watcher: '/images/game-assets/npcs/darka_watcher.png',
  deathPoxwalker: '/images/game-assets/npcs/death_poxwalker.png',
  eldarNpc1Guardian: '/images/game-assets/npcs/aelda_guardian.png',
  eldarNpc2Warlock: '/images/game-assets/npcs/aelda_warlock.png',
  eldarNpc3Harlequin: '/images/game-assets/npcs/aelda_harlequin.png',
  eldarNpc4Wraithguard: '/images/game-assets/npcs/aelda_wraithguard.png',
  'exitor-rho': '/images/game-assets/npcs/admec_ruststalker.png',
  GuildBoss3Minion1NecroMesophet: '/images/game-assets/npcs/necro_mesophet.png',
  GuildBoss3Minion2NecroHapthatra:
    '/images/game-assets/npcs/necro_hapthatra.png',
  GuildBoss3Minion3NecroMenhir: '/images/game-assets/npcs/necro_menhir.png',
  GuildBoss5Minion1DeathBlightlord:
    '/images/game-assets/npcs/death_blightlord.png',
  LootObj_ExplOilDrum: '/images/game-assets/npcs/loots_expoildrum.png',
  LootObj_Pod_Common_Imp: '/images/game-assets/npcs/loots_pod_common.png',
  necroNpc1Warrior: '/images/game-assets/npcs/necro_warrior.png',
  necroNpc2FlayedOne: '/images/game-assets/npcs/necro_flayedone.png',
  necroNpc3Deathmark: '/images/game-assets/npcs/necro_deathmark.png',
  necroNpc4Destroyer: '/images/game-assets/npcs/necro_destroyer.png',
  necroSmnSwarm: '/images/game-assets/npcs/necro_scarab.png',
  orksNpc1Grot: '/images/game-assets/npcs/orkss_grot.png',
  orksNpc2OrkBoy: '/images/game-assets/npcs/orkss_boy.png',
  orksNpc3GrotTank: '/images/game-assets/npcs/orkss_tank.png',
  orksNpc6Stormboy: '/images/game-assets/npcs/orkss_stormboy.png',
  snappawrecka: '/images/game-assets/npcs/orkss_killakan.png',
  snotflogga: '/images/game-assets/npcs/orkss_runtherd.png',
  'sy-gex': '/images/game-assets/npcs/admec_destroyer.png',
  tauNpc1FireWarrior: '/images/game-assets/npcs/tauta_firewarrior.png',
  tauNpc5StealthSuit: '/images/game-assets/npcs/tauta_stealthsuit.png',
  tauSmnDroneShield: '/images/game-assets/npcs/tauta_drone_shield.png',
  tauSmnDroneSniper: '/images/game-assets/npcs/tauta_drone_sniper.png',
  thousNpc1PinkHorror: '/images/game-assets/npcs/thous_horror.png',
  thousNpc2Screamer: '/images/game-assets/npcs/thous_screamer.png',
  thousNpc3RubricMarine: '/images/game-assets/npcs/thous_rubric.png',
  thousNpc4Terminator: '/images/game-assets/npcs/thous_terminator.png',
  tyranNpc1Hormagaunt: '/images/game-assets/npcs/tyran_hormagaunt.png',
  tyranNpc2RipperSwarm: '/images/game-assets/npcs/tyran_ripper.png',
  tyranNpc3Termagant: '/images/game-assets/npcs/tyran_termagant.png',
  tyranNpc4Warrior: '/images/game-assets/npcs/tyran_warrior.png',
  tyranNpc5Barbgaunt: '/images/game-assets/npcs/tyran_barbgaunt.png'
} as const satisfies Record<string, string>

export const generatedSummonPresentationsById = {
  adeptSmnBattleSister: {
    name: 'Battle Sister',
    portrait: '/images/game-assets/summons/adept_battle_sister.png'
  },
  adeptSmnGeminaeSuperia: {
    name: 'Geminae Superia',
    portrait: '/images/game-assets/summons/adept_geminae_superia.png'
  },
  admecSmnElectropriest: {
    name: 'Electro-priest',
    portrait: '/images/game-assets/npcs/admec_electropriest.png'
  },
  admecSmnTechpriest: {
    name: 'Tech-Priest Enginseer',
    portrait: '/images/game-assets/npcs/admec_techpriest.png'
  },
  admecSmnVanguard: {
    name: 'Skitarii Vanguard',
    portrait: '/images/game-assets/summons/admec_vanguard.png'
  },
  astarSmnHaywireMine: {
    name: 'Haywire Mine',
    portrait: '/images/game-assets/summons/astar_haywire_mine.png'
  },
  astraSmnDeathRider: {
    name: 'Death Rider',
    portrait: '/images/game-assets/summons/astra_death_rider.png'
  },
  astraSmnGuardsman: {
    name: 'Cadian Guardsman',
    portrait: '/images/game-assets/npcs/astra_guardsman.png'
  },
  astraSmnKell: {
    name: 'Kell',
    portrait: '/images/game-assets/summons/astra_kell.png'
  },
  astraSmnLascannon: {
    name: 'Cadian Lascannon Team',
    portrait: '/images/game-assets/npcs/astra_lascannon.png'
  },
  astraSmnMortar: {
    name: 'Cadian Mortar Team',
    portrait: '/images/game-assets/npcs/astra_mortar.png'
  },
  astraSmnVoxcaster: {
    name: 'Cadian Vox-caster',
    portrait: '/images/game-assets/npcs/astra_voxcaster.png'
  },
  blackSmnBloodletter: {
    name: 'Bloodletter',
    portrait: '/images/game-assets/summons/black_bloodletter.png'
  },
  blackSmnBloodletterHSE: {
    name: 'Bloodletter',
    portrait: '/images/game-assets/summons/black_bloodletter.png'
  },
  blackSmnHavoc: {
    name: 'Havoc',
    portrait: '/images/game-assets/summons/black_havoc.png'
  },
  blackSmnTerminator: {
    name: 'Chaos Terminator',
    portrait: '/images/game-assets/summons/black_terminator.png'
  },
  bloodSmnIntercessor: {
    name: 'Jump Pack Intercessor',
    portrait: '/images/game-assets/summons/blood_intercessor.png'
  },
  darkaSmnHellblaster: {
    name: 'Hellblaster',
    portrait: '/images/game-assets/npcs/darka_hellblaster.png'
  },
  darkaSmnInfiltrator: {
    name: 'Infiltrator',
    portrait: '/images/game-assets/npcs/darka_infiltrator.png'
  },
  darkaSmnTerminator: {
    name: 'Deathwing Knight',
    portrait: '/images/game-assets/npcs/darka_terminator.png'
  },
  darkaSmnWatcher: {
    name: 'Watcher',
    portrait: '/images/game-assets/npcs/darka_watcher.png'
  },
  deathPoxwalker: {
    name: 'Poxwalker',
    portrait: '/images/game-assets/npcs/death_poxwalker.png'
  },
  deathSmnNurglings: {
    name: 'Nurglings',
    portrait: '/images/game-assets/summons/death_nurglings.png'
  },
  eldarSmnGuardian: {
    name: 'Guardian',
    portrait: '/images/game-assets/summons/eldar_guardian.png'
  },
  eldarSmnHarlequin: {
    name: 'Harlequin Player',
    portrait: '/images/game-assets/summons/eldar_harlequin.png'
  },
  genesSmnAberrant: {
    name: 'Aberrant Hypermorph',
    portrait: '/images/game-assets/summons/genes_aberrant.png'
  },
  genesSmnDecoy: {
    name: 'Decoy',
    portrait: '/images/game-assets/summons/genes_decoy.png'
  },
  genesSmnGenestealer: {
    name: 'Purestrain Genestealer',
    portrait: '/images/game-assets/summons/genes_genestealer.png'
  },
  genesSmnNeophyte: {
    name: 'Neophyte Hybrid',
    portrait: '/images/game-assets/summons/genes_neophyte.png'
  },
  necroSmnDeathmark: {
    name: 'Deathmark',
    portrait: '/images/game-assets/npcs/necro_deathmark.png'
  },
  necroSmnDestroyer: {
    name: 'Ophydian Destroyer',
    portrait: '/images/game-assets/npcs/necro_destroyer.png'
  },
  necroSmnSwarm: {
    name: 'Scarab Swarm',
    portrait: '/images/game-assets/npcs/necro_scarab.png'
  },
  necroSmnWarrior: {
    name: 'Necron Warrior',
    portrait: '/images/game-assets/npcs/necro_warrior.png'
  },
  orksGrot: {
    name: 'Grot',
    portrait: '/images/game-assets/npcs/orkss_grot.png'
  },
  orksGrotTank: {
    name: 'Grot Tank',
    portrait: '/images/game-assets/npcs/orkss_tank.png'
  },
  orksOrkBoys: {
    name: 'Ork Boy',
    portrait: '/images/game-assets/npcs/orkss_boy.png'
  },
  orksSmnSquig: {
    name: 'Large Squig',
    portrait: '/images/game-assets/summons/orks_squig.png'
  },
  tauSmnDroneCommandLink: {
    name: 'Command-Link Drone',
    portrait: '/images/game-assets/summons/tau_command_link_drone.png'
  },
  tauSmnDroneShield: {
    name: 'Shield Drone',
    portrait: '/images/game-assets/npcs/tauta_drone_shield.png'
  },
  tauSmnDroneSniper: {
    name: 'Sniper Drone',
    portrait: '/images/game-assets/npcs/tauta_drone_sniper.png'
  },
  tauSmnStealthSuit: {
    name: 'Stealth Battlesuit',
    portrait: '/images/game-assets/npcs/tauta_stealthsuit.png'
  },
  templInitiate: {
    name: 'Initiate',
    portrait: '/images/game-assets/summons/templ_initiate.png'
  },
  templInitiatePyreblaster: {
    name: 'Initiate with Pyreblaster',
    portrait: '/images/game-assets/summons/templ_pyreblaster.png'
  },
  templNeophyte: {
    name: 'Neophyte',
    portrait: '/images/game-assets/summons/templ_neophyte.png'
  },
  templSmnAggressor: {
    name: 'Aggressor',
    portrait: '/images/game-assets/summons/templ_aggressor.png'
  },
  thousSmnBlueHorror: {
    name: 'Blue Horror',
    portrait: '/images/game-assets/npcs/thous_horror.png'
  },
  thousSmnBlueHorrorHSE: {
    name: 'Blue Horror',
    portrait: '/images/game-assets/npcs/thous_horror.png'
  },
  thousSmnDaemonPrince: {
    name: "Z'Kar",
    portrait: '/images/game-assets/summons/thous_daemon_prince.png'
  },
  thousSmnPinkHorror: {
    name: 'Pink Horror',
    portrait: '/images/game-assets/npcs/thous_horror.png'
  },
  thousSmnPinkHorrorHSE: {
    name: 'Pink Horror',
    portrait: '/images/game-assets/npcs/thous_horror.png'
  },
  thousSmnRubricMarine: {
    name: 'Rubric Marine',
    portrait: '/images/game-assets/npcs/thous_rubric.png'
  },
  thousSmnScreamer: {
    name: 'Screamer',
    portrait: '/images/game-assets/npcs/thous_screamer.png'
  },
  thousSmnScreamerHSE: {
    name: 'Screamer',
    portrait: '/images/game-assets/npcs/thous_screamer.png'
  },
  tyranSmnBarbgaunt: {
    name: 'Barbgaunt',
    portrait: '/images/game-assets/npcs/tyran_barbgaunt.png'
  },
  tyranSmnHormagaunt: {
    name: 'Hormagaunt',
    portrait: '/images/game-assets/npcs/tyran_hormagaunt.png'
  },
  tyranSmnRipperSwarm: {
    name: 'Ripper Swarm',
    portrait: '/images/game-assets/npcs/tyran_ripper.png'
  },
  tyranSmnSporeMine: {
    name: 'Spore Mine',
    portrait: '/images/game-assets/summons/tyran_spore_mine.png'
  },
  tyranSmnTermagant: {
    name: 'Termagant',
    portrait: '/images/game-assets/npcs/tyran_termagant.png'
  },
  tyranSmnWarrior: {
    name: 'Tyranid Warrior',
    portrait: '/images/game-assets/npcs/tyran_warrior.png'
  },
  ultraSmnDreadnought: {
    name: 'Galatian',
    portrait: '/images/game-assets/summons/ultra_dreadnought.png'
  },
  ultraSmnEliminator: {
    name: 'Eliminator',
    portrait: '/images/game-assets/summons/ultra_eliminator.png'
  },
  ultraSmnHeavyIntercessor: {
    name: 'Heavy Intercessor',
    portrait: '/images/game-assets/summons/ultra_heavy_intercessor.png'
  },
  ultraSmnInceptor: {
    name: 'Inceptor',
    portrait: '/images/game-assets/summons/ultra_inceptor.png'
  },
  votanSmnEcog: {
    name: 'E-COG',
    portrait: '/images/game-assets/summons/votan_ecog.png'
  },
  votanSmnSteeljack: {
    name: 'Ironkin Steeljack',
    portrait: '/images/game-assets/summons/votan_steeljack.png'
  }
} as const satisfies Record<string, { name: string; portrait: string }>

/**
 * Summoner→summon ids, keyed by both the native engine gameId (embedded in
 * spawn ids like `tyranBiovore:spawned_150`) and the datamine heroRef. Summoners
 * with more than one distinct summon are ABSENT: the viewer shows a generic label, never a guess.
 */
export const generatedSummonUnitIdByParentGameId = {
  adeptCelestine: 'adeptSmnGeminaeSuperia',
  admecMarshall: 'admecSmnVanguard',
  'aleph-null': 'necroSmnSwarm',
  ammuk: 'votanSmnSteeljack',
  anuphet: 'necroSmnWarrior',
  astarCyrus: 'astarSmnHaywireMine',
  astraDreir: 'astraSmnDeathRider',
  astraOrdnanceBattery: 'astraSmnGuardsman',
  astraYarrick: 'astraSmnGuardsman',
  bellator: 'ultraSmnInceptor',
  biovore: 'tyranSmnSporeMine',
  bloodIntercessor: 'bloodSmnIntercessor',
  'boss-gulgortz': 'orksOrkBoys',
  celestine: 'adeptSmnGeminaeSuperia',
  'commander-shadowsun': 'tauSmnDroneCommandLink',
  'commissar-yarrick': 'astraSmnGuardsman',
  corrodius: 'deathPoxwalker',
  cyrus: 'astarSmnHaywireMine',
  deathBlightbringer: 'deathPoxwalker',
  galatian: 'ultraSmnDreadnought',
  genesBiophagus: 'genesSmnAberrant',
  genesKelermorph: 'genesSmnDecoy',
  gibbascrapz: 'orksGrotTank',
  hollan: 'genesSmnAberrant',
  judh: 'genesSmnDecoy',
  'malleus-rocket-launcher': 'astraSmnGuardsman',
  'marshal-dreir': 'astraSmnDeathRider',
  mataneo: 'bloodSmnIntercessor',
  necroOverlord: 'necroSmnWarrior',
  necroSpyder: 'necroSmnSwarm',
  orksBigMek: 'orksGrotTank',
  orksRukkatrukk: 'orksSmnSquig',
  orksRuntherd: 'orksGrot',
  orksWarboss: 'orksOrkBoys',
  'parasite-of-mortrex': 'tyranSmnRipperSwarm',
  revas: 'tauSmnDroneShield',
  rukkatrukk: 'orksSmnSquig',
  shosyl: 'tauSmnDroneSniper',
  snotflogga: 'orksGrot',
  'tan-gida': 'admecSmnVanguard',
  tauCrisis: 'tauSmnDroneShield',
  tauMarksman: 'tauSmnDroneSniper',
  tauShadowsun: 'tauSmnDroneCommandLink',
  thousDaemonPrince: 'thousSmnDaemonPrince',
  tyranBiovore: 'tyranSmnSporeMine',
  tyranParasite: 'tyranSmnRipperSwarm',
  ultraDreadnought: 'ultraSmnDreadnought',
  ultraInceptorSgt: 'ultraSmnInceptor',
  votanIronmaster: 'votanSmnEcog',
  votanMemnyr: 'votanSmnSteeljack',
  vynn: 'votanSmnEcog',
  zkar: 'thousSmnDaemonPrince'
} as const satisfies Record<string, string>

export interface GeneratedUnitPresentation {
  displayName: string
  portrait: string | null
  /** Datamine hero-catalog id for hero-derived units; joins to storage-hosted portraits. */
  heroRef?: string
}

export const generatedUnitPresentationsByStaticId = {
  adeptCanoness: {
    displayName: 'Roswitha',
    portrait: null,
    heroRef: 'roswitha'
  },
  adeptCelestine: {
    displayName: 'Celestine',
    portrait: null,
    heroRef: 'celestine'
  },
  adeptExorcist: {
    displayName: 'Exorcist',
    portrait: null,
    heroRef: 'exorcist'
  },
  adeptHospitaller: {
    displayName: 'Isabella',
    portrait: null,
    heroRef: 'isabella'
  },
  adeptMorvenn: {
    displayName: 'Morvenn Vahl',
    portrait: null,
    heroRef: 'morvenn-vahl'
  },
  adeptRetributor: {
    displayName: 'Vindicta',
    portrait: null,
    heroRef: 'vindicta'
  },
  adeptSmnBattleSister: {
    displayName: 'Battle Sister',
    portrait: '/images/game-assets/summons/adept_battle_sister.png'
  },
  adeptSmnGeminaeSuperia: {
    displayName: 'Geminae Superia',
    portrait: '/images/game-assets/summons/adept_geminae_superia.png'
  },
  admecDestroyer: {
    displayName: 'Sy-gex',
    portrait: null,
    heroRef: 'sy-gex'
  },
  admecDominus: {
    displayName: 'Vitruvius',
    portrait: null,
    heroRef: 'virtuvius'
  },
  admecManipulus: {
    displayName: 'Actus',
    portrait: null,
    heroRef: 'actus'
  },
  admecMarshall: {
    displayName: "Tan Gi'da",
    portrait: null,
    heroRef: 'tan-gida'
  },
  admecRuststalker: {
    displayName: 'Exitor-Rho',
    portrait: null,
    heroRef: 'exitor-rho'
  },
  admecSmnElectropriest: {
    displayName: 'Electro-priest',
    portrait: '/images/game-assets/npcs/admec_electropriest.png'
  },
  admecSmnTechpriest: {
    displayName: 'Tech-Priest Enginseer',
    portrait: '/images/game-assets/npcs/admec_techpriest.png'
  },
  admecSmnVanguard: {
    displayName: 'Skitarii Vanguard',
    portrait: '/images/game-assets/summons/admec_vanguard.png'
  },
  astarCyrus: {
    displayName: 'Cyrus',
    portrait: null,
    heroRef: 'cyrus'
  },
  astarLysander: {
    displayName: 'Lysander',
    portrait: null,
    heroRef: 'lysander'
  },
  astarSmnHaywireMine: {
    displayName: 'Haywire Mine',
    portrait: '/images/game-assets/summons/astar_haywire_mine.png'
  },
  astraBullgryn: {
    displayName: 'Kut',
    portrait: null,
    heroRef: 'kut-skoden'
  },
  astraCreed: {
    displayName: 'Creed',
    portrait: null,
    heroRef: 'castellan-creed'
  },
  astraDreir: {
    displayName: 'Dreir',
    portrait: null,
    heroRef: 'marshal-dreir'
  },
  astraOrdnance: {
    displayName: 'Thaddeus',
    portrait: null,
    heroRef: 'thaddeus-noble'
  },
  astraOrdnanceBattery: {
    displayName: 'Malleus Rocket Launcher',
    portrait: null,
    heroRef: 'malleus-rocket-launcher'
  },
  astraPrimarisPsy: {
    displayName: 'Sibyll',
    portrait: null,
    heroRef: 'sibyll-devine'
  },
  astraSmnDeathRider: {
    displayName: 'Death Rider',
    portrait: '/images/game-assets/summons/astra_death_rider.png'
  },
  astraSmnGuardsman: {
    displayName: 'Cadian Guardsman',
    portrait: '/images/game-assets/npcs/astra_guardsman.png'
  },
  astraSmnKell: {
    displayName: 'Kell',
    portrait: '/images/game-assets/summons/astra_kell.png'
  },
  astraSmnLascannon: {
    displayName: 'Cadian Lascannon Team',
    portrait: '/images/game-assets/npcs/astra_lascannon.png'
  },
  astraSmnMortar: {
    displayName: 'Cadian Mortar Team',
    portrait: '/images/game-assets/npcs/astra_mortar.png'
  },
  astraSmnVoxcaster: {
    displayName: 'Cadian Vox-caster',
    portrait: '/images/game-assets/npcs/astra_voxcaster.png'
  },
  astraYarrick: {
    displayName: 'Yarrick',
    portrait: null,
    heroRef: 'commissar-yarrick'
  },
  blackAbaddon: {
    displayName: 'Abaddon',
    portrait: null,
    heroRef: 'abaddon-the-despoiler'
  },
  blackForgefiend: {
    displayName: 'Forgefiend',
    portrait: null,
    heroRef: 'forgefiend'
  },
  blackHaarken: {
    displayName: 'Haarken',
    portrait: null,
    heroRef: 'haarkeen-worldclaimer'
  },
  blackObliterator: {
    displayName: 'Volk',
    portrait: null,
    heroRef: 'volk'
  },
  blackPossession: {
    displayName: 'Archimatos',
    portrait: null,
    heroRef: 'archimatos'
  },
  blackSmnBloodletter: {
    displayName: 'Bloodletter',
    portrait: '/images/game-assets/summons/black_bloodletter.png'
  },
  blackSmnBloodletterHSE: {
    displayName: 'Bloodletter',
    portrait: '/images/game-assets/summons/black_bloodletter.png'
  },
  blackSmnHavoc: {
    displayName: 'Havoc',
    portrait: '/images/game-assets/summons/black_havoc.png'
  },
  blackSmnTerminator: {
    displayName: 'Chaos Terminator',
    portrait: '/images/game-assets/summons/black_terminator.png'
  },
  blackTerminator: {
    displayName: 'Angrax',
    portrait: null,
    heroRef: 'angrax'
  },
  bloodDante: {
    displayName: 'Dante',
    portrait: null,
    heroRef: 'dante'
  },
  bloodDeathCompany: {
    displayName: 'Lucien',
    portrait: null,
    heroRef: 'lucien'
  },
  bloodIntercessor: {
    displayName: 'Mataneo',
    portrait: null,
    heroRef: 'mataneo'
  },
  bloodMephiston: {
    displayName: 'Mephiston',
    portrait: null,
    heroRef: 'mephiston'
  },
  bloodSanguinary: {
    displayName: 'Nicodemus',
    portrait: null,
    heroRef: 'nicodemus'
  },
  bloodSmnIntercessor: {
    displayName: 'Jump Pack Intercessor',
    portrait: '/images/game-assets/summons/blood_intercessor.png'
  },
  bloodTerminator: {
    displayName: 'Cezare',
    portrait: null,
    heroRef: 'cezare'
  },
  custoAtlacoya: {
    displayName: 'Atlacoya',
    portrait: null,
    heroRef: 'atlacoya'
  },
  custoBladeChampion: {
    displayName: 'Kariyan',
    portrait: null,
    heroRef: 'kariyan'
  },
  custoKyrus: {
    displayName: 'Tyrith',
    portrait: null,
    heroRef: 'tyrith'
  },
  custoTrajann: {
    displayName: 'Trajann',
    portrait: null,
    heroRef: 'trajann'
  },
  custoVexilusPraetor: {
    displayName: 'Aesoth',
    portrait: null,
    heroRef: 'aesoth'
  },
  darkaAsmodai: {
    displayName: 'Asmodai',
    portrait: null,
    heroRef: 'asmodai'
  },
  darkaAzrael: {
    displayName: 'Azrael',
    portrait: null,
    heroRef: 'azrael'
  },
  darkaCompanion: {
    displayName: 'Forcas',
    portrait: null,
    heroRef: 'forcas'
  },
  darkaHellblaster: {
    displayName: 'Sarquael',
    portrait: null,
    heroRef: 'sarquael'
  },
  darkaSmnHellblaster: {
    displayName: 'Hellblaster',
    portrait: '/images/game-assets/npcs/darka_hellblaster.png'
  },
  darkaSmnInfiltrator: {
    displayName: 'Infiltrator',
    portrait: '/images/game-assets/npcs/darka_infiltrator.png'
  },
  darkaSmnTerminator: {
    displayName: 'Deathwing Knight',
    portrait: '/images/game-assets/npcs/darka_terminator.png'
  },
  darkaSmnWatcher: {
    displayName: 'Watcher',
    portrait: '/images/game-assets/npcs/darka_watcher.png'
  },
  darkaSternguard: {
    displayName: 'Ramus',
    portrait: null,
    heroRef: 'ramus'
  },
  darkaStormSpeeder: {
    displayName: 'Storm Speeder',
    portrait: null,
    heroRef: 'storm-speeder'
  },
  darkaTerminator: {
    displayName: 'Baraqiel',
    portrait: null,
    heroRef: 'baraqiel'
  },
  deathBlightbringer: {
    displayName: 'Corrodius',
    portrait: null,
    heroRef: 'corrodius'
  },
  deathBlightlord: {
    displayName: 'Maladus',
    portrait: null,
    heroRef: 'maladus'
  },
  deathCrawler: {
    displayName: 'Plagueburst Crawler',
    portrait: null,
    heroRef: 'plagueburst-crawler'
  },
  deathPoxwalker: {
    displayName: 'Poxwalker',
    portrait: '/images/game-assets/npcs/death_poxwalker.png'
  },
  deathPutrifier: {
    displayName: 'Pestillian',
    portrait: null,
    heroRef: 'pestillian'
  },
  deathRotbone: {
    displayName: 'Nauseous',
    portrait: null,
    heroRef: 'nauseous-rotbone'
  },
  deathSmnNurglings: {
    displayName: 'Nurglings',
    portrait: '/images/game-assets/summons/death_nurglings.png'
  },
  deathTyphus: {
    displayName: 'Typhus',
    portrait: null,
    heroRef: 'typhus'
  },
  eldarAutarch: {
    displayName: 'Aethana',
    portrait: null,
    heroRef: 'aethana'
  },
  eldarFarseer: {
    displayName: 'Eldryon',
    portrait: null,
    heroRef: 'eldryon'
  },
  eldarJainZar: {
    displayName: 'Jain Zar',
    portrait: null,
    heroRef: 'jain-zar'
  },
  eldarLhykhis: {
    displayName: 'Lhykhis',
    portrait: null,
    heroRef: 'lhykhis'
  },
  eldarMauganRa: {
    displayName: 'Maugan Ra',
    portrait: null,
    heroRef: 'maugan-ra'
  },
  eldarRanger: {
    displayName: 'Calandis',
    portrait: null,
    heroRef: 'calandis'
  },
  eldarSmnGuardian: {
    displayName: 'Guardian',
    portrait: '/images/game-assets/summons/eldar_guardian.png'
  },
  eldarSmnHarlequin: {
    displayName: 'Harlequin Player',
    portrait: '/images/game-assets/summons/eldar_harlequin.png'
  },
  emperExultant: {
    displayName: 'Laviscus',
    portrait: null,
    heroRef: 'laviscus'
  },
  emperFlawlessBlade: {
    displayName: 'Hascule',
    portrait: null,
    heroRef: 'hascule'
  },
  emperKakophonist: {
    displayName: 'Adamatar',
    portrait: null,
    heroRef: 'adamatar'
  },
  emperLucius: {
    displayName: 'Lucius',
    portrait: null,
    heroRef: 'lucius'
  },
  emperNoiseMarine: {
    displayName: 'Shiron',
    portrait: null,
    heroRef: 'shiron'
  },
  genesBiophagus: {
    displayName: 'Hollan',
    portrait: null,
    heroRef: 'hollan'
  },
  genesKelermorph: {
    displayName: 'Judh',
    portrait: null,
    heroRef: 'judh'
  },
  genesMagus: {
    displayName: 'Xybia',
    portrait: null,
    heroRef: 'xybia'
  },
  genesPatriarch: {
    displayName: 'The Patermine',
    portrait: null,
    heroRef: 'patermine'
  },
  genesPrimus: {
    displayName: 'Isaak',
    portrait: null,
    heroRef: 'isaak'
  },
  genesSmnAberrant: {
    displayName: 'Aberrant Hypermorph',
    portrait: '/images/game-assets/summons/genes_aberrant.png'
  },
  genesSmnDecoy: {
    displayName: 'Decoy',
    portrait: '/images/game-assets/summons/genes_decoy.png'
  },
  genesSmnGenestealer: {
    displayName: 'Purestrain Genestealer',
    portrait: '/images/game-assets/summons/genes_genestealer.png'
  },
  genesSmnNeophyte: {
    displayName: 'Neophyte Hybrid',
    portrait: '/images/game-assets/summons/genes_neophyte.png'
  },
  GuildBoss10Boss1AdmecBelisarius: {
    displayName: 'Belisarius Cawl',
    portrait: '/images/bosses/portraits/belisarius_main.png'
  },
  GuildBoss10LootObjArcheotecCrate: {
    displayName: 'Common Imperial Supply Pod',
    portrait: '/images/game-assets/npcs/loots_pod_common.png',
    heroRef: 'LootObj_Pod_Common_Imp'
  },
  GuildBoss10MiniBoss1AdmecMarshall: {
    displayName: "Tan Gi'da",
    portrait: null,
    heroRef: 'tan-gida'
  },
  GuildBoss10MiniBoss2AdmecManipulus: {
    displayName: 'Manipulus Actus Fulgorosus',
    portrait: null,
    heroRef: 'actus'
  },
  GuildBoss10Minion1AdmecRuststalker: {
    displayName: 'Exitor-Rho-1.15/x',
    portrait: '/images/game-assets/npcs/admec_ruststalker.png',
    heroRef: 'exitor-rho'
  },
  GuildBoss10Minion2AdmecDestroyer: {
    displayName: 'Sy-gex-KPH008/15.mk41',
    portrait: '/images/game-assets/npcs/admec_destroyer.png',
    heroRef: 'sy-gex'
  },
  GuildBoss10Npc1AdmecTechpriest: {
    displayName: 'Tech-Priest Enginseer',
    portrait: '/images/game-assets/npcs/admec_techpriest.png',
    heroRef: 'admecNpc2Techpriest'
  },
  GuildBoss10Npc2AdmecElectropriest: {
    displayName: 'Corpuscarii Electro-priest',
    portrait: '/images/game-assets/npcs/admec_electropriest.png',
    heroRef: 'admecNpc3Electropriest'
  },
  GuildBoss11Boss1TauRiptide: {
    displayName: 'XV104 Riptide Battlesuit',
    portrait: '/images/bosses/portraits/riptide_main.png'
  },
  GuildBoss11MiniBoss1TauMarksman: {
    displayName: "Shas'ui Vior'la Sho'syl",
    portrait: null,
    heroRef: 'shosyl'
  },
  GuildBoss11MiniBoss2TauCrisis: {
    displayName: "Shas'vre Vior'la Re'vas",
    portrait: null,
    heroRef: 'revas'
  },
  GuildBoss11Npc1TauFireWarrior: {
    displayName: "Fire Warrior Shas'la",
    portrait: '/images/game-assets/npcs/tauta_firewarrior.png',
    heroRef: 'tauNpc1FireWarrior'
  },
  GuildBoss11Npc2TauDroneSniper: {
    displayName: 'MV71 Sniper Drone',
    portrait: '/images/game-assets/npcs/tauta_drone_sniper.png',
    heroRef: 'tauSmnDroneSniper'
  },
  GuildBoss11Npc3TauDroneShield: {
    displayName: 'MV52 Shield Drone',
    portrait: '/images/game-assets/npcs/tauta_drone_shield.png',
    heroRef: 'tauSmnDroneShield'
  },
  GuildBoss11Npc4TauStealthSuit: {
    displayName: 'XV25 Stealth Battlesuit',
    portrait: '/images/game-assets/npcs/tauta_stealthsuit.png',
    heroRef: 'tauNpc5StealthSuit'
  },
  GuildBoss12Boss1DarkaLion: {
    displayName: "Lion El'Jonson",
    portrait: '/images/bosses/portraits/lion_main.png'
  },
  GuildBoss12MiniBoss1DarkaTerminator: {
    displayName: 'Baraqiel',
    portrait: null,
    heroRef: 'baraqiel'
  },
  GuildBoss12MiniBoss2DarkaCompanion: {
    displayName: 'Forcas Oathsworn',
    portrait: null,
    heroRef: 'forcas'
  },
  GuildBoss12Npc1DarkaInfiltrator: {
    displayName: 'Infiltrator',
    portrait: '/images/game-assets/npcs/darka_infiltrator.png',
    heroRef: 'darkaNpc1Infiltrator'
  },
  GuildBoss12Npc2DarkaHellblaster: {
    displayName: 'Hellblaster',
    portrait: '/images/game-assets/npcs/darka_hellblaster.png',
    heroRef: 'darkaNpc2Hellblaster'
  },
  GuildBoss12Npc3DarkaTerminator: {
    displayName: 'Deathwing Knight',
    portrait: '/images/game-assets/npcs/darka_terminator.png',
    heroRef: 'darkaNpc3Terminator'
  },
  GuildBoss12Npc4DarkaWatcher: {
    displayName: 'Watcher in the Dark',
    portrait: '/images/game-assets/npcs/darka_watcher.png',
    heroRef: 'darkaNpc4Watcher'
  },
  GuildBoss1Boss1TyranTervigonLeviathan: {
    displayName: 'Tervigon (Hive Fleet Leviathan)',
    portrait: '/images/bosses/portraits/tervigonleviathan_main.png'
  },
  GuildBoss1Boss2TyranTervigonKronos: {
    displayName: 'Tervigon (Hive Fleet Kronos)',
    portrait: '/images/bosses/portraits/tervigonkronos_main.png'
  },
  GuildBoss1Boss3TyranTervigonGorgon: {
    displayName: 'Tervigon (Hive Fleet Gorgon)',
    portrait: '/images/bosses/portraits/tervigongorgon_main.png'
  },
  GuildBoss1MiniBoss1TyranWarriorLeviathan: {
    displayName: 'Tyranid Prime (Leviathan)',
    portrait: null
  },
  GuildBoss1MiniBoss2TyranWarriorKronos: {
    displayName: 'Tyranid Prime (Kronos)',
    portrait: null
  },
  GuildBoss1MiniBoss3TyranWarriorGorgon: {
    displayName: 'Tyranid Prime (Gorgon)',
    portrait: null
  },
  GuildBoss1Npc1TyranTermagantLeviathan: {
    displayName: 'Termagant',
    portrait: '/images/game-assets/npcs/tyran_termagant.png',
    heroRef: 'tyranNpc3Termagant'
  },
  GuildBoss1Npc2TyranTermagantKronos: {
    displayName: 'Termagant',
    portrait: '/images/game-assets/npcs/tyran_termagant.png',
    heroRef: 'tyranNpc3Termagant'
  },
  GuildBoss1Npc3TyranTermagantGorgon: {
    displayName: 'Termagant',
    portrait: '/images/game-assets/npcs/tyran_termagant.png',
    heroRef: 'tyranNpc3Termagant'
  },
  GuildBoss1Npc4TyranHormagauntLeviathan: {
    displayName: 'Hormagaunt',
    portrait: '/images/game-assets/npcs/tyran_hormagaunt.png',
    heroRef: 'tyranNpc1Hormagaunt'
  },
  GuildBoss1Npc5TyranHormagauntKronos: {
    displayName: 'Hormagaunt',
    portrait: '/images/game-assets/npcs/tyran_hormagaunt.png',
    heroRef: 'tyranNpc1Hormagaunt'
  },
  GuildBoss1Npc6TyranHormagauntGorgon: {
    displayName: 'Hormagaunt',
    portrait: '/images/game-assets/npcs/tyran_hormagaunt.png',
    heroRef: 'tyranNpc1Hormagaunt'
  },
  GuildBoss2Boss1TyranHiveTyrantLeviathan: {
    displayName: 'Hive Tyrant (Hive Fleet Leviathan)',
    portrait: '/images/bosses/portraits/hivetyrantleviathan_main.png'
  },
  GuildBoss2Boss2TyranHiveTyrantKronos: {
    displayName: 'Hive Tyrant (Hive Fleet Kronos)',
    portrait: '/images/bosses/portraits/hivetyrantkronos_main.png'
  },
  GuildBoss2Boss3TyranHiveTyrantGorgon: {
    displayName: 'Hive Tyrant (Hive Fleet Gorgon)',
    portrait: '/images/bosses/portraits/hivetyrantgorgon_main.png'
  },
  GuildBoss2Npc1TyranRipperSwarmLeviathan: {
    displayName: 'Ripper Swarm',
    portrait: '/images/game-assets/npcs/tyran_ripper.png',
    heroRef: 'tyranNpc2RipperSwarm'
  },
  GuildBoss2Npc2TyranRipperSwarmKronos: {
    displayName: 'Ripper Swarm',
    portrait: '/images/game-assets/npcs/tyran_ripper.png',
    heroRef: 'tyranNpc2RipperSwarm'
  },
  GuildBoss2Npc3TyranRipperSwarmGorgon: {
    displayName: 'Ripper Swarm',
    portrait: '/images/game-assets/npcs/tyran_ripper.png',
    heroRef: 'tyranNpc2RipperSwarm'
  },
  GuildBoss3Boss1NecroSilentKing: {
    displayName: 'Szarekh',
    portrait: '/images/bosses/portraits/silentking_main.png'
  },
  GuildBoss3Minion1NecroMesophet: {
    displayName: 'Mesophet of the Shadowed Hand',
    portrait: '/images/game-assets/npcs/necro_mesophet.png'
  },
  GuildBoss3Minion2NecroHapthatra: {
    displayName: 'Hapthatra the Radiant',
    portrait: '/images/game-assets/npcs/necro_hapthatra.png'
  },
  GuildBoss3Minion3NecroMenhir: {
    displayName: 'Triarchal Menhir',
    portrait: '/images/game-assets/npcs/necro_menhir.png'
  },
  GuildBoss3Npc1NecroWarrior: {
    displayName: 'Necron Warrior',
    portrait: '/images/game-assets/npcs/necro_warrior.png',
    heroRef: 'necroNpc1Warrior'
  },
  GuildBoss3Npc2NecroFlayedOne: {
    displayName: 'Flayed One',
    portrait: '/images/game-assets/npcs/necro_flayedone.png',
    heroRef: 'necroNpc2FlayedOne'
  },
  GuildBoss3Npc3NecroDeathmark: {
    displayName: 'Deathmark',
    portrait: '/images/game-assets/npcs/necro_deathmark.png',
    heroRef: 'necroNpc3Deathmark'
  },
  GuildBoss3Npc4NecroDestroyer: {
    displayName: 'Ophydian Destroyer',
    portrait: '/images/game-assets/npcs/necro_destroyer.png',
    heroRef: 'necroNpc4Destroyer'
  },
  GuildBoss3Npc5NecroSwarm: {
    displayName: 'Scarab Swarm',
    portrait: '/images/game-assets/npcs/necro_scarab.png',
    heroRef: 'necroSmnSwarm'
  },
  GuildBoss3Npc6NecroSmnDeathmark: {
    displayName: 'Deathmark',
    portrait: '/images/game-assets/npcs/necro_deathmark.png',
    heroRef: 'necroNpc3Deathmark'
  },
  GuildBoss4Boss1OrksGhazghkull: {
    displayName: 'Ghazghkull Mag Uruk Thraka',
    portrait: '/images/bosses/portraits/ghazghkull_main.png'
  },
  GuildBoss4LootObjExplOilDrumReworked: {
    displayName: 'Explosive Oil Drum',
    portrait: '/images/game-assets/npcs/loots_expoildrum.png',
    heroRef: 'LootObj_ExplOilDrum'
  },
  GuildBoss4MiniBoss1OrksBigMek: {
    displayName: 'Gibbascrapz, da Spezulist',
    portrait: null,
    heroRef: 'gibbascrapz'
  },
  GuildBoss4MiniBoss2OrksNob: {
    displayName: 'Olog Tanksmasha',
    portrait: null,
    heroRef: 'tanksmasha'
  },
  GuildBoss4Minion1OrksKillaKan: {
    displayName: 'Snappawrecka',
    portrait: '/images/game-assets/npcs/orkss_killakan.png',
    heroRef: 'snappawrecka'
  },
  GuildBoss4Minion2OrksRuntherd: {
    displayName: 'Grumbal Snotflogga',
    portrait: '/images/game-assets/npcs/orkss_runtherd.png',
    heroRef: 'snotflogga'
  },
  GuildBoss4Npc1OrksGrot: {
    displayName: 'Grot',
    portrait: '/images/game-assets/npcs/orkss_grot.png',
    heroRef: 'orksNpc1Grot'
  },
  GuildBoss4Npc2OrksOrkBoy: {
    displayName: 'Ork Boy',
    portrait: '/images/game-assets/npcs/orkss_boy.png',
    heroRef: 'orksNpc2OrkBoy'
  },
  GuildBoss4Npc3OrksGrotTank: {
    displayName: 'Grot Tank',
    portrait: '/images/game-assets/npcs/orkss_tank.png',
    heroRef: 'orksNpc3GrotTank'
  },
  GuildBoss4Npc4OrksStormboy: {
    displayName: 'Stormboy',
    portrait: '/images/game-assets/npcs/orkss_stormboy.png',
    heroRef: 'orksNpc6Stormboy'
  },
  GuildBoss5Boss1DeathMortarion: {
    displayName: 'Mortarion, the Death Lord',
    portrait: '/images/bosses/portraits/mortarion_main.png'
  },
  GuildBoss5MiniBoss1DeathRotbone: {
    displayName: 'Nauseous Rotbone',
    portrait: null,
    heroRef: 'nauseous-rotbone'
  },
  GuildBoss5MiniBoss2DeathBlightbringer: {
    displayName: 'Corrodius Achebile',
    portrait: null,
    heroRef: 'corrodius'
  },
  GuildBoss5Minion1DeathBlightlord: {
    displayName: 'Blightlord Terminator',
    portrait: '/images/game-assets/npcs/death_blightlord.png'
  },
  GuildBoss5Npc1Poxwalker: {
    displayName: 'Poxwalker',
    portrait: '/images/game-assets/npcs/death_poxwalker.png',
    heroRef: 'deathPoxwalker'
  },
  GuildBoss5Npc2PoxwalkerSummon: {
    displayName: 'Poxwalker',
    portrait: '/images/game-assets/npcs/death_poxwalker.png',
    heroRef: 'deathPoxwalker'
  },
  GuildBoss6Boss1TyranScreamerKiller: {
    displayName: 'Screamer-Killer',
    portrait: '/images/bosses/portraits/screamerkiller_main.png'
  },
  GuildBoss6MiniBoss1TyranNeurothrope: {
    displayName: 'Neurothrope',
    portrait: null,
    heroRef: 'neurothrope'
  },
  GuildBoss6MiniBoss2TyranWingedPrime: {
    displayName: 'Winged Tyranid Prime',
    portrait: null,
    heroRef: 'winged-prime'
  },
  GuildBoss6Npc1TyranHormagaunt: {
    displayName: 'Hormagaunt',
    portrait: '/images/game-assets/npcs/tyran_hormagaunt.png',
    heroRef: 'tyranNpc1Hormagaunt'
  },
  GuildBoss6Npc2TyranRipperSwarm: {
    displayName: 'Ripper Swarm',
    portrait: '/images/game-assets/npcs/tyran_ripper.png',
    heroRef: 'tyranNpc2RipperSwarm'
  },
  GuildBoss6Npc3TyranTermagant: {
    displayName: 'Termagant',
    portrait: '/images/game-assets/npcs/tyran_termagant.png',
    heroRef: 'tyranNpc3Termagant'
  },
  GuildBoss6Npc4TyranWarrior: {
    displayName: 'Tyranid Warrior',
    portrait: '/images/game-assets/npcs/tyran_warrior.png',
    heroRef: 'tyranNpc4Warrior'
  },
  GuildBoss6Npc5TyranBarbgaunt: {
    displayName: 'Barbgaunt',
    portrait: '/images/game-assets/npcs/tyran_barbgaunt.png',
    heroRef: 'tyranNpc5Barbgaunt'
  },
  GuildBoss7Boss1AstraRogaldorn: {
    displayName: 'Rogal Dorn Battle Tank',
    portrait: '/images/bosses/portraits/rogaldorn_main.png'
  },
  GuildBoss7MiniBoss1AstraPrimarisPsy: {
    displayName: 'Sibyll Devine',
    portrait: null,
    heroRef: 'sibyll-devine'
  },
  GuildBoss7MiniBoss2AstraOrdnance: {
    displayName: 'Thaddeus Noble',
    portrait: null,
    heroRef: 'thaddeus-noble'
  },
  GuildBoss7Npc1AstraGuardsman: {
    displayName: 'Cadian Guardsman',
    portrait: '/images/game-assets/npcs/astra_guardsman.png',
    heroRef: 'astraNpc1Guardsman'
  },
  GuildBoss7Npc1AstraGuardsmanSummon: {
    displayName: 'Cadian Guardsman',
    portrait: '/images/game-assets/npcs/astra_guardsman.png',
    heroRef: 'astraNpc1Guardsman'
  },
  GuildBoss7Npc2AstraLascannon: {
    displayName: 'Cadian Lascannon Team',
    portrait: '/images/game-assets/npcs/astra_lascannon.png',
    heroRef: 'astraNpc2Lascannon'
  },
  GuildBoss7Npc3AstraVoxcaster: {
    displayName: 'Cadian Vox-caster',
    portrait: '/images/game-assets/npcs/astra_voxcaster.png',
    heroRef: 'astraNpc3Voxcaster'
  },
  GuildBoss7Npc4Mortar: {
    displayName: 'Cadian Mortar Team',
    portrait: '/images/game-assets/npcs/astra_mortar.png',
    heroRef: 'astraNpc4Mortar'
  },
  GuildBoss8Boss1EldarAvatar: {
    displayName: 'Avatar of Khaine',
    portrait: '/images/bosses/portraits/avatarofkhaine_main.png'
  },
  GuildBoss8MiniBoss1EldarAutarch: {
    displayName: 'Aethana Barantharal',
    portrait: null,
    heroRef: 'aethana'
  },
  GuildBoss8MiniBoss2EldarFarseer: {
    displayName: 'Eldryon Ynaduin',
    portrait: null,
    heroRef: 'eldryon'
  },
  GuildBoss8Npc1EldarGuardian: {
    displayName: 'Guardian Defender',
    portrait: '/images/game-assets/npcs/aelda_guardian.png',
    heroRef: 'eldarNpc1Guardian'
  },
  GuildBoss8Npc2EldarWarlock: {
    displayName: 'Warlock',
    portrait: '/images/game-assets/npcs/aelda_warlock.png',
    heroRef: 'eldarNpc2Warlock'
  },
  GuildBoss8Npc3EldarHarlequin: {
    displayName: 'Harlequin Troupe Player',
    portrait: '/images/game-assets/npcs/aelda_harlequin.png',
    heroRef: 'eldarNpc3Harlequin'
  },
  GuildBoss8Npc4EldarWraithguard: {
    displayName: 'Wraithguard',
    portrait: '/images/game-assets/npcs/aelda_wraithguard.png',
    heroRef: 'eldarNpc4Wraithguard'
  },
  GuildBoss8Npc5EldarGuardianSummon: {
    displayName: 'Guardian Defender',
    portrait: '/images/game-assets/npcs/aelda_guardian.png',
    heroRef: 'eldarNpc1Guardian'
  },
  GuildBoss9Boss1ThousMagnus: {
    displayName: 'Magnus the Red',
    portrait: '/images/bosses/portraits/magnus_main.png'
  },
  GuildBoss9MiniBoss1ThousSorcerer: {
    displayName: 'Kairatar Thaumachus',
    portrait: null,
    heroRef: 'thaumachus'
  },
  GuildBoss9MiniBoss2ThousInfernalMaster: {
    displayName: 'Arkarzar Abraxas',
    portrait: null,
    heroRef: 'abraxas'
  },
  GuildBoss9Npc1ThousPinkHorror: {
    displayName: 'Pink Horror of Tzeentch',
    portrait: '/images/game-assets/npcs/thous_horror.png',
    heroRef: 'thousNpc1PinkHorror'
  },
  GuildBoss9Npc2ThousScreamer: {
    displayName: 'Screamer of Tzeentch',
    portrait: '/images/game-assets/npcs/thous_screamer.png',
    heroRef: 'thousNpc2Screamer'
  },
  GuildBoss9Npc3ThousRubricMarine: {
    displayName: 'Rubric Marine',
    portrait: '/images/game-assets/npcs/thous_rubric.png',
    heroRef: 'thousNpc3RubricMarine'
  },
  GuildBoss9Npc4ThousTerminator: {
    displayName: 'Scarab Occult Terminator',
    portrait: '/images/game-assets/npcs/thous_terminator.png',
    heroRef: 'thousNpc4Terminator'
  },
  GuildBoss9Npc5ThousScreamerSummon: {
    displayName: 'Screamer of Tzeentch',
    portrait: '/images/game-assets/npcs/thous_screamer.png',
    heroRef: 'thousNpc2Screamer'
  },
  necroChronomancer: {
    displayName: 'Thothmek',
    portrait: null,
    heroRef: 'thothmek'
  },
  necroDestroyer: {
    displayName: 'Imospekh',
    portrait: null,
    heroRef: 'imospekh'
  },
  necroOverlord: {
    displayName: 'Anuphet',
    portrait: null,
    heroRef: 'anuphet'
  },
  necroPlasmancer: {
    displayName: 'Thutmose',
    portrait: null,
    heroRef: 'thutmose'
  },
  necroReanimator: {
    displayName: 'Reanimator',
    portrait: null,
    heroRef: 'reanimator'
  },
  necroSmnDeathmark: {
    displayName: 'Deathmark',
    portrait: '/images/game-assets/npcs/necro_deathmark.png'
  },
  necroSmnDestroyer: {
    displayName: 'Ophydian Destroyer',
    portrait: '/images/game-assets/npcs/necro_destroyer.png'
  },
  necroSmnSwarm: {
    displayName: 'Scarab Swarm',
    portrait: '/images/game-assets/npcs/necro_scarab.png'
  },
  necroSmnWarrior: {
    displayName: 'Necron Warrior',
    portrait: '/images/game-assets/npcs/necro_warrior.png'
  },
  necroSpyder: {
    displayName: 'Aleph-Null',
    portrait: null,
    heroRef: 'aleph-null'
  },
  necroWarden: {
    displayName: 'Makhotep',
    portrait: null,
    heroRef: 'makhotep'
  },
  orksBigMek: {
    displayName: 'Gibbascrapz',
    portrait: null,
    heroRef: 'gibbascrapz'
  },
  orksGrot: {
    displayName: 'Grot',
    portrait: '/images/game-assets/npcs/orkss_grot.png'
  },
  orksGrotTank: {
    displayName: 'Grot Tank',
    portrait: '/images/game-assets/npcs/orkss_tank.png'
  },
  orksKillaKan: {
    displayName: 'Snappawrecka',
    portrait: null,
    heroRef: 'snappawrecka'
  },
  orksNob: {
    displayName: 'Tanksmasha',
    portrait: null,
    heroRef: 'tanksmasha'
  },
  orksOrkBoys: {
    displayName: 'Ork Boy',
    portrait: '/images/game-assets/npcs/orkss_boy.png'
  },
  orksRukkatrukk: {
    displayName: 'Rukkatrukk',
    portrait: null,
    heroRef: 'rukkatrukk'
  },
  orksRuntherd: {
    displayName: 'Snotflogga',
    portrait: null,
    heroRef: 'snotflogga'
  },
  orksSmnSquig: {
    displayName: 'Large Squig',
    portrait: '/images/game-assets/summons/orks_squig.png'
  },
  orksWarboss: {
    displayName: 'Gulgortz',
    portrait: null,
    heroRef: 'boss-gulgortz'
  },
  spaceBlackmane: {
    displayName: 'Ragnar',
    portrait: null,
    heroRef: 'blackmane'
  },
  spaceHound: {
    displayName: 'Tjark',
    portrait: null,
    heroRef: 'tjark'
  },
  spaceRockfist: {
    displayName: 'Arjac',
    portrait: null,
    heroRef: 'arjac-rockfist'
  },
  spaceStormcaller: {
    displayName: 'Njal',
    portrait: null,
    heroRef: 'stormcaller'
  },
  spaceWolfPriest: {
    displayName: 'Baldr',
    portrait: null,
    heroRef: 'baldr'
  },
  spaceWulfen: {
    displayName: 'Ulf',
    portrait: null,
    heroRef: 'ulf'
  },
  tauAunShi: {
    displayName: "Aun'Shi",
    portrait: null,
    heroRef: 'aun-shi'
  },
  tauBroadside: {
    displayName: "Tson'ji",
    portrait: null,
    heroRef: 'tau-broadside-battlesuit'
  },
  tauCrisis: {
    displayName: "Re'vas",
    portrait: null,
    heroRef: 'revas'
  },
  tauDarkstrider: {
    displayName: 'Darkstrider',
    portrait: null,
    heroRef: 'darkstrider'
  },
  tauFarsight: {
    displayName: 'Farsight',
    portrait: null,
    heroRef: 'farsight'
  },
  tauMarksman: {
    displayName: "Sho'syl",
    portrait: null,
    heroRef: 'shosyl'
  },
  tauShadowsun: {
    displayName: 'Shadowsun',
    portrait: null,
    heroRef: 'commander-shadowsun'
  },
  tauSmnDroneCommandLink: {
    displayName: 'Command-Link Drone',
    portrait: '/images/game-assets/summons/tau_command_link_drone.png'
  },
  tauSmnDroneShield: {
    displayName: 'Shield Drone',
    portrait: '/images/game-assets/npcs/tauta_drone_shield.png'
  },
  tauSmnDroneSniper: {
    displayName: 'Sniper Drone',
    portrait: '/images/game-assets/npcs/tauta_drone_sniper.png'
  },
  tauSmnStealthSuit: {
    displayName: 'Stealth Battlesuit',
    portrait: '/images/game-assets/npcs/tauta_stealthsuit.png'
  },
  templAggressor: {
    displayName: 'Burchard',
    portrait: null,
    heroRef: 'brother-burchard'
  },
  templAncient: {
    displayName: 'Thoread',
    portrait: null,
    heroRef: 'ancient-thoread'
  },
  templChampion: {
    displayName: 'Jaeger',
    portrait: null,
    heroRef: 'brother-jaeger'
  },
  templHelbrecht: {
    displayName: 'Helbrecht',
    portrait: null,
    heroRef: 'high-marshal-helbrecht'
  },
  templInitiate: {
    displayName: 'Initiate',
    portrait: '/images/game-assets/summons/templ_initiate.png'
  },
  templInitiatePyreblaster: {
    displayName: 'Initiate with Pyreblaster',
    portrait: '/images/game-assets/summons/templ_pyreblaster.png'
  },
  templNeophyte: {
    displayName: 'Neophyte',
    portrait: '/images/game-assets/summons/templ_neophyte.png'
  },
  templSmnAggressor: {
    displayName: 'Aggressor',
    portrait: '/images/game-assets/summons/templ_aggressor.png'
  },
  templSwordBrother: {
    displayName: 'Godswyl',
    portrait: null,
    heroRef: 'sword-brother-godswyl'
  },
  thousAhriman: {
    displayName: 'Ahriman',
    portrait: null,
    heroRef: 'ahriman'
  },
  thousDaemonPrince: {
    displayName: "Z'Kar",
    portrait: null,
    heroRef: 'zkar'
  },
  thousInfernalMaster: {
    displayName: 'Abraxas',
    portrait: null,
    heroRef: 'abraxas'
  },
  thousSekhetar: {
    displayName: 'Sekhetar Robot',
    portrait: null,
    heroRef: 'sekhetar-robot'
  },
  thousSmnBlueHorror: {
    displayName: 'Blue Horror',
    portrait: '/images/game-assets/npcs/thous_horror.png'
  },
  thousSmnBlueHorrorHSE: {
    displayName: 'Blue Horror',
    portrait: '/images/game-assets/npcs/thous_horror.png'
  },
  thousSmnDaemonPrince: {
    displayName: "Z'Kar",
    portrait: '/images/game-assets/summons/thous_daemon_prince.png'
  },
  thousSmnPinkHorror: {
    displayName: 'Pink Horror',
    portrait: '/images/game-assets/npcs/thous_horror.png'
  },
  thousSmnPinkHorrorHSE: {
    displayName: 'Pink Horror',
    portrait: '/images/game-assets/npcs/thous_horror.png'
  },
  thousSmnRubricMarine: {
    displayName: 'Rubric Marine',
    portrait: '/images/game-assets/npcs/thous_rubric.png'
  },
  thousSmnScreamer: {
    displayName: 'Screamer',
    portrait: '/images/game-assets/npcs/thous_screamer.png'
  },
  thousSmnScreamerHSE: {
    displayName: 'Screamer',
    portrait: '/images/game-assets/npcs/thous_screamer.png'
  },
  thousSorcerer: {
    displayName: 'Thaumachus',
    portrait: null,
    heroRef: 'thaumachus'
  },
  thousTerminator: {
    displayName: 'Toth',
    portrait: null,
    heroRef: 'toth'
  },
  thousTzaangor: {
    displayName: 'Yazaghor',
    portrait: null,
    heroRef: 'yazaghor'
  },
  tyranBiovore: {
    displayName: 'Biovore',
    portrait: null,
    heroRef: 'biovore'
  },
  tyranDeathleaper: {
    displayName: 'Deathleaper',
    portrait: null,
    heroRef: 'deathleaper'
  },
  tyranNeurothrope: {
    displayName: 'Neurothrope',
    portrait: null,
    heroRef: 'neurothrope'
  },
  tyranParasite: {
    displayName: 'Parasite of Mortrex',
    portrait: null,
    heroRef: 'parasite-of-mortrex'
  },
  tyranSmnBarbgaunt: {
    displayName: 'Barbgaunt',
    portrait: '/images/game-assets/npcs/tyran_barbgaunt.png'
  },
  tyranSmnHormagaunt: {
    displayName: 'Hormagaunt',
    portrait: '/images/game-assets/npcs/tyran_hormagaunt.png'
  },
  tyranSmnRipperSwarm: {
    displayName: 'Ripper Swarm',
    portrait: '/images/game-assets/npcs/tyran_ripper.png'
  },
  tyranSmnSporeMine: {
    displayName: 'Spore Mine',
    portrait: '/images/game-assets/summons/tyran_spore_mine.png'
  },
  tyranSmnTermagant: {
    displayName: 'Termagant',
    portrait: '/images/game-assets/npcs/tyran_termagant.png'
  },
  tyranSmnWarrior: {
    displayName: 'Tyranid Warrior',
    portrait: '/images/game-assets/npcs/tyran_warrior.png'
  },
  tyranTyrantGuard: {
    displayName: 'Tyrant Guard',
    portrait: null,
    heroRef: 'tyrant-guard'
  },
  tyranWingedPrime: {
    displayName: 'Winged Prime',
    portrait: null,
    heroRef: 'winged-prime'
  },
  ultraApothecary: {
    displayName: 'Incisus',
    portrait: null,
    heroRef: 'incisus'
  },
  ultraCalgar: {
    displayName: 'Calgar',
    portrait: null,
    heroRef: 'marneus-calgar'
  },
  ultraDreadnought: {
    displayName: 'Galatian',
    portrait: null,
    heroRef: 'galatian'
  },
  ultraEliminatorSgt: {
    displayName: 'Certus',
    portrait: null,
    heroRef: 'certus'
  },
  ultraInceptorSgt: {
    displayName: 'Bellator',
    portrait: null,
    heroRef: 'bellator'
  },
  ultraSmnDreadnought: {
    displayName: 'Galatian',
    portrait: '/images/game-assets/summons/ultra_dreadnought.png'
  },
  ultraSmnEliminator: {
    displayName: 'Eliminator',
    portrait: '/images/game-assets/summons/ultra_eliminator.png'
  },
  ultraSmnHeavyIntercessor: {
    displayName: 'Heavy Intercessor',
    portrait: '/images/game-assets/summons/ultra_heavy_intercessor.png'
  },
  ultraSmnInceptor: {
    displayName: 'Inceptor',
    portrait: '/images/game-assets/summons/ultra_inceptor.png'
  },
  ultraTigurius: {
    displayName: 'Tigurius',
    portrait: null,
    heroRef: 'varro-tigurius'
  },
  ultraTitus: {
    displayName: 'Titus',
    portrait: null,
    heroRef: 'titus'
  },
  votanBeserk: {
    displayName: 'Havyr',
    portrait: null,
    heroRef: 'havyr'
  },
  votanChampion: {
    displayName: 'Kimm',
    portrait: null,
    heroRef: 'kimm'
  },
  votanIronmaster: {
    displayName: 'Vynn',
    portrait: null,
    heroRef: 'vynn'
  },
  votanMemnyr: {
    displayName: 'Ammuk',
    portrait: null,
    heroRef: 'ammuk'
  },
  votanSmnEcog: {
    displayName: 'E-COG',
    portrait: '/images/game-assets/summons/votan_ecog.png'
  },
  votanSmnSteeljack: {
    displayName: 'Ironkin Steeljack',
    portrait: '/images/game-assets/summons/votan_steeljack.png'
  },
  votanUthar: {
    displayName: 'Uthar',
    portrait: null,
    heroRef: 'uthar'
  },
  worldEightbound: {
    displayName: 'Azkor',
    portrait: null,
    heroRef: 'azkor'
  },
  worldExecutions: {
    displayName: 'Tarvakh',
    portrait: null,
    heroRef: 'tarvakh'
  },
  worldJakhal: {
    displayName: 'Macer',
    portrait: null,
    heroRef: 'macer'
  },
  worldKharn: {
    displayName: 'Kharn',
    portrait: null,
    heroRef: 'kharn'
  },
  worldTerminator: {
    displayName: 'Wrask',
    portrait: null,
    heroRef: 'wrask'
  }
} as const satisfies Record<string, GeneratedUnitPresentation>

export const generatedUnitPresentationsByUnitId = {
  abraxas: {
    displayName: 'Arkarzar Abraxas',
    portrait: null,
    heroRef: 'abraxas'
  },
  actus: {
    displayName: 'Manipulus Actus Fulgorosus',
    portrait: null,
    heroRef: 'actus'
  },
  adeptCanoness: {
    displayName: 'Roswitha',
    portrait: null,
    heroRef: 'roswitha'
  },
  adeptCelestine: {
    displayName: 'Celestine',
    portrait: null,
    heroRef: 'celestine'
  },
  adeptExorcist: {
    displayName: 'Exorcist',
    portrait: null,
    heroRef: 'exorcist'
  },
  adeptHospitaller: {
    displayName: 'Isabella',
    portrait: null,
    heroRef: 'isabella'
  },
  adeptMorvenn: {
    displayName: 'Morvenn Vahl',
    portrait: null,
    heroRef: 'morvenn-vahl'
  },
  adeptRetributor: {
    displayName: 'Vindicta',
    portrait: null,
    heroRef: 'vindicta'
  },
  adeptSmnBattleSister: {
    displayName: 'Battle Sister',
    portrait: '/images/game-assets/summons/adept_battle_sister.png'
  },
  adeptSmnGeminaeSuperia: {
    displayName: 'Geminae Superia',
    portrait: '/images/game-assets/summons/adept_geminae_superia.png'
  },
  admecDestroyer: {
    displayName: 'Sy-gex',
    portrait: null,
    heroRef: 'sy-gex'
  },
  admecDominus: {
    displayName: 'Vitruvius',
    portrait: null,
    heroRef: 'virtuvius'
  },
  admecManipulus: {
    displayName: 'Actus',
    portrait: null,
    heroRef: 'actus'
  },
  admecMarshall: {
    displayName: "Tan Gi'da",
    portrait: null,
    heroRef: 'tan-gida'
  },
  admecNpc2Techpriest: {
    displayName: 'Tech-Priest Enginseer',
    portrait: '/images/game-assets/npcs/admec_techpriest.png',
    heroRef: 'admecNpc2Techpriest'
  },
  admecNpc3Electropriest: {
    displayName: 'Corpuscarii Electro-priest',
    portrait: '/images/game-assets/npcs/admec_electropriest.png',
    heroRef: 'admecNpc3Electropriest'
  },
  admecRuststalker: {
    displayName: 'Exitor-Rho',
    portrait: null,
    heroRef: 'exitor-rho'
  },
  admecSmnElectropriest: {
    displayName: 'Electro-priest',
    portrait: '/images/game-assets/npcs/admec_electropriest.png'
  },
  admecSmnTechpriest: {
    displayName: 'Tech-Priest Enginseer',
    portrait: '/images/game-assets/npcs/admec_techpriest.png'
  },
  admecSmnVanguard: {
    displayName: 'Skitarii Vanguard',
    portrait: '/images/game-assets/summons/admec_vanguard.png'
  },
  aethana: {
    displayName: 'Aethana Barantharal',
    portrait: null,
    heroRef: 'aethana'
  },
  astarCyrus: {
    displayName: 'Cyrus',
    portrait: null,
    heroRef: 'cyrus'
  },
  astarLysander: {
    displayName: 'Lysander',
    portrait: null,
    heroRef: 'lysander'
  },
  astarSmnHaywireMine: {
    displayName: 'Haywire Mine',
    portrait: '/images/game-assets/summons/astar_haywire_mine.png'
  },
  astraBullgryn: {
    displayName: 'Kut',
    portrait: null,
    heroRef: 'kut-skoden'
  },
  astraCreed: {
    displayName: 'Creed',
    portrait: null,
    heroRef: 'castellan-creed'
  },
  astraDreir: {
    displayName: 'Dreir',
    portrait: null,
    heroRef: 'marshal-dreir'
  },
  astraNpc1Guardsman: {
    displayName: 'Cadian Guardsman',
    portrait: '/images/game-assets/npcs/astra_guardsman.png',
    heroRef: 'astraNpc1Guardsman'
  },
  astraNpc2Lascannon: {
    displayName: 'Cadian Lascannon Team',
    portrait: '/images/game-assets/npcs/astra_lascannon.png',
    heroRef: 'astraNpc2Lascannon'
  },
  astraNpc3Voxcaster: {
    displayName: 'Cadian Vox-caster',
    portrait: '/images/game-assets/npcs/astra_voxcaster.png',
    heroRef: 'astraNpc3Voxcaster'
  },
  astraNpc4Mortar: {
    displayName: 'Cadian Mortar Team',
    portrait: '/images/game-assets/npcs/astra_mortar.png',
    heroRef: 'astraNpc4Mortar'
  },
  astraOrdnance: {
    displayName: 'Thaddeus',
    portrait: null,
    heroRef: 'thaddeus-noble'
  },
  astraOrdnanceBattery: {
    displayName: 'Malleus Rocket Launcher',
    portrait: null,
    heroRef: 'malleus-rocket-launcher'
  },
  astraPrimarisPsy: {
    displayName: 'Sibyll',
    portrait: null,
    heroRef: 'sibyll-devine'
  },
  astraSmnDeathRider: {
    displayName: 'Death Rider',
    portrait: '/images/game-assets/summons/astra_death_rider.png'
  },
  astraSmnGuardsman: {
    displayName: 'Cadian Guardsman',
    portrait: '/images/game-assets/npcs/astra_guardsman.png'
  },
  astraSmnKell: {
    displayName: 'Kell',
    portrait: '/images/game-assets/summons/astra_kell.png'
  },
  astraSmnLascannon: {
    displayName: 'Cadian Lascannon Team',
    portrait: '/images/game-assets/npcs/astra_lascannon.png'
  },
  astraSmnMortar: {
    displayName: 'Cadian Mortar Team',
    portrait: '/images/game-assets/npcs/astra_mortar.png'
  },
  astraSmnVoxcaster: {
    displayName: 'Cadian Vox-caster',
    portrait: '/images/game-assets/npcs/astra_voxcaster.png'
  },
  astraYarrick: {
    displayName: 'Yarrick',
    portrait: null,
    heroRef: 'commissar-yarrick'
  },
  baraqiel: {
    displayName: 'Baraqiel',
    portrait: null,
    heroRef: 'baraqiel'
  },
  blackAbaddon: {
    displayName: 'Abaddon',
    portrait: null,
    heroRef: 'abaddon-the-despoiler'
  },
  blackForgefiend: {
    displayName: 'Forgefiend',
    portrait: null,
    heroRef: 'forgefiend'
  },
  blackHaarken: {
    displayName: 'Haarken',
    portrait: null,
    heroRef: 'haarkeen-worldclaimer'
  },
  blackObliterator: {
    displayName: 'Volk',
    portrait: null,
    heroRef: 'volk'
  },
  blackPossession: {
    displayName: 'Archimatos',
    portrait: null,
    heroRef: 'archimatos'
  },
  blackSmnBloodletter: {
    displayName: 'Bloodletter',
    portrait: '/images/game-assets/summons/black_bloodletter.png'
  },
  blackSmnBloodletterHSE: {
    displayName: 'Bloodletter',
    portrait: '/images/game-assets/summons/black_bloodletter.png'
  },
  blackSmnHavoc: {
    displayName: 'Havoc',
    portrait: '/images/game-assets/summons/black_havoc.png'
  },
  blackSmnTerminator: {
    displayName: 'Chaos Terminator',
    portrait: '/images/game-assets/summons/black_terminator.png'
  },
  blackTerminator: {
    displayName: 'Angrax',
    portrait: null,
    heroRef: 'angrax'
  },
  bloodDante: {
    displayName: 'Dante',
    portrait: null,
    heroRef: 'dante'
  },
  bloodDeathCompany: {
    displayName: 'Lucien',
    portrait: null,
    heroRef: 'lucien'
  },
  bloodIntercessor: {
    displayName: 'Mataneo',
    portrait: null,
    heroRef: 'mataneo'
  },
  bloodMephiston: {
    displayName: 'Mephiston',
    portrait: null,
    heroRef: 'mephiston'
  },
  bloodSanguinary: {
    displayName: 'Nicodemus',
    portrait: null,
    heroRef: 'nicodemus'
  },
  bloodSmnIntercessor: {
    displayName: 'Jump Pack Intercessor',
    portrait: '/images/game-assets/summons/blood_intercessor.png'
  },
  bloodTerminator: {
    displayName: 'Cezare',
    portrait: null,
    heroRef: 'cezare'
  },
  corrodius: {
    displayName: 'Corrodius Achebile',
    portrait: null,
    heroRef: 'corrodius'
  },
  custoAtlacoya: {
    displayName: 'Atlacoya',
    portrait: null,
    heroRef: 'atlacoya'
  },
  custoBladeChampion: {
    displayName: 'Kariyan',
    portrait: null,
    heroRef: 'kariyan'
  },
  custoKyrus: {
    displayName: 'Tyrith',
    portrait: null,
    heroRef: 'tyrith'
  },
  custoTrajann: {
    displayName: 'Trajann',
    portrait: null,
    heroRef: 'trajann'
  },
  custoVexilusPraetor: {
    displayName: 'Aesoth',
    portrait: null,
    heroRef: 'aesoth'
  },
  darkaAsmodai: {
    displayName: 'Asmodai',
    portrait: null,
    heroRef: 'asmodai'
  },
  darkaAzrael: {
    displayName: 'Azrael',
    portrait: null,
    heroRef: 'azrael'
  },
  darkaCompanion: {
    displayName: 'Forcas',
    portrait: null,
    heroRef: 'forcas'
  },
  darkaHellblaster: {
    displayName: 'Sarquael',
    portrait: null,
    heroRef: 'sarquael'
  },
  darkaNpc1Infiltrator: {
    displayName: 'Infiltrator',
    portrait: '/images/game-assets/npcs/darka_infiltrator.png',
    heroRef: 'darkaNpc1Infiltrator'
  },
  darkaNpc2Hellblaster: {
    displayName: 'Hellblaster',
    portrait: '/images/game-assets/npcs/darka_hellblaster.png',
    heroRef: 'darkaNpc2Hellblaster'
  },
  darkaNpc3Terminator: {
    displayName: 'Deathwing Knight',
    portrait: '/images/game-assets/npcs/darka_terminator.png',
    heroRef: 'darkaNpc3Terminator'
  },
  darkaNpc4Watcher: {
    displayName: 'Watcher in the Dark',
    portrait: '/images/game-assets/npcs/darka_watcher.png',
    heroRef: 'darkaNpc4Watcher'
  },
  darkaSmnHellblaster: {
    displayName: 'Hellblaster',
    portrait: '/images/game-assets/npcs/darka_hellblaster.png'
  },
  darkaSmnInfiltrator: {
    displayName: 'Infiltrator',
    portrait: '/images/game-assets/npcs/darka_infiltrator.png'
  },
  darkaSmnTerminator: {
    displayName: 'Deathwing Knight',
    portrait: '/images/game-assets/npcs/darka_terminator.png'
  },
  darkaSmnWatcher: {
    displayName: 'Watcher',
    portrait: '/images/game-assets/npcs/darka_watcher.png'
  },
  darkaSternguard: {
    displayName: 'Ramus',
    portrait: null,
    heroRef: 'ramus'
  },
  darkaStormSpeeder: {
    displayName: 'Storm Speeder',
    portrait: null,
    heroRef: 'storm-speeder'
  },
  darkaTerminator: {
    displayName: 'Baraqiel',
    portrait: null,
    heroRef: 'baraqiel'
  },
  deathBlightbringer: {
    displayName: 'Corrodius',
    portrait: null,
    heroRef: 'corrodius'
  },
  deathBlightlord: {
    displayName: 'Maladus',
    portrait: null,
    heroRef: 'maladus'
  },
  deathCrawler: {
    displayName: 'Plagueburst Crawler',
    portrait: null,
    heroRef: 'plagueburst-crawler'
  },
  deathPoxwalker: {
    displayName: 'Poxwalker',
    portrait: '/images/game-assets/npcs/death_poxwalker.png',
    heroRef: 'deathPoxwalker'
  },
  deathPutrifier: {
    displayName: 'Pestillian',
    portrait: null,
    heroRef: 'pestillian'
  },
  deathRotbone: {
    displayName: 'Nauseous',
    portrait: null,
    heroRef: 'nauseous-rotbone'
  },
  deathSmnNurglings: {
    displayName: 'Nurglings',
    portrait: '/images/game-assets/summons/death_nurglings.png'
  },
  deathTyphus: {
    displayName: 'Typhus',
    portrait: null,
    heroRef: 'typhus'
  },
  eldarAutarch: {
    displayName: 'Aethana',
    portrait: null,
    heroRef: 'aethana'
  },
  eldarFarseer: {
    displayName: 'Eldryon',
    portrait: null,
    heroRef: 'eldryon'
  },
  eldarJainZar: {
    displayName: 'Jain Zar',
    portrait: null,
    heroRef: 'jain-zar'
  },
  eldarLhykhis: {
    displayName: 'Lhykhis',
    portrait: null,
    heroRef: 'lhykhis'
  },
  eldarMauganRa: {
    displayName: 'Maugan Ra',
    portrait: null,
    heroRef: 'maugan-ra'
  },
  eldarNpc1Guardian: {
    displayName: 'Guardian Defender',
    portrait: '/images/game-assets/npcs/aelda_guardian.png',
    heroRef: 'eldarNpc1Guardian'
  },
  eldarNpc2Warlock: {
    displayName: 'Warlock',
    portrait: '/images/game-assets/npcs/aelda_warlock.png',
    heroRef: 'eldarNpc2Warlock'
  },
  eldarNpc3Harlequin: {
    displayName: 'Harlequin Troupe Player',
    portrait: '/images/game-assets/npcs/aelda_harlequin.png',
    heroRef: 'eldarNpc3Harlequin'
  },
  eldarNpc4Wraithguard: {
    displayName: 'Wraithguard',
    portrait: '/images/game-assets/npcs/aelda_wraithguard.png',
    heroRef: 'eldarNpc4Wraithguard'
  },
  eldarRanger: {
    displayName: 'Calandis',
    portrait: null,
    heroRef: 'calandis'
  },
  eldarSmnGuardian: {
    displayName: 'Guardian',
    portrait: '/images/game-assets/summons/eldar_guardian.png'
  },
  eldarSmnHarlequin: {
    displayName: 'Harlequin Player',
    portrait: '/images/game-assets/summons/eldar_harlequin.png'
  },
  eldryon: {
    displayName: 'Eldryon Ynaduin',
    portrait: null,
    heroRef: 'eldryon'
  },
  emperExultant: {
    displayName: 'Laviscus',
    portrait: null,
    heroRef: 'laviscus'
  },
  emperFlawlessBlade: {
    displayName: 'Hascule',
    portrait: null,
    heroRef: 'hascule'
  },
  emperKakophonist: {
    displayName: 'Adamatar',
    portrait: null,
    heroRef: 'adamatar'
  },
  emperLucius: {
    displayName: 'Lucius',
    portrait: null,
    heroRef: 'lucius'
  },
  emperNoiseMarine: {
    displayName: 'Shiron',
    portrait: null,
    heroRef: 'shiron'
  },
  'exitor-rho': {
    displayName: 'Exitor-Rho-1.15/x',
    portrait: '/images/game-assets/npcs/admec_ruststalker.png',
    heroRef: 'exitor-rho'
  },
  forcas: {
    displayName: 'Forcas Oathsworn',
    portrait: null,
    heroRef: 'forcas'
  },
  genesBiophagus: {
    displayName: 'Hollan',
    portrait: null,
    heroRef: 'hollan'
  },
  genesKelermorph: {
    displayName: 'Judh',
    portrait: null,
    heroRef: 'judh'
  },
  genesMagus: {
    displayName: 'Xybia',
    portrait: null,
    heroRef: 'xybia'
  },
  genesPatriarch: {
    displayName: 'The Patermine',
    portrait: null,
    heroRef: 'patermine'
  },
  genesPrimus: {
    displayName: 'Isaak',
    portrait: null,
    heroRef: 'isaak'
  },
  genesSmnAberrant: {
    displayName: 'Aberrant Hypermorph',
    portrait: '/images/game-assets/summons/genes_aberrant.png'
  },
  genesSmnDecoy: {
    displayName: 'Decoy',
    portrait: '/images/game-assets/summons/genes_decoy.png'
  },
  genesSmnGenestealer: {
    displayName: 'Purestrain Genestealer',
    portrait: '/images/game-assets/summons/genes_genestealer.png'
  },
  genesSmnNeophyte: {
    displayName: 'Neophyte Hybrid',
    portrait: '/images/game-assets/summons/genes_neophyte.png'
  },
  gibbascrapz: {
    displayName: 'Gibbascrapz, da Spezulist',
    portrait: null,
    heroRef: 'gibbascrapz'
  },
  GuildBoss10Boss1AdmecBelisarius: {
    displayName: 'Belisarius Cawl',
    portrait: '/images/bosses/portraits/belisarius_main.png'
  },
  GuildBoss11Boss1TauRiptide: {
    displayName: 'XV104 Riptide Battlesuit',
    portrait: '/images/bosses/portraits/riptide_main.png'
  },
  GuildBoss12Boss1DarkaLion: {
    displayName: "Lion El'Jonson",
    portrait: '/images/bosses/portraits/lion_main.png'
  },
  GuildBoss1Boss1TyranTervigonLeviathan: {
    displayName: 'Tervigon (Hive Fleet Leviathan)',
    portrait: '/images/bosses/portraits/tervigonleviathan_main.png'
  },
  GuildBoss1Boss2TyranTervigonKronos: {
    displayName: 'Tervigon (Hive Fleet Kronos)',
    portrait: '/images/bosses/portraits/tervigonkronos_main.png'
  },
  GuildBoss1Boss3TyranTervigonGorgon: {
    displayName: 'Tervigon (Hive Fleet Gorgon)',
    portrait: '/images/bosses/portraits/tervigongorgon_main.png'
  },
  GuildBoss1MiniBoss1TyranWarriorLeviathan: {
    displayName: 'Tyranid Prime (Leviathan)',
    portrait: null
  },
  GuildBoss1MiniBoss2TyranWarriorKronos: {
    displayName: 'Tyranid Prime (Kronos)',
    portrait: null
  },
  GuildBoss1MiniBoss3TyranWarriorGorgon: {
    displayName: 'Tyranid Prime (Gorgon)',
    portrait: null
  },
  GuildBoss2Boss1TyranHiveTyrantLeviathan: {
    displayName: 'Hive Tyrant (Hive Fleet Leviathan)',
    portrait: '/images/bosses/portraits/hivetyrantleviathan_main.png'
  },
  GuildBoss2Boss2TyranHiveTyrantKronos: {
    displayName: 'Hive Tyrant (Hive Fleet Kronos)',
    portrait: '/images/bosses/portraits/hivetyrantkronos_main.png'
  },
  GuildBoss2Boss3TyranHiveTyrantGorgon: {
    displayName: 'Hive Tyrant (Hive Fleet Gorgon)',
    portrait: '/images/bosses/portraits/hivetyrantgorgon_main.png'
  },
  GuildBoss3Boss1NecroSilentKing: {
    displayName: 'Szarekh',
    portrait: '/images/bosses/portraits/silentking_main.png'
  },
  GuildBoss3Minion1NecroMesophet: {
    displayName: 'Mesophet of the Shadowed Hand',
    portrait: '/images/game-assets/npcs/necro_mesophet.png'
  },
  GuildBoss3Minion2NecroHapthatra: {
    displayName: 'Hapthatra the Radiant',
    portrait: '/images/game-assets/npcs/necro_hapthatra.png'
  },
  GuildBoss3Minion3NecroMenhir: {
    displayName: 'Triarchal Menhir',
    portrait: '/images/game-assets/npcs/necro_menhir.png'
  },
  GuildBoss4Boss1OrksGhazghkull: {
    displayName: 'Ghazghkull Mag Uruk Thraka',
    portrait: '/images/bosses/portraits/ghazghkull_main.png'
  },
  GuildBoss5Boss1DeathMortarion: {
    displayName: 'Mortarion, the Death Lord',
    portrait: '/images/bosses/portraits/mortarion_main.png'
  },
  GuildBoss5Minion1DeathBlightlord: {
    displayName: 'Blightlord Terminator',
    portrait: '/images/game-assets/npcs/death_blightlord.png'
  },
  GuildBoss6Boss1TyranScreamerKiller: {
    displayName: 'Screamer-Killer',
    portrait: '/images/bosses/portraits/screamerkiller_main.png'
  },
  GuildBoss7Boss1AstraRogaldorn: {
    displayName: 'Rogal Dorn Battle Tank',
    portrait: '/images/bosses/portraits/rogaldorn_main.png'
  },
  GuildBoss8Boss1EldarAvatar: {
    displayName: 'Avatar of Khaine',
    portrait: '/images/bosses/portraits/avatarofkhaine_main.png'
  },
  GuildBoss9Boss1ThousMagnus: {
    displayName: 'Magnus the Red',
    portrait: '/images/bosses/portraits/magnus_main.png'
  },
  LootObj_ExplOilDrum: {
    displayName: 'Explosive Oil Drum',
    portrait: '/images/game-assets/npcs/loots_expoildrum.png',
    heroRef: 'LootObj_ExplOilDrum'
  },
  LootObj_Pod_Common_Imp: {
    displayName: 'Common Imperial Supply Pod',
    portrait: '/images/game-assets/npcs/loots_pod_common.png',
    heroRef: 'LootObj_Pod_Common_Imp'
  },
  'nauseous-rotbone': {
    displayName: 'Nauseous Rotbone',
    portrait: null,
    heroRef: 'nauseous-rotbone'
  },
  necroChronomancer: {
    displayName: 'Thothmek',
    portrait: null,
    heroRef: 'thothmek'
  },
  necroDestroyer: {
    displayName: 'Imospekh',
    portrait: null,
    heroRef: 'imospekh'
  },
  necroNpc1Warrior: {
    displayName: 'Necron Warrior',
    portrait: '/images/game-assets/npcs/necro_warrior.png',
    heroRef: 'necroNpc1Warrior'
  },
  necroNpc2FlayedOne: {
    displayName: 'Flayed One',
    portrait: '/images/game-assets/npcs/necro_flayedone.png',
    heroRef: 'necroNpc2FlayedOne'
  },
  necroNpc3Deathmark: {
    displayName: 'Deathmark',
    portrait: '/images/game-assets/npcs/necro_deathmark.png',
    heroRef: 'necroNpc3Deathmark'
  },
  necroNpc4Destroyer: {
    displayName: 'Ophydian Destroyer',
    portrait: '/images/game-assets/npcs/necro_destroyer.png',
    heroRef: 'necroNpc4Destroyer'
  },
  necroOverlord: {
    displayName: 'Anuphet',
    portrait: null,
    heroRef: 'anuphet'
  },
  necroPlasmancer: {
    displayName: 'Thutmose',
    portrait: null,
    heroRef: 'thutmose'
  },
  necroReanimator: {
    displayName: 'Reanimator',
    portrait: null,
    heroRef: 'reanimator'
  },
  necroSmnDeathmark: {
    displayName: 'Deathmark',
    portrait: '/images/game-assets/npcs/necro_deathmark.png'
  },
  necroSmnDestroyer: {
    displayName: 'Ophydian Destroyer',
    portrait: '/images/game-assets/npcs/necro_destroyer.png'
  },
  necroSmnSwarm: {
    displayName: 'Scarab Swarm',
    portrait: '/images/game-assets/npcs/necro_scarab.png',
    heroRef: 'necroSmnSwarm'
  },
  necroSmnWarrior: {
    displayName: 'Necron Warrior',
    portrait: '/images/game-assets/npcs/necro_warrior.png'
  },
  necroSpyder: {
    displayName: 'Aleph-Null',
    portrait: null,
    heroRef: 'aleph-null'
  },
  necroWarden: {
    displayName: 'Makhotep',
    portrait: null,
    heroRef: 'makhotep'
  },
  neurothrope: {
    displayName: 'Neurothrope',
    portrait: null,
    heroRef: 'neurothrope'
  },
  orksBigMek: {
    displayName: 'Gibbascrapz',
    portrait: null,
    heroRef: 'gibbascrapz'
  },
  orksGrot: {
    displayName: 'Grot',
    portrait: '/images/game-assets/npcs/orkss_grot.png'
  },
  orksGrotTank: {
    displayName: 'Grot Tank',
    portrait: '/images/game-assets/npcs/orkss_tank.png'
  },
  orksKillaKan: {
    displayName: 'Snappawrecka',
    portrait: null,
    heroRef: 'snappawrecka'
  },
  orksNob: {
    displayName: 'Tanksmasha',
    portrait: null,
    heroRef: 'tanksmasha'
  },
  orksNpc1Grot: {
    displayName: 'Grot',
    portrait: '/images/game-assets/npcs/orkss_grot.png',
    heroRef: 'orksNpc1Grot'
  },
  orksNpc2OrkBoy: {
    displayName: 'Ork Boy',
    portrait: '/images/game-assets/npcs/orkss_boy.png',
    heroRef: 'orksNpc2OrkBoy'
  },
  orksNpc3GrotTank: {
    displayName: 'Grot Tank',
    portrait: '/images/game-assets/npcs/orkss_tank.png',
    heroRef: 'orksNpc3GrotTank'
  },
  orksNpc6Stormboy: {
    displayName: 'Stormboy',
    portrait: '/images/game-assets/npcs/orkss_stormboy.png',
    heroRef: 'orksNpc6Stormboy'
  },
  orksOrkBoys: {
    displayName: 'Ork Boy',
    portrait: '/images/game-assets/npcs/orkss_boy.png'
  },
  orksRukkatrukk: {
    displayName: 'Rukkatrukk',
    portrait: null,
    heroRef: 'rukkatrukk'
  },
  orksRuntherd: {
    displayName: 'Snotflogga',
    portrait: null,
    heroRef: 'snotflogga'
  },
  orksSmnSquig: {
    displayName: 'Large Squig',
    portrait: '/images/game-assets/summons/orks_squig.png'
  },
  orksWarboss: {
    displayName: 'Gulgortz',
    portrait: null,
    heroRef: 'boss-gulgortz'
  },
  revas: {
    displayName: "Shas'vre Vior'la Re'vas",
    portrait: null,
    heroRef: 'revas'
  },
  shosyl: {
    displayName: "Shas'ui Vior'la Sho'syl",
    portrait: null,
    heroRef: 'shosyl'
  },
  'sibyll-devine': {
    displayName: 'Sibyll Devine',
    portrait: null,
    heroRef: 'sibyll-devine'
  },
  snappawrecka: {
    displayName: 'Snappawrecka',
    portrait: '/images/game-assets/npcs/orkss_killakan.png',
    heroRef: 'snappawrecka'
  },
  snotflogga: {
    displayName: 'Grumbal Snotflogga',
    portrait: '/images/game-assets/npcs/orkss_runtherd.png',
    heroRef: 'snotflogga'
  },
  spaceBlackmane: {
    displayName: 'Ragnar',
    portrait: null,
    heroRef: 'blackmane'
  },
  spaceHound: {
    displayName: 'Tjark',
    portrait: null,
    heroRef: 'tjark'
  },
  spaceRockfist: {
    displayName: 'Arjac',
    portrait: null,
    heroRef: 'arjac-rockfist'
  },
  spaceStormcaller: {
    displayName: 'Njal',
    portrait: null,
    heroRef: 'stormcaller'
  },
  spaceWolfPriest: {
    displayName: 'Baldr',
    portrait: null,
    heroRef: 'baldr'
  },
  spaceWulfen: {
    displayName: 'Ulf',
    portrait: null,
    heroRef: 'ulf'
  },
  'sy-gex': {
    displayName: 'Sy-gex-KPH008/15.mk41',
    portrait: '/images/game-assets/npcs/admec_destroyer.png',
    heroRef: 'sy-gex'
  },
  'tan-gida': {
    displayName: "Tan Gi'da",
    portrait: null,
    heroRef: 'tan-gida'
  },
  tanksmasha: {
    displayName: 'Olog Tanksmasha',
    portrait: null,
    heroRef: 'tanksmasha'
  },
  tauAunShi: {
    displayName: "Aun'Shi",
    portrait: null,
    heroRef: 'aun-shi'
  },
  tauBroadside: {
    displayName: "Tson'ji",
    portrait: null,
    heroRef: 'tau-broadside-battlesuit'
  },
  tauCrisis: {
    displayName: "Re'vas",
    portrait: null,
    heroRef: 'revas'
  },
  tauDarkstrider: {
    displayName: 'Darkstrider',
    portrait: null,
    heroRef: 'darkstrider'
  },
  tauFarsight: {
    displayName: 'Farsight',
    portrait: null,
    heroRef: 'farsight'
  },
  tauMarksman: {
    displayName: "Sho'syl",
    portrait: null,
    heroRef: 'shosyl'
  },
  tauNpc1FireWarrior: {
    displayName: "Fire Warrior Shas'la",
    portrait: '/images/game-assets/npcs/tauta_firewarrior.png',
    heroRef: 'tauNpc1FireWarrior'
  },
  tauNpc5StealthSuit: {
    displayName: 'XV25 Stealth Battlesuit',
    portrait: '/images/game-assets/npcs/tauta_stealthsuit.png',
    heroRef: 'tauNpc5StealthSuit'
  },
  tauShadowsun: {
    displayName: 'Shadowsun',
    portrait: null,
    heroRef: 'commander-shadowsun'
  },
  tauSmnDroneCommandLink: {
    displayName: 'Command-Link Drone',
    portrait: '/images/game-assets/summons/tau_command_link_drone.png'
  },
  tauSmnDroneShield: {
    displayName: 'Shield Drone',
    portrait: '/images/game-assets/npcs/tauta_drone_shield.png'
  },
  tauSmnDroneSniper: {
    displayName: 'Sniper Drone',
    portrait: '/images/game-assets/npcs/tauta_drone_sniper.png'
  },
  tauSmnStealthSuit: {
    displayName: 'Stealth Battlesuit',
    portrait: '/images/game-assets/npcs/tauta_stealthsuit.png'
  },
  templAggressor: {
    displayName: 'Burchard',
    portrait: null,
    heroRef: 'brother-burchard'
  },
  templAncient: {
    displayName: 'Thoread',
    portrait: null,
    heroRef: 'ancient-thoread'
  },
  templChampion: {
    displayName: 'Jaeger',
    portrait: null,
    heroRef: 'brother-jaeger'
  },
  templHelbrecht: {
    displayName: 'Helbrecht',
    portrait: null,
    heroRef: 'high-marshal-helbrecht'
  },
  templInitiate: {
    displayName: 'Initiate',
    portrait: '/images/game-assets/summons/templ_initiate.png'
  },
  templInitiatePyreblaster: {
    displayName: 'Initiate with Pyreblaster',
    portrait: '/images/game-assets/summons/templ_pyreblaster.png'
  },
  templNeophyte: {
    displayName: 'Neophyte',
    portrait: '/images/game-assets/summons/templ_neophyte.png'
  },
  templSmnAggressor: {
    displayName: 'Aggressor',
    portrait: '/images/game-assets/summons/templ_aggressor.png'
  },
  templSwordBrother: {
    displayName: 'Godswyl',
    portrait: null,
    heroRef: 'sword-brother-godswyl'
  },
  'thaddeus-noble': {
    displayName: 'Thaddeus Noble',
    portrait: null,
    heroRef: 'thaddeus-noble'
  },
  thaumachus: {
    displayName: 'Kairatar Thaumachus',
    portrait: null,
    heroRef: 'thaumachus'
  },
  thousAhriman: {
    displayName: 'Ahriman',
    portrait: null,
    heroRef: 'ahriman'
  },
  thousDaemonPrince: {
    displayName: "Z'Kar",
    portrait: null,
    heroRef: 'zkar'
  },
  thousInfernalMaster: {
    displayName: 'Abraxas',
    portrait: null,
    heroRef: 'abraxas'
  },
  thousNpc1PinkHorror: {
    displayName: 'Pink Horror of Tzeentch',
    portrait: '/images/game-assets/npcs/thous_horror.png',
    heroRef: 'thousNpc1PinkHorror'
  },
  thousNpc2Screamer: {
    displayName: 'Screamer of Tzeentch',
    portrait: '/images/game-assets/npcs/thous_screamer.png',
    heroRef: 'thousNpc2Screamer'
  },
  thousNpc3RubricMarine: {
    displayName: 'Rubric Marine',
    portrait: '/images/game-assets/npcs/thous_rubric.png',
    heroRef: 'thousNpc3RubricMarine'
  },
  thousNpc4Terminator: {
    displayName: 'Scarab Occult Terminator',
    portrait: '/images/game-assets/npcs/thous_terminator.png',
    heroRef: 'thousNpc4Terminator'
  },
  thousSekhetar: {
    displayName: 'Sekhetar Robot',
    portrait: null,
    heroRef: 'sekhetar-robot'
  },
  thousSmnBlueHorror: {
    displayName: 'Blue Horror',
    portrait: '/images/game-assets/npcs/thous_horror.png'
  },
  thousSmnBlueHorrorHSE: {
    displayName: 'Blue Horror',
    portrait: '/images/game-assets/npcs/thous_horror.png'
  },
  thousSmnDaemonPrince: {
    displayName: "Z'Kar",
    portrait: '/images/game-assets/summons/thous_daemon_prince.png'
  },
  thousSmnPinkHorror: {
    displayName: 'Pink Horror',
    portrait: '/images/game-assets/npcs/thous_horror.png'
  },
  thousSmnPinkHorrorHSE: {
    displayName: 'Pink Horror',
    portrait: '/images/game-assets/npcs/thous_horror.png'
  },
  thousSmnRubricMarine: {
    displayName: 'Rubric Marine',
    portrait: '/images/game-assets/npcs/thous_rubric.png'
  },
  thousSmnScreamer: {
    displayName: 'Screamer',
    portrait: '/images/game-assets/npcs/thous_screamer.png'
  },
  thousSmnScreamerHSE: {
    displayName: 'Screamer',
    portrait: '/images/game-assets/npcs/thous_screamer.png'
  },
  thousSorcerer: {
    displayName: 'Thaumachus',
    portrait: null,
    heroRef: 'thaumachus'
  },
  thousTerminator: {
    displayName: 'Toth',
    portrait: null,
    heroRef: 'toth'
  },
  thousTzaangor: {
    displayName: 'Yazaghor',
    portrait: null,
    heroRef: 'yazaghor'
  },
  tyranBiovore: {
    displayName: 'Biovore',
    portrait: null,
    heroRef: 'biovore'
  },
  tyranDeathleaper: {
    displayName: 'Deathleaper',
    portrait: null,
    heroRef: 'deathleaper'
  },
  tyranNeurothrope: {
    displayName: 'Neurothrope',
    portrait: null,
    heroRef: 'neurothrope'
  },
  tyranNpc1Hormagaunt: {
    displayName: 'Hormagaunt',
    portrait: '/images/game-assets/npcs/tyran_hormagaunt.png',
    heroRef: 'tyranNpc1Hormagaunt'
  },
  tyranNpc2RipperSwarm: {
    displayName: 'Ripper Swarm',
    portrait: '/images/game-assets/npcs/tyran_ripper.png',
    heroRef: 'tyranNpc2RipperSwarm'
  },
  tyranNpc3Termagant: {
    displayName: 'Termagant',
    portrait: '/images/game-assets/npcs/tyran_termagant.png',
    heroRef: 'tyranNpc3Termagant'
  },
  tyranNpc4Warrior: {
    displayName: 'Tyranid Warrior',
    portrait: '/images/game-assets/npcs/tyran_warrior.png',
    heroRef: 'tyranNpc4Warrior'
  },
  tyranNpc5Barbgaunt: {
    displayName: 'Barbgaunt',
    portrait: '/images/game-assets/npcs/tyran_barbgaunt.png',
    heroRef: 'tyranNpc5Barbgaunt'
  },
  tyranParasite: {
    displayName: 'Parasite of Mortrex',
    portrait: null,
    heroRef: 'parasite-of-mortrex'
  },
  tyranSmnBarbgaunt: {
    displayName: 'Barbgaunt',
    portrait: '/images/game-assets/npcs/tyran_barbgaunt.png'
  },
  tyranSmnHormagaunt: {
    displayName: 'Hormagaunt',
    portrait: '/images/game-assets/npcs/tyran_hormagaunt.png'
  },
  tyranSmnRipperSwarm: {
    displayName: 'Ripper Swarm',
    portrait: '/images/game-assets/npcs/tyran_ripper.png'
  },
  tyranSmnSporeMine: {
    displayName: 'Spore Mine',
    portrait: '/images/game-assets/summons/tyran_spore_mine.png'
  },
  tyranSmnTermagant: {
    displayName: 'Termagant',
    portrait: '/images/game-assets/npcs/tyran_termagant.png'
  },
  tyranSmnWarrior: {
    displayName: 'Tyranid Warrior',
    portrait: '/images/game-assets/npcs/tyran_warrior.png'
  },
  tyranTyrantGuard: {
    displayName: 'Tyrant Guard',
    portrait: null,
    heroRef: 'tyrant-guard'
  },
  tyranWingedPrime: {
    displayName: 'Winged Prime',
    portrait: null,
    heroRef: 'winged-prime'
  },
  ultraApothecary: {
    displayName: 'Incisus',
    portrait: null,
    heroRef: 'incisus'
  },
  ultraCalgar: {
    displayName: 'Calgar',
    portrait: null,
    heroRef: 'marneus-calgar'
  },
  ultraDreadnought: {
    displayName: 'Galatian',
    portrait: null,
    heroRef: 'galatian'
  },
  ultraEliminatorSgt: {
    displayName: 'Certus',
    portrait: null,
    heroRef: 'certus'
  },
  ultraInceptorSgt: {
    displayName: 'Bellator',
    portrait: null,
    heroRef: 'bellator'
  },
  ultraSmnDreadnought: {
    displayName: 'Galatian',
    portrait: '/images/game-assets/summons/ultra_dreadnought.png'
  },
  ultraSmnEliminator: {
    displayName: 'Eliminator',
    portrait: '/images/game-assets/summons/ultra_eliminator.png'
  },
  ultraSmnHeavyIntercessor: {
    displayName: 'Heavy Intercessor',
    portrait: '/images/game-assets/summons/ultra_heavy_intercessor.png'
  },
  ultraSmnInceptor: {
    displayName: 'Inceptor',
    portrait: '/images/game-assets/summons/ultra_inceptor.png'
  },
  ultraTigurius: {
    displayName: 'Tigurius',
    portrait: null,
    heroRef: 'varro-tigurius'
  },
  ultraTitus: {
    displayName: 'Titus',
    portrait: null,
    heroRef: 'titus'
  },
  votanBeserk: {
    displayName: 'Havyr',
    portrait: null,
    heroRef: 'havyr'
  },
  votanChampion: {
    displayName: 'Kimm',
    portrait: null,
    heroRef: 'kimm'
  },
  votanIronmaster: {
    displayName: 'Vynn',
    portrait: null,
    heroRef: 'vynn'
  },
  votanMemnyr: {
    displayName: 'Ammuk',
    portrait: null,
    heroRef: 'ammuk'
  },
  votanSmnEcog: {
    displayName: 'E-COG',
    portrait: '/images/game-assets/summons/votan_ecog.png'
  },
  votanSmnSteeljack: {
    displayName: 'Ironkin Steeljack',
    portrait: '/images/game-assets/summons/votan_steeljack.png'
  },
  votanUthar: {
    displayName: 'Uthar',
    portrait: null,
    heroRef: 'uthar'
  },
  'winged-prime': {
    displayName: 'Winged Tyranid Prime',
    portrait: null,
    heroRef: 'winged-prime'
  },
  worldEightbound: {
    displayName: 'Azkor',
    portrait: null,
    heroRef: 'azkor'
  },
  worldExecutions: {
    displayName: 'Tarvakh',
    portrait: null,
    heroRef: 'tarvakh'
  },
  worldJakhal: {
    displayName: 'Macer',
    portrait: null,
    heroRef: 'macer'
  },
  worldKharn: {
    displayName: 'Kharn',
    portrait: null,
    heroRef: 'kharn'
  },
  worldTerminator: {
    displayName: 'Wrask',
    portrait: null,
    heroRef: 'wrask'
  }
} as const satisfies Record<string, GeneratedUnitPresentation>

export const generatedDamageProfileIcons = {
  acid: '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Acid.png',
  bio: '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Bio.png',
  blast:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Blast.png',
  bolter:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Bolter.png',
  chain:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Chain.png',
  directdamage:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_DirectDamage.png',
  energy:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Energy.png',
  eviscerate:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Eviscerate.png',
  flame:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Flame.png',
  gauss:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Gauss.png',
  heavyround:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_HeavyRound.png',
  las: '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Las.png',
  melta:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Melta.png',
  particle:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Particle.png',
  physical:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Physical.png',
  piercing:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Piercing.png',
  plasma:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Plasma.png',
  power:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Power.png',
  projectile:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Projectile.png',
  psychic:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Psychic.png',
  pulse:
    '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Pulse.png',
  toxic: '/images/game-assets/damage-profiles/ui_icon_damage_profile2_Toxic.png'
} as const satisfies Record<string, string>

export const generatedAttackProfileStatIcons = {
  melee: '/images/game-assets/stats/ui_icon_stat_melee_01.png',
  ranged: '/images/game-assets/stats/ui_icon_stat_rangedattack_01.png'
} as const satisfies Record<string, string>
