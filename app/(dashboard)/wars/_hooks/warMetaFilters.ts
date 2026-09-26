export interface WarMetaFilters {
  seasons: number[]
  battlefieldLevels: number[]
}

export interface WarMetaSelection {
  season: number | null
  battlefieldLevel: number | null
}

export const EMPTY_WAR_META_FILTERS: WarMetaFilters = {
  seasons: [],
  battlefieldLevels: []
}

export function appendWarMetaSelection(
  params: URLSearchParams,
  selection: WarMetaSelection
) {
  if (selection.season !== null) {
    params.set('seasons', String(selection.season))
  }
  if (selection.battlefieldLevel !== null) {
    params.set('battlefield_levels', String(selection.battlefieldLevel))
  }
}
