import { mergeReusableRoles } from '@/app/lib/boss-ops/roles'
import { isSkipUnion } from '@/app/lib/boss-ops/skip-union'
import type {
  SeasonalBossCardData,
  SeasonalBossHubData,
  SeasonalEncounterData,
  SeasonalHubExtraLink,
  SeasonalHubReplayLinkMode,
  SeasonalHubRoleEntry
} from '../../seasonal-hub-utils'
import {
  APP_LINK_ORIGIN,
  MAX_CUSTOM_LINKS,
  type CustomLinkDraft,
  type EncounterLinkTargets,
  type EncounterMessageState,
  type MessageIncludeOption,
  type ReusableHeraldRole
} from './types'

export const loadSeasonalHubSeason = async (
  season: string
): Promise<SeasonalBossHubData> => {
  const response = await fetch(
    `/api/playbooks/seasonal-hub?season=${encodeURIComponent(season)}`
  )
  const payload = await response.json().catch(() => null)
  const hub = payload?.hub as SeasonalBossHubData | undefined
  if (
    !response.ok ||
    !hub ||
    String(hub.seasonNumber) !== season ||
    !Array.isArray(hub.groups)
  ) {
    throw new Error('Season workspace unavailable')
  }
  return hub
}

export const safeDomId = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]/g, '-')

export const encounterSectionId = (cardKey: string, encounterKey?: string) =>
  [
    'seasonal-encounter',
    safeDomId(cardKey),
    encounterKey ? safeDomId(encounterKey) : null
  ]
    .filter(Boolean)
    .join('-')

// Not @tacticus/app-core's formatDamage: nullable and M/K-suffixed.
export const formatDamage = (damage: number | null | undefined) => {
  if (damage === null || damage === undefined) return null
  if (damage >= 1_000_000) {
    const value = damage / 1_000_000
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}M`
  }
  if (damage >= 1_000) {
    const value = damage / 1_000
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}K`
  }
  return String(damage)
}

// Skip-union rule lives in @/app/lib/boss-ops/skip-union; mains cannot be skipped.
export const isEncounterSkipped = (encounter: SeasonalEncounterData): boolean =>
  encounter.encounterIndex !== 0 &&
  isSkipUnion(encounter.targetToken?.skip, encounter.behaviour === 'skip')

export const targetLabel = (encounter: SeasonalEncounterData) => {
  if (isEncounterSkipped(encounter)) return 'Skipped'
  if (encounter.targetToken?.targetTokens) {
    return `${encounter.targetToken.targetTokens} tokens`
  }
  return 'Unset'
}

// Preview merged prime notes only; never write merged output back into the note columns.

