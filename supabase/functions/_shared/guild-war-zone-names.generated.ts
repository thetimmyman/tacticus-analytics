// GENERATED FILE - DO NOT HAND-EDIT.
//
// Emitted by scripts/datamine/build-guild-war-zone-names.mjs from the game's
// own shipped localization, in the SAME run that writes the app-side table at
// config/guild-war-zone-names.json. Edge functions run on Deno and nothing
// under supabase/functions/ may import from app/, so the app and edge sync
// twins can only stay in lockstep by both being derived here. They were
// hand-maintained before and drifted (the app wrote "Vox-Station" while this
// side wrote the raw "ComsStation").
//
// Regenerate:  node scripts/datamine/build-guild-war-zone-names.mjs
// CI staleness: node scripts/datamine/build-guild-war-zone-names.mjs --check
// Lockstep test: app/lib/war/war-naming.test.ts
//
// Source: vendored game localization snapshot
// Game version: 1.41.101 (build 2498)

/**
 * Zone type id -> canonical display name. Byte-identical to
 * config/guild-war-zone-names.json `zones[<id>].name`.
 */
export const ZONE_DISPLAY_NAMES: Record<string, string> = {
  AntiAirBattery: 'Anti-Air Battery',
  AntiAirBattery1: 'Anti-Air Battery 1',
  AntiAirBattery2: 'Anti-Air Battery 2',
  Armoury: 'Armoury',
  ArtilleryPosition1: 'Artillery Position 1',
  ArtilleryPosition2: 'Artillery Position 2',
  Bunker1: 'Fortified Position 1',
  Bunker2: 'Fortified Position 2',
  ComsStation: 'Vox-Station',
  Garrison1: 'Troop Garrison 1',
  Garrison2: 'Troop Garrison 2',
  HQ: 'Headquarters',
  LandingPad: 'Landing Pad',
  LandingPad1: 'Landing Pad 1',
  LandingPad2: 'Landing Pad 2',
  MedicaeStation1: 'Medicae Station 1',
  MedicaeStation2: 'Medicae Station 2',
  SupplyDepot: 'Supply Depot',
  Trenches1: 'Left Frontline',
  Trenches2: 'Mid Frontline',
  Trenches3: 'Right Frontline',
  WarpRift: 'Warp Rift',
  unknown: 'Unclear Signal'
}
