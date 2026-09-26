// Unknown names pass through; callers flag them rather than error.

import { normalizeIdentifier } from '@/app/lib/utils/normalize'

const normalizeNicknameKey = normalizeIdentifier

// Identity entries are deliberate: membership is how ingest tells known names from ones to flag.
const HERO_NICKNAME_TO_DISPLAY_NAME: Record<string, string> = {
  abaddon: 'Abaddon',
  abrax: 'Abraxas',
  actus: 'Actus',
  aesoth: 'Aesoth',
  ahri: 'Ahriman',
  aleph: 'Aleph-null',
  ammuk: 'Ammuk',
  archi: 'Archimatos',
  asmo: 'Asmodai',
  atla: 'Atlacoya',
  aunshi: "Aun'shi",
  baldr: 'Baldr',
  boss: 'Boss Gulgortz',
  dante: 'Dante',
  darkstrider: 'Darkstrider',
  eldy: 'Eldryon',
  eldry: 'Eldryon',
  calgar: 'Marneus Calgar',
  farsight: 'Farsight',
  forcas: 'Forcas',
  helb: 'High Marshal Helbrecht',
  helbrecht: 'High Marshal Helbrecht',
  kari: 'Kariyan',
  kharn: 'Kharn',
  lav: 'Laviscus',
  lavi: 'Laviscus',
  // Upstream types `Lhykis`; the canonical spelling has the second h.
  lhykis: 'Lhykhis',
  lhykhis: 'Lhykhis',
  meph: 'Mephiston',
  neuro: 'Neurothrope',
  nico: 'Nicodemus',
  rag: 'Ragnar',
  rev: "Re'Vas",
  revas: "Re'Vas",
  rho: 'Exitor-Rho-1.15/x',
  rosie: 'Roswitha',
  sho: "Sho'Syl",
  shosyl: "Sho'Syl",
  snot: 'Snotflogga',
  tan: "Tan Gi'da",
  tangida: "Tan Gi'da",
  tarvakh: 'Tarvakh',
  thaum: 'Thaumachus',
  traj: 'Trajann',
  vit: 'Vitruvius',
  winged: 'Winged Prime',
  xybia: 'Xybia',
  yaz: 'Yazaghor'
}

const MOW_NICKNAME_TO_DISPLAY_NAME: Record<string, string> = {
  ff: 'Forgefiend',
  forgefiend: 'Forgefiend',
  pbc: 'Plagueburst Crawler',
  plagueburstcrawler: 'Plagueburst Crawler',
  exo: 'Exorcist',
  zkar: "Z'Kar",
  galatian: 'Galatian',
  biovore: 'Biovore',
  reanimator: 'Reanimator'
}

export function resolveHeroNickname(name: string): string {
  const canonical = HERO_NICKNAME_TO_DISPLAY_NAME[normalizeNicknameKey(name)]
  return canonical ?? name.trim()
}

export function resolveMachineOfWarNickname(name: string): string {
  const canonical = MOW_NICKNAME_TO_DISPLAY_NAME[normalizeNicknameKey(name)]
  return canonical ?? name.trim()
}

export function isKnownHeroNickname(name: string): boolean {
  return normalizeNicknameKey(name) in HERO_NICKNAME_TO_DISPLAY_NAME
}

export function isKnownMachineOfWarNickname(name: string): boolean {
  return normalizeNicknameKey(name) in MOW_NICKNAME_TO_DISPLAY_NAME
}