const absoluteAppUrl = (href: string) => {
  if (/^https?:\/\//i.test(href)) return href
  return `${APP_LINK_ORIGIN}${href.startsWith('/') ? href : `/${href}`}`
}

export const linkTargetsFor = (
  card: SeasonalBossCardData,
  encounter: SeasonalEncounterData
): EncounterLinkTargets => ({
  playbook: {
    label: 'Boss Playbook',
    url: absoluteAppUrl(card.playbookHref)
  },
  wiki: encounter.wikiUrl
    ? { label: 'Tacticus Wiki', url: encounter.wikiUrl }
    : null,
  tacticusTable: encounter.tacticusTableUrl
    ? { label: 'Tacticus Table', url: encounter.tacticusTableUrl }
    : null
})

const linkMatches = (
  entry: SeasonalHubExtraLink,
  target: SeasonalHubExtraLink | null
) => {
  if (!target) return false
  return (
    entry.url.trim() === target.url ||
    entry.label.trim().toLowerCase() === target.label.toLowerCase()
  )
}

const isGeneratedLink = (
  entry: SeasonalHubExtraLink,
  targets: EncounterLinkTargets
) =>
  linkMatches(entry, targets.playbook) ||
  linkMatches(entry, targets.wiki) ||
  linkMatches(entry, targets.tacticusTable)

// Any stored link other than the three generated ones is a custom row.
const customLinksFrom = (
  links: SeasonalHubExtraLink[],
  targets: EncounterLinkTargets
): CustomLinkDraft[] =>
  // MAX_CUSTOM_LINKS gates only the Add button, so saves never truncate stored rows.
  links
    .filter((entry) => !isGeneratedLink(entry, targets))
    .map((entry, index) => ({
      clientKey: `custom-link-${index}`,
      label: entry.label,
      url: entry.url
    }))

let customLinkKeySeq = 0

export const newCustomLink = (): CustomLinkDraft => ({
  clientKey: `custom-link-new-${(customLinkKeySeq += 1)}`,
  label: '',
  url: ''
})

export const addCustomLink = (
  settings: EncounterMessageState
): EncounterMessageState => {
  if (settings.customLinks.length >= MAX_CUSTOM_LINKS) return settings
  return {
    ...settings,
    customLinks: [...settings.customLinks, newCustomLink()]
  }
}

export const updateCustomLink = (
  settings: EncounterMessageState,
  clientKey: string,
  patch: Partial<Pick<CustomLinkDraft, 'label' | 'url'>>
): EncounterMessageState => ({
  ...settings,
  customLinks: settings.customLinks.map((entry) =>
    entry.clientKey === clientKey ? { ...entry, ...patch } : entry
  )
})

export const removeCustomLink = (
  settings: EncounterMessageState,
  clientKey: string
): EncounterMessageState => {
  const customLinks = settings.customLinks.filter(
    (entry) => entry.clientKey !== clientKey
  )
  return {
    ...settings,
    customLinks,
    include:
      customLinks.length === 0
        ? settings.include.filter((value) => value !== 'customLink')
        : settings.include
  }
}

const linkMatchesFrom = (
  links: SeasonalHubExtraLink[],
  target: SeasonalHubExtraLink | null
) => links.some((entry) => linkMatches(entry, target))

export const messageStateFromEncounter = (
  card: SeasonalBossCardData,
  encounter: SeasonalEncounterData,
  note: string,
  _guildReplayLinkMode: Exclude<SeasonalHubReplayLinkMode, 'inherit'>
): EncounterMessageState => {
  const targets = linkTargetsFor(card, encounter)
  const include: MessageIncludeOption[] = []
  if (note.trim().length > 0) include.push('narrative')
  if (linkMatchesFrom(encounter.extraLinks, targets.playbook))
    include.push('playbook')
  if (linkMatchesFrom(encounter.extraLinks, targets.wiki)) include.push('wiki')
  if (linkMatchesFrom(encounter.extraLinks, targets.tacticusTable)) {
    include.push('tacticusTable')
  }
  const customLinks = customLinksFrom(encounter.extraLinks, targets)
  if (customLinks.length > 0) include.push('customLink')
  return {
    include,
    replayLinkMode: 'off',
    replayAutoCount: 0,
    customLinks,
    customMessageUrl: encounter.customMessageUrl
  }
}

const isValidHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const extraLinksForMessage = (
  settings: EncounterMessageState,
  targets: EncounterLinkTargets
): SeasonalHubExtraLink[] => {
  const links: SeasonalHubExtraLink[] = []
  if (settings.include.includes('playbook')) links.push(targets.playbook)
  if (settings.include.includes('wiki') && targets.wiki)
    links.push(targets.wiki)
  if (settings.include.includes('tacticusTable') && targets.tacticusTable) {
    links.push(targets.tacticusTable)
  }
  if (settings.include.includes('customLink')) {
    for (const entry of settings.customLinks) {
      const url = entry.url.trim()
      if (!isValidHttpUrl(url)) continue
      links.push({ label: entry.label.trim() || 'Custom Link', url })
    }
  }
  return links
}

export const toggleMessageOption = (
  settings: EncounterMessageState,
  option: MessageIncludeOption
): EncounterMessageState => {
  const active = settings.include.includes(option)
  const include: MessageIncludeOption[] = active
    ? settings.include.filter((value) => value !== option)
    : [...settings.include, option]
  if (option === 'customLink' && !active && settings.customLinks.length === 0) {
    // Enabling with nothing stored adds an empty row to type into.
    return { ...settings, include, customLinks: [newCustomLink()] }
  }
  return { ...settings, include }
}

export const syncNarrativeInclude = (
  settings: EncounterMessageState,
  note: string
): EncounterMessageState => {
  const hasNote = note.trim().length > 0
  const hasNarrative = settings.include.includes('narrative')
  if (hasNote === hasNarrative) return settings
  return {
    ...settings,
    include: hasNote
      ? [...settings.include, 'narrative']
      : settings.include.filter((value) => value !== 'narrative')
  }
}

export const roleEntriesFromEncounter = (
  encounter: SeasonalEncounterData
): SeasonalHubRoleEntry[] =>
  encounter.roleIds.map((id) => ({
    id,
    label: encounter.roleLabels[id] ?? '',
    clientKey: `role-${id}`
  }))

export const reusableRolesFromHubData = (
  data: SeasonalBossHubData | null
): ReusableHeraldRole[] => {
  if (!data) return []
  const allSeasonData = [
    data,
    ...Object.values(data.seasonsByNumber ?? {})
  ] as Array<Pick<SeasonalBossHubData, 'groups'>>
  const roles: SeasonalHubRoleEntry[] = []
  for (const season of allSeasonData) {
    for (const group of season.groups) {
      for (const card of group.cards) {
        roles.push(...roleEntriesFromEncounter(card.mainEncounter))
        for (const encounter of card.sideEncounters) {
          roles.push(...roleEntriesFromEncounter(encounter))
        }
      }
    }
  }
  return mergeReusableRoles([], roles)
}
