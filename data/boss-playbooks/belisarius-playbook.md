# Belisarius Cawl - Technical Reference

## Quick Reference

| Attribute      | Value                                                |
| -------------- | ---------------------------------------------------- |
| Banned Faction | Adeptus Mechanicus                                   |
| Boss Boards    | GB_Belisarius_01, GB_Belisarius_02, GB_Belisarius_03 |
| Key Feature    | Conveyor lanes, long sight lines, archeotech chokes  |

## Abilities

| Ability                         | Trigger Condition                                      |
| ------------------------------- | ------------------------------------------------------ |
| Solar Atomizer                  | Players line up in lane; long cooldown but devastating |
| Arc Scourge                     | 2+ units within 3 tiles; chains through clusters       |
| Invocation of Machine Vengeance | Buff opener; enhances all subsequent attacks           |
| Shroud Psalm                    | Defensive mode; enables self-repair window             |
| Self Repair Mechanism           | Passive heal pulses at thresholds                      |

## Canticle Rotation

Cawl uses a **buff → damage → defense** cycle:

1. **Invocation** buffs self and escorts
2. **Arc Scourge / Solar Atomizer** deals damage
3. **Shroud Psalm** heals and grants stealth/block

## Cooldowns

| Ability                         | Cooldown   |
| ------------------------------- | ---------- |
| Invocation of Machine Vengeance | ~2 turns   |
| Arc Scourge                     | ~1 turn    |
| Solar Atomizer                  | ~2-3 turns |
| Shroud Psalm                    | ~2 turns   |

## AI Ability Weights

| Ability            | Weight | Conditions                   |
| ------------------ | ------ | ---------------------------- |
| Solar Atomiser     | 3.5    | High damage single target    |
| Arc Scourge        | 2.5    | Chain lightning multi-target |
| Mechadendrite Hive | 2.0    | Multiple small attacks       |
| Self-Repair        | 4.0    | When HP below threshold      |

## Prime: Marshall

| Attribute       | Value                                           |
| --------------- | ----------------------------------------------- |
| Role            | ControlEdict and RadZoneCorps auras buff Cawl   |
| Weakness        | High damage but no escape                       |
| Modifier Impact | Thresholds apply Invocation/block buffs to Cawl |

## Prime: Manipulus

| Attribute       | Value                                         |
| --------------- | --------------------------------------------- |
| Role            | GalvanicField and PriorityReclamation support |
| Weakness        | Flying but support-focused                    |
| Modifier Impact | Same threshold mechanics                      |

## Add Threat Assessment

| Unit          | Danger   | Notes                           |
| ------------- | -------- | ------------------------------- |
| Ruststalker   | **HIGH** | Infiltrate + Camouflage, 28K HP |
| Destroyer     | Medium   | Overwatch, HeavyGravCannon      |
| Electropriest | Medium   | VoltagheistField + ElectroShock |
| Techpriest    | Low      | Heals mechanical units          |
