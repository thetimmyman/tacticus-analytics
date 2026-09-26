# Hive Tyrant (Gorgon) - Technical Reference

## Quick Reference

| Attribute      | Value                                    |
| -------------- | ---------------------------------------- |
| Banned Faction | Tyranids                                 |
| Boss Boards    | GB_03 (open center), GB_04 (double-lane) |
| Movement       | 4 + Flying                               |

## Abilities

| Ability                | Trigger Condition                 |
| ---------------------- | --------------------------------- |
| Stranglethorn Cannon   | 2+ targets within 5 tiles aligned |
| Catalyst               | Any synapse unit below 70% HP     |
| Call Ripper Swarms 3.0 | Board control; low thresholds     |
| Prehensile Pincer Tail | Passive melee follow-ups          |
| Adaptive Toxins        | Debuffs stack on hit targets      |

## Adaptive Toxins Mechanic

Gorgon applies stacking debuffs to targets hit during the encounter:

- Each subsequent hit on the same unit deals more damage
- Works with Catalyst to create sustain loops
- Forces tank rotation

## Cooldowns

| Ability                | Cooldown |
| ---------------------- | -------- |
| Stranglethorn Cannon   | ~1 turn  |
| Catalyst               | ~2 turns |
| Call Ripper Swarms 3.0 | ~2 turns |

## AI Ability Weights

| Ability           | Weight | Conditions                               |
| ----------------- | ------ | ---------------------------------------- |
| Toxic Lash        | 4.5    | Applies AdaptiveToxins (Gorgon enhanced) |
| Monstrous Rending | 3.5    | Melee with PrehensilePincerTail          |
| Venom Spray       | 3.0    | AoE poison application                   |
| Psychic Assault   | 2.5    | Ranged psychic damage                    |

## Map Notes

- **GB_03 (open center)**: Easier to maintain spread; fewer cover options
- **GB_04 (double-lane)**: Stranglethorn breaks cover; use multiple barricades

## Prime: Warrior (Gorgon)

| Attribute       | Value                                           |
| --------------- | ----------------------------------------------- |
| Role            | Synapse node; Catalyst target                   |
| Weakness        | ReinforcedHiveNode; may apply toxins on attacks |
| Modifier Impact | Thresholds apply to Gorgon                      |

## Add Threat Assessment

| Unit                  | Danger   | Notes                     |
| --------------------- | -------- | ------------------------- |
| Hormagaunt (Gorgon)   | **HIGH** | Melee + toxin application |
| Termagant (Gorgon)    | Medium   | May apply toxins at range |
| Ripper Swarm (Gorgon) | Low      | Swarm fodder              |

## Gorgon Strain Specialty

**Toxin focus**: AdaptiveToxins stack over time. Shorter fights favor you.
