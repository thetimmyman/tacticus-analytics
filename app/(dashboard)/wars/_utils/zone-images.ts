// Vendored and served same-origin; refresh with scripts/datamine/download-local-sprites.sh.
const WAR_ZONE_IMAGE_BASE = '/images/war-zones'

const ZONE_TYPE_TO_FILENAME: Record<string, string> = {
  Trenches1: 'guild_wars_trenches_ground_01_tex.png',
  Trenches2: 'guild_wars_trenches_ground_01_tex.png',
  Trenches3: 'guild_wars_trenches_ground_01_tex.png',
  HQ: 'guild_wars_HQ_ground_01_tex.png',
  ArtilleryPosition1: 'guild_wars_artillery_battery_ground_01_tex.png',
  ArtilleryPosition2: 'guild_wars_artillery_battery_ground_01_tex.png',
  AntiAirBattery1: 'guild_wars_aabattery_ground_01_tex.png',
  Garrison1: 'guild_wars_garrison_ground_01.png',
  Garrison2: 'guild_wars_garrison_ground_01.png',
  Bunker1: 'guild_wars_bunker_ground_01_tex.png',
  Bunker2: 'guild_wars_bunker_ground_01_tex.png',
  Armoury: 'guild_wars_armory_01_ground_01_tex.png',
  SupplyDepot: 'guild_wars_supply_depot_ground_01_tex.png',
  MedicaeStation1: 'guild_wars_medicae_ground_01_tex.png',
  MedicaeStation2: 'guild_wars_medicae_ground_01_tex.png',
  LandingPad: 'guild_wars_landing_pad_ground_01_tex.png',
  ComsStation: 'guild_wars_radar_ground_01_tex.png',
  WarpRift: 'guild_wars_warprift_ground_01_tex.png'
}

export function getZoneImageUrl(
  zoneType: string | null | undefined
): string | null {
  if (!zoneType) return null
  const filename = ZONE_TYPE_TO_FILENAME[zoneType]
  if (!filename) return null
  return `${WAR_ZONE_IMAGE_BASE}/${filename}`
}
