/** Main bosses only; prime lore names return null. */

export const DISPLAY_NAME_TO_PLAYBOOK_ID: Record<string, string> = {
  'Magnus the Red': 'magnus',
  Magnus: 'magnus',
  Mortarion: 'mortarion',
  Szarekh: 'silent-king',
  'Szarekh the Silent King': 'silent-king',
  'The Silent King': 'silent-king',
  'Silent King': 'silent-king',
  'Ghazghkull Thraka': 'ghazghkull',
  Ghazghkull: 'ghazghkull',
  'Avatar of Khaine': 'avatar-of-khaine',
  'Belisarius Cawl': 'belisarius',
  Belisarius: 'belisarius',
  'Tau Riptide': 'riptide',
  Riptide: 'riptide',
  'Rogal Dorn': 'rogal-dorn',
  'Screamer-Killer': 'screamer-killer',
  'Screamer Killer': 'screamer-killer',
  // Loki/EOT_GR_data use the bare 'Lion'.
  Lion: 'lion',
  "Lion El'Jonson": 'lion',
  'Hive Tyrant (Kronos)': 'hive-tyrant-kronos',
  'Hive Tyrant (Gorgon)': 'hive-tyrant-gorgon',
  'Hive Tyrant (Leviathan)': 'hive-tyrant-leviathan',
  'Hive Tyrant': 'hive-tyrant-leviathan',
  'Tervigon (Kronos)': 'tervigon-kronos',
  'Tervigon (Gorgon)': 'tervigon-gorgon',
  'Tervigon (Leviathan)': 'tervigon-leviathan',
  Tervigon: 'tervigon-leviathan'
}

export function getPlaybookId(displayName: string): string | null {
  const normalizedName = displayName.trim()
  // Every string includes '', so empty input would match the first key.
  if (!normalizedName) return null
  if (DISPLAY_NAME_TO_PLAYBOOK_ID[normalizedName]) {
    return DISPLAY_NAME_TO_PLAYBOOK_ID[normalizedName]
  }
  for (const [key, value] of Object.entries(DISPLAY_NAME_TO_PLAYBOOK_ID)) {
    if (
      normalizedName.toLowerCase().includes(key.toLowerCase()) ||
      key.toLowerCase().includes(normalizedName.toLowerCase())
    ) {
      return value
    }
  }
  return null
}
