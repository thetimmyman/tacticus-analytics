export interface ProfileWithGuildConfig {
  guild_code: string | null
  guild_config:
    | {
        cluster_code?: string | null
        [key: string]: unknown
      }
    | Array<{
        cluster_code?: string | null
        [key: string]: unknown
      }>
    | null
  [key: string]: unknown
}

export interface PlayerDataWithCluster {
  cluster_code: string
  cluster_id: string
  [key: string]: unknown
}

export interface AuthDataWithCluster {
  cluster_code: string
  [key: string]: unknown
}
