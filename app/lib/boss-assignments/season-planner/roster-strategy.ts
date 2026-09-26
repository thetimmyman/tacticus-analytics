import 'server-only'

// Public barrel; TypeScript resolves this file over the ./roster-strategy/ directory.
export type {
  RosterStrategyPublicMember,
  RosterStrategyProjection,
  RosterStrategyPayload
} from './roster-strategy/types'
export { __testing, generateRosterStrategy } from './roster-strategy/generate'
