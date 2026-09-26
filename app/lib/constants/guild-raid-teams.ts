/** unitId must match hero_mappings.unit_id. */

export interface RaidTeamHero {
  unitId: string
  displayName: string
  tier: 'core' | 'secondary' | 'tertiary'
}

export interface RaidTeamDefinition {
  id: string
  name: string
  heroes: RaidTeamHero[]
}

export const RAID_TEAMS: RaidTeamDefinition[] = [
  {
    id: 'admech',
    name: 'Admech',
    heroes: [
      {
        unitId: 'admecRuststalker',
        displayName: 'Exitor-Rho-1.15/x',
        tier: 'core'
      },
      { unitId: 'admecMarshall', displayName: "Tan Gi'da", tier: 'core' },
      { unitId: 'admecManipulus', displayName: 'Actus', tier: 'core' },
      { unitId: 'tyranBiovore', displayName: 'Biovore', tier: 'core' },
      { unitId: 'admecDominus', displayName: 'Vitruvius', tier: 'secondary' },
      { unitId: 'custoTrajann', displayName: 'Trajann', tier: 'secondary' },
      { unitId: 'tauMarksman', displayName: "Sho'Syl", tier: 'secondary' },
      {
        unitId: 'ultraDreadnought',
        displayName: 'Galatian',
        tier: 'secondary'
      },
      {
        unitId: 'astraPrimarisPsy',
        displayName: 'Astra Primaris Psy',
        tier: 'tertiary'
      },
      { unitId: 'orksWarboss', displayName: 'Boss Gulgortz', tier: 'tertiary' },
      {
        unitId: 'deathCrawler',
        displayName: 'Plagueburst Crawler',
        tier: 'tertiary'
      }
    ]
  },
  {
    id: 'battlesuits',
    name: 'Battlesuits',
    heroes: [
      { unitId: 'tauCrisis', displayName: "Re'Vas", tier: 'core' },
      { unitId: 'eldarLhykhis', displayName: 'Lhykhis', tier: 'core' },
      {
        unitId: 'tauDarkstrider',
        displayName: 'Tau Darkstrider',
        tier: 'core'
      },
      { unitId: 'tauFarsight', displayName: 'Farsight', tier: 'core' },
      { unitId: 'admecManipulus', displayName: 'Actus', tier: 'core' },
      {
        unitId: 'deathCrawler',
        displayName: 'Plagueburst Crawler',
        tier: 'core'
      },
      { unitId: 'necroReanimator', displayName: 'Reanimator', tier: 'core' },
      { unitId: 'eldarFarseer', displayName: 'Eldryon', tier: 'secondary' },
      {
        unitId: 'ultraCalgar',
        displayName: 'Marneus Calgar',
        tier: 'secondary'
      },
      { unitId: 'tyranBiovore', displayName: 'Biovore', tier: 'secondary' }
    ]
  },
  {
    id: 'double-howl',
    name: 'Double Howl',
    heroes: [
      { unitId: 'tauAunShi', displayName: "Aun'shi", tier: 'core' },
      { unitId: 'spaceBlackmane', displayName: 'Ragnar', tier: 'core' },
      { unitId: 'worldKharn', displayName: 'Kharn', tier: 'core' },
      { unitId: 'blackForgefiend', displayName: 'Forgefiend', tier: 'core' },
      { unitId: 'eldarFarseer', displayName: 'Eldryon', tier: 'secondary' },
      {
        unitId: 'ultraCalgar',
        displayName: 'Marneus Calgar',
        tier: 'secondary'
      },
      { unitId: 'tyranBiovore', displayName: 'Biovore', tier: 'secondary' },
      { unitId: 'bloodDante', displayName: 'Dante', tier: 'secondary' },
      { unitId: 'orksRuntherd', displayName: 'Snotflogga', tier: 'secondary' },
      {
        unitId: 'custoBladeChampion',
        displayName: 'Kariyan',
        tier: 'tertiary'
      },
      { unitId: 'eldarAutarch', displayName: 'Aethana', tier: 'tertiary' },
      { unitId: 'eldarMauganRa', displayName: 'Maugan Ra', tier: 'tertiary' },
      { unitId: 'ultraInceptorSgt', displayName: 'Bellator', tier: 'tertiary' },
      { unitId: 'bloodMephiston', displayName: 'Mephiston', tier: 'tertiary' }
    ]
  },
  {
    id: 'forcasmo',
    name: 'Forcasmo',
    heroes: [
      { unitId: 'darkaCompanion', displayName: 'Forcas', tier: 'core' },
      { unitId: 'darkaAsmodai', displayName: 'Asmodai', tier: 'core' },
      { unitId: 'spaceBlackmane', displayName: 'Ragnar', tier: 'core' },
      { unitId: 'tauAunShi', displayName: "Aun'shi", tier: 'core' },
      { unitId: 'tyranBiovore', displayName: 'Biovore', tier: 'core' },
      {
        unitId: 'templHelbrecht',
        displayName: 'High Marshal Helbrecht',
        tier: 'secondary'
      },
      {
        unitId: 'ultraCalgar',
        displayName: 'Marneus Calgar',
        tier: 'secondary'
      },
      {
        unitId: 'blackForgefiend',
        displayName: 'Forgefiend',
        tier: 'secondary'
      },
      {
        unitId: 'custoBladeChampion',
        displayName: 'Kariyan',
        tier: 'tertiary'
      },
      { unitId: 'worldKharn', displayName: 'Kharn', tier: 'tertiary' },
      { unitId: 'orksRuntherd', displayName: 'Snotflogga', tier: 'tertiary' }
    ]
  },
  {
    id: 'neuro-zkar',
    name: "Neuro / Z'Kar",
    heroes: [
      { unitId: 'tyranNeurothrope', displayName: 'Neurothrope', tier: 'core' },
      { unitId: 'thousInfernalMaster', displayName: 'Abraxas', tier: 'core' },
      { unitId: 'thousAhriman', displayName: 'Ahriman', tier: 'core' },
      { unitId: 'thousDaemonPrince', displayName: "Z'Kar", tier: 'core' },
      { unitId: 'blackAbaddon', displayName: 'Abaddon', tier: 'secondary' },
      {
        unitId: 'blackPossession',
        displayName: 'Archimatos',
        tier: 'secondary'
      },
      { unitId: 'eldarFarseer', displayName: 'Eldryon', tier: 'secondary' },
      { unitId: 'adeptCanoness', displayName: 'Roswitha', tier: 'secondary' },
      { unitId: 'thousTzaangor', displayName: 'Yazaghor', tier: 'secondary' },
      { unitId: 'custoAtlacoya', displayName: 'Atlacoya', tier: 'tertiary' },
      { unitId: 'thousSorcerer', displayName: 'Thaumachus', tier: 'tertiary' }
    ]
  },
  {
    id: 'lavstodes',
    name: 'Lavstodes',
    heroes: [
      { unitId: 'emperExultant', displayName: 'Laviscus', tier: 'core' },
      { unitId: 'custoBladeChampion', displayName: 'Kariyan', tier: 'core' },
      { unitId: 'custoTrajann', displayName: 'Trajann', tier: 'core' },
      { unitId: 'tyranBiovore', displayName: 'Biovore', tier: 'core' },
      {
        unitId: 'orksWarboss',
        displayName: 'Boss Gulgortz',
        tier: 'secondary'
      },
      { unitId: 'admecDominus', displayName: 'Vitruvius', tier: 'secondary' },
      {
        unitId: 'custoVexilusPraetor',
        displayName: 'Aesoth',
        tier: 'secondary'
      },
      {
        unitId: 'deathCrawler',
        displayName: 'Plagueburst Crawler',
        tier: 'secondary'
      },
      { unitId: 'blackAbaddon', displayName: 'Abaddon', tier: 'tertiary' },
      { unitId: 'bloodDante', displayName: 'Dante', tier: 'tertiary' },
      { unitId: 'custoAtlacoya', displayName: 'Atlacoya', tier: 'tertiary' },
      {
        unitId: 'templHelbrecht',
        displayName: 'High Marshal Helbrecht',
        tier: 'tertiary'
      },
      { unitId: 'worldKharn', displayName: 'Kharn', tier: 'tertiary' },
      { unitId: 'blackForgefiend', displayName: 'Forgefiend', tier: 'tertiary' }
    ]
  }
]
