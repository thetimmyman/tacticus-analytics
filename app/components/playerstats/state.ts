import type {
  PlayerStatsState,
  PlayerStatsAction,
  PlayerStatsSelection
} from './types'

export const createInitialState = (
  selection: PlayerStatsSelection
): PlayerStatsState => ({
  status: 'idle',
  selection,
  searchTerm: selection.player,
  availablePlayers: [],
  playerGuildMap: {},
  context: null,
  stats: null,
  tokens: null,
  supabaseError: null,
  errorMessage: null,
  playerMapping: null,
  rankingsVersion: 0,
  lastUpdatedKey: ''
})

export const playerStatsReducer = (
  state: PlayerStatsState,
  action: PlayerStatsAction
): PlayerStatsState => {
  switch (action.type) {
    case 'SET_SEARCH_TERM':
      return { ...state, searchTerm: action.payload }
    case 'SET_AVAILABLE_PLAYERS':
      return {
        ...state,
        availablePlayers: action.payload.players,
        playerGuildMap: action.payload.guildMap
      }
    case 'SELECT_PLAYER':
      return {
        ...state,
        selection: {
          ...state.selection,
          player: action.payload.player,
          guild: state.selection.guild
        },
        searchTerm: action.payload.player,
        context: null,
        stats: null,
        tokens: null,
        supabaseError: null,
        errorMessage: null,
        playerMapping: null,
        rankingsVersion: 0,
        lastUpdatedKey: ''
      }
    case 'SET_CONTEXT':
      return {
        ...state,
        context: action.payload,
        selection: { ...state.selection, guild: action.payload.resolvedGuild }
      }
    case 'SET_STATUS':
      return { ...state, status: action.payload }
    case 'SET_STATS':
      return {
        ...state,
        stats: action.payload.stats,
        lastUpdatedKey: action.payload.key,
        status: action.payload.stats ? 'success' : state.status
      }
    case 'MERGE_STATS':
      return {
        ...state,
        stats: state.stats
          ? { ...state.stats, ...action.payload.stats }
          : action.payload.stats,
        lastUpdatedKey: action.payload.key,
        status: 'success'
      }
    case 'SET_TOKENS':
      return { ...state, tokens: action.payload }
    case 'SET_SUPABASE_ERROR':
      return { ...state, supabaseError: action.payload }
    case 'SET_ERROR_MESSAGE':
      return { ...state, errorMessage: action.payload }
    case 'SET_MAPPING':
      return { ...state, playerMapping: action.payload }
    case 'INCREMENT_RANKINGS':
      return { ...state, rankingsVersion: state.rankingsVersion + 1 }
    case 'RESET_FOR_SEARCH':
      return {
        ...state,
        selection: { ...state.selection, player: action.payload.player },
        context: null,
        stats: null,
        tokens: null,
        supabaseError: null,
        errorMessage: null,
        playerMapping: null,
        rankingsVersion: 0,
        lastUpdatedKey: '',
        status: 'idle'
      }
    case 'RESET_FOR_PLAYER':
      return {
        ...state,
        selection: { ...state.selection, player: action.payload.player },
        context: null,
        stats: null,
        tokens: null,
        supabaseError: null,
        errorMessage: null,
        playerMapping: null,
        rankingsVersion: 0,
        lastUpdatedKey: ''
      }
    case 'SET_SELECTION':
      return {
        ...state,
        selection: {
          ...state.selection,
          guild: action.payload.guild ?? state.selection.guild,
          season: action.payload.season ?? state.selection.season
        }
      }
    default:
      return state
  }
}

export const buildPlayerKey = (player: string, guild: string, season: string) =>
  `${player?.trim().toLowerCase() || ''}::${guild?.trim().toLowerCase() || ''}::${season || ''}`
