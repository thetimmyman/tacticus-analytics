export interface BossTier {
  name: string
  level: number
  health: number
  damage: number
  armor: number
}

export interface BossMap {
  id: string
  name: string
  previewImage?: string
  backgroundImage?: string
  imageUrl?: string | null
  terrain: string[]
}

export interface Boss {
  id: string
  name: string
  portrait: string
  traits: string[]
  size: { width: number; height: number }
  tiers: BossTier[]
  maps: BossMap[]
}
