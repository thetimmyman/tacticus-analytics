# Hive Tyrant (Kronos) - Technical Reference

## Quick Reference

| Attribute      | Value        |
| -------------- | ------------ |
| Banned Faction | Tyranids     |
| Boss Boards    | GB_03, GB_06 |
| Movement       | 4 + Flying   |

## Abilities

| Ability                | Trigger Condition                       |
| ---------------------- | --------------------------------------- |
| Stranglethorn Cannon   | 2+ targets aligned; suppresses groups   |
| Catalyst               | Synapse unit below 70% HP               |
| Call Ripper Swarms 2.0 | Board control loss; very low thresholds |
| Prehensile Pincer Tail | Passive; adds melee hits when adjacent  |
| Soul Hunger            | Targets psykers/healers with buffs      |

## Soul Hunger Targeting

Kronos prioritizes targets with active buffs:

- Units with heals/shields become Stranglethorn priority
- Psykers are especially vulnerable

## Cooldowns

| Ability                | Cooldown |
| ---------------------- | -------- |
| Stranglethorn Cannon   | ~1 turn  |
| Catalyst               | ~2 turns |
| Call Ripper Swarms 2.0 | ~2 turns |

## AI Ability Weights

| Ability           | Weight | Conditions                           |
| ----------------- | ------ | ------------------------------------ |
| Psychic Scream    | 4.5    | AoE psychic damage (Kronos enhanced) |
| Monstrous Rending | 3.5    | Melee with PrehensilePincerTail      |
| Warp Blast        | 3.0    | Single target psychic nuke           |
| Synapse Pulse     | 2.5    | Buff all Tyranid units               |

## Rotation Note

Kronos rotation is **shorter** than Gorgon/Leviathan (only 1 boss + 2 Prime fights per loop). Thresholds are designed for faster ramp-up.

## Prime: Warrior (Kronos)

| Attribute       | Value                                       |
| --------------- | ------------------------------------------- |
| Role            | Synapse node; secondary Catalyst target     |
| Weakness        | ReinforcedHiveNode makes it tanky           |
| Modifier Impact | Crossing thresholds applies buffs to Kronos |

## Add Threat Assessment

| Unit                  | Danger | Notes                         |
| --------------------- | ------ | ----------------------------- |
| Hormagaunt (Kronos)   | Medium | AdrenalGlands, HungeringSwarm |
| Termagant (Kronos)    | Low    | HailOfLivingAmmunition        |
| Ripper Swarm (Kronos) | Low    | Swarm fodder                  |

## Kronos Strain Specialty

**Anti-Psyker focus**: ShadowInTheWarp + SoulHunger counter enemy psychic units.
