export type TokenContext = 'guild' | 'cluster'

export interface SeasonTokenPlayer {
  player_id?: string | null
  display_name?: string | null
  tokens_possible?: number | null
  tokens_spent?: number | null
  ratio_spent?: number | null
}

export interface SeasonTokenStats {
  context: TokenContext
  guild_code: string
  cluster_code?: string | null
  season: number
  tokens_possible?: number | null
  tokens_spent?: number | null
  ratio_spent?: number | null
  players?: SeasonTokenPlayer[]
}
