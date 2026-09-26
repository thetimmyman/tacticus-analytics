import { BookOpen, ExternalLink, Globe2, Link2, Table2 } from 'lucide-react'
import type { ReusableRole } from '@/app/components/boss-ops'
import type { BossState } from '@/app/lib/boss-ops/encounter-ops-types'
import type {
  SeasonalHubExtraLink,
  SeasonalHubReplayLinkMode,
  SeasonalHubRoleEntry
} from '../../seasonal-hub-utils'

export type MessageIncludeOption =
  'narrative' | 'playbook' | 'wiki' | 'tacticusTable' | 'customLink'

// `clientKey` is a render-only identity so rows stay stable while edited.
export type CustomLinkDraft = {
  clientKey: string
  label: string
  url: string
}

// The embed renders `extraLinks.slice(0, 10)` and up to 3 are generated links, so 7 custom fit.
export const MAX_CUSTOM_LINKS = 7

export type EncounterMessageState = {
  include: MessageIncludeOption[]
  replayLinkMode: SeasonalHubReplayLinkMode
  replayAutoCount: number
  extraLinks?: SeasonalHubExtraLink[]
  customLinks: CustomLinkDraft[]
  customMessageUrl: string | null
}

export type HubBossState = BossState & {
  mainMessage: EncounterMessageState
  side1Message: EncounterMessageState | null
  side2Message: EncounterMessageState | null
  mainRoles: SeasonalHubRoleEntry[]
  side1Roles: SeasonalHubRoleEntry[]
  side2Roles: SeasonalHubRoleEntry[]
}

export type ReusableHeraldRole = ReusableRole

export type EncounterLinkTargets = {
  playbook: SeasonalHubExtraLink
  wiki: SeasonalHubExtraLink | null
  tacticusTable: SeasonalHubExtraLink | null
}

export const MESSAGE_INCLUDE_OPTIONS: Array<{
  value: MessageIncludeOption
  label: string
  Icon: typeof BookOpen
}> = [
  { value: 'narrative', label: 'Tactics narrative', Icon: BookOpen },
  { value: 'playbook', label: 'Playbook link', Icon: Link2 },
  { value: 'wiki', label: 'Wiki link', Icon: Globe2 },
  { value: 'tacticusTable', label: 'Tacticus Table', Icon: Table2 },
  { value: 'customLink', label: 'Custom links', Icon: ExternalLink }
]

export const APP_LINK_ORIGIN = 'https://tacticusanalytics.com'
