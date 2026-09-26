# Tau Riptide - Technical Reference

## Quick Reference

| Attribute      | Value                                       |
| -------------- | ------------------------------------------- |
| Banned Faction | Tau                                         |
| Boss Boards    | GB_Riptide_01, GB_Riptide_02, GB_Riptide_03 |
| Movement       | 4 (Flying, Mechanical)                      |
| Key Feature    | Long fire lanes, raised perches, drone pads |

## Abilities

| Ability     | Trigger Condition                                    |
| ----------- | ---------------------------------------------------- |
| Nova Charge | Clustering; scales rapidly with thresholds           |
| Target Lock | Passive marking; enables guaranteed follow-up crits  |
| Nova Shield | Defensive bubble; extends to adjacent drones         |
| Nova Boost  | Mobility repositioning; sets up indirect fire angles |

## Nova System

The Riptide cycles through three Nova abilities:

1. **Nova Boost** - Mobility/repositioning
2. **Nova Shield** - Defense/drone protection
3. **Nova Charge** - Devastating AoE damage

All three are in `_abilitiesToRandomize`, but cooldowns create patterns.

## Cooldowns

| Ability     | Cooldown   |
| ----------- | ---------- |
| Nova Boost  | ~1-2 turns |
| Nova Shield | ~2 turns   |
| Nova Charge | ~2 turns   |

## AI Ability Weights

| Ability            | Weight | Conditions                           |
| ------------------ | ------ | ------------------------------------ |
| Heavy Burst Cannon | 4.0    | MultiTracker enables multi-target    |
| Ion Accelerator    | 3.5    | Single target devastation            |
| Nova Charge        | 3.0    | AoE; weight increases when clustered |
| Repositioning Jump | 2.0    | Sets up IndirectFire angles          |

## Drone Mechanics

- **Savior Protocols**: Shield Drones intercept hits meant for Riptide
- **Nova Shield extension**: Adjacent drones get bubble protection
- **Continuous spawning**: Until reduction threshold, drones keep coming

## Prime: Tau Marksman

| Attribute       | Value                                          |
| --------------- | ---------------------------------------------- |
| Role            | Sniper drones, overwatch support               |
| Weakness        | CloseCombatWeakness, Movement 2                |
| Modifier Impact | Thresholds apply Nova Charge/Target Lock buffs |

## Prime: Crisis Pilot

| Attribute       | Value                               |
| --------------- | ----------------------------------- |
| Role            | Ion damage, additional drone spawns |
| Weakness        | CloseCombatWeakness                 |
| Modifier Impact | Same threshold mechanics            |

## Season Note

Riptide appears **only in Season 2** (special event rotation).

## Add Threat Assessment

| Unit         | Danger   | Notes                            |
| ------------ | -------- | -------------------------------- |
| Shield Drone | **HIGH** | SaviorProtocols redirects damage |
| Sniper Drone | **HIGH** | Marksman summon, high damage     |
| Stealth Suit | Medium   | Camouflage + Infiltrate flanks   |
| Fire Warrior | Medium   | Overwatch + SuppressiveFire      |
