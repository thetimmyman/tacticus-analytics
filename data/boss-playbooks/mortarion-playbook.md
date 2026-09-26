# Mortarion - Technical Reference

## Quick Reference

| Attribute      | Value                                             |
| -------------- | ------------------------------------------------- |
| Banned Faction | Death Guard                                       |
| Boss Boards    | GB_Mortarion_01, GB_Mortarion_02, GB_Mortarion_04 |
| Movement       | 4 tiles (can be reduced by debuff)                |

## Abilities

| Ability                 | Trigger Condition                              |
| ----------------------- | ---------------------------------------------- |
| Mortarion's Plague Wind | 3+ units in frontal fan; refreshes DoTs        |
| The Lantern             | Line-of-sight with 2+ colinear targets         |
| Reaping Scythe          | Adjacent enemies; enhanced by ArchContaminator |
| HostOfPlagues Summons   | Passive trigger at damage thresholds           |
| Hazard Zones            | Persistent; spreads contagion                  |

## Cooldowns

| Ability        | Cooldown                               |
| -------------- | -------------------------------------- |
| Reaping Scythe | ~1 turn                                |
| The Lantern    | ~2 turns                               |
| Plague Wind    | ~3 turns                               |
| Movement       | 4 tiles base; may be reduced by debuff |

## AI Ability Weights

| Ability              | Weight | Conditions                |
| -------------------- | ------ | ------------------------- |
| Plague Wind          | 4.0    | AoE poison, high priority |
| Silence (Scythe)     | 3.5    | Melee cleave              |
| Miasma of Pestilence | 3.0    | Defensive aura            |
| Lantern's Glow       | 2.5    | Ranged attack             |

## Prime: Rotbone (Healer)

| Attribute       | Value                                                                   |
| --------------- | ----------------------------------------------------------------------- |
| Role            | Pulses heals on Mortarion via TaintedNarthecium                         |
| Weakness        | Healer role, stays back                                                 |
| Modifier Impact | Crossing thresholds before kill applies armor/damage buffs to Mortarion |

## Prime: Blightbringer (Controller)

| Attribute       | Value                               |
| --------------- | ----------------------------------- |
| Role            | CursedPlagueBell slows player units |
| Weakness        | Slow but tanky                      |
| Modifier Impact | Same threshold mechanics as Rotbone |

## Add Threat Assessment

| Unit                  | Danger   | Notes                |
| --------------------- | -------- | -------------------- |
| Blightlord Terminator | **HIGH** | Tanky, deals DoT     |
| Plague Marine         | Medium   | Poison attacks       |
| Poxwalker             | Low      | Fodder, slows on hit |
