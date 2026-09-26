import type { BossEasterEggConfig } from './boss-easter-eggs/types'
import { magnusConfig, mortarionConfig } from './boss-easter-eggs/chaos-configs'
import { dornConfig, cawlConfig } from './boss-easter-eggs/imperial-configs'
import {
  screamerKillerConfig,
  hiveTyrantConfig,
  tervigonConfig
} from './boss-easter-eggs/tyranid-configs'
import {
  riptideConfig,
  khaineConfig,
  szarekhConfig,
  ghazghkullConfig
} from './boss-easter-eggs/xenos-configs'

export type {
  BossIntervention,
  VisualEffectType,
  BossEasterEggConfig
} from './boss-easter-eggs/types'

export const defaultEasterEggConfig = cawlConfig

export const bossEasterEggConfigs: Record<string, BossEasterEggConfig> = {
  cawl: cawlConfig,
  'belisarius cawl': cawlConfig,
  archmagos: cawlConfig,
  'archmagos cawl': cawlConfig,

  magnus: magnusConfig,
  'magnus the red': magnusConfig,
  mortarion: mortarionConfig,
  'pale king': mortarionConfig,
  'death lord': mortarionConfig,
  'prince of decay': mortarionConfig,
  'rogal dorn': dornConfig,
  dorn: dornConfig,

  'screamer-killer': screamerKillerConfig,
  'screamer killer': screamerKillerConfig,
  screamerkiller: screamerKillerConfig,
  'hive tyrant': hiveTyrantConfig,
  tyrant: hiveTyrantConfig,
  tervigon: tervigonConfig,

  'avatar of khaine': khaineConfig,
  avatar: khaineConfig,
  khaine: khaineConfig,

  szarekh: szarekhConfig,
  'szarekh the silent king': szarekhConfig,
  'silent king': szarekhConfig,
  'the silent king': szarekhConfig,
  silentking: szarekhConfig,

  ghazghkull: ghazghkullConfig,
  'ghazghkull thraka': ghazghkullConfig,
  'mag uruk thraka': ghazghkullConfig,

  riptide: riptideConfig,
  'xv104 riptide': riptideConfig
}
