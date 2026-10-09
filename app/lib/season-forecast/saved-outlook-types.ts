import type { SeasonOutlookProjection } from './season-outlook-reduce'
import type { PlayerTokenPaceRow } from './season-token-economy'

/** As-of is the model instant, not the time at which raid data was imported. */
export interface SavedSeasonOutlook {
  projection: SeasonOutlookProjection
  players: PlayerTokenPaceRow[]
  model: { appliedDamage: number }
  saved: {
    status: 'ready'
    source: 'saved-season'
    season: string
    configId: string
    asOf: string
    timeZone: string
  }
}
