import path from 'node:path'

const DEFAULT_GAME_DATA_ROOT = path.join(process.cwd(), 'data', 'game-data')

export const GAME_DATA_ROOT =
  process.env.TACTICUS_GAME_FILES_PATH ?? DEFAULT_GAME_DATA_ROOT
