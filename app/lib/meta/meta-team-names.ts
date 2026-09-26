// Mirrors public.meta_teams rows; pickers, badge styling and Herald roles are typed against it.

export const META_TEAM_NAMES = [
  'Admech',
  'Battlesuits',
  'Custodes',
  'Double Howl',
  'Forcasmo',
  'Lavstodes',
  "Neuro / Z'Kar",
  'Orkz'
] as const

export type MetaTeamName = (typeof META_TEAM_NAMES)[number]

// Fallback label from get_meta_team()/categorize_team_composition(); not a
// meta_teams row but it appears in meta_atlas_data, so styling must handle it.
export const META_TEAM_FALLBACK = 'Other' as const
export type MetaTeamLabel = MetaTeamName | typeof META_TEAM_FALLBACK

// Replay-tag labels that are not meta archetypes (is_meta=false). Adding one needs
// a matching meta_teams row and a color in meta-team-styling.ts.
const META_BADGE_ONLY_NAMES = ['Abaddon', 'Helbrecht', 'Atlacoya'] as const

export type MetaBadgeOnlyName = (typeof META_BADGE_ONLY_NAMES)[number]
export const META_BADGE_NAMES = [
  ...META_TEAM_NAMES,
  ...META_BADGE_ONLY_NAMES
] as const
export type MetaBadgeName = MetaTeamName | MetaBadgeOnlyName
export type MetaBadgeLabel = MetaBadgeName | typeof META_TEAM_FALLBACK
