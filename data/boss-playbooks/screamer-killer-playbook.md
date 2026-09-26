# Screamer-Killer - Technical Reference

## Quick Reference

| Attribute      | Value                                        |
| -------------- | -------------------------------------------- |
| Banned Faction | Tyranids                                     |
| Boss Boards    | GB_Screamer_01-04 (circular pits with ramps) |
| Movement       | 4 (with Suppressive Fire trait)              |

## Abilities

| Ability                        | Trigger Condition                          |
| ------------------------------ | ------------------------------------------ |
| Death Scream                   | 2+ targets in front arc; stuns/roots       |
| Living Battering Ram           | Clear lane to backliner; gap-closer        |
| Unparalleled Ferocity          | Self-buff + multi-hit combo; follows stuns |
| Adrenal Surge/Hyper Aggression | Passives that push toward melee            |

## Disable Mechanics

Screamer-Killer has **disable modifiers** that temporarily block abilities:

- `boss_debuff_DeathScream_disable`: Prevents Death Scream after use
- `boss_debuff_LivingBatteringRam_disable`: Prevents charge after use

## Cooldowns

| Ability               | Cooldown                               |
| --------------------- | -------------------------------------- |
| Living Battering Ram  | ~1 turn (can be disabled by modifier)  |
| Death Scream          | ~2 turns (can be disabled by modifier) |
| Unparalleled Ferocity | ~2 turns                               |

## AI Ability Weights

| Ability            | Weight | Conditions                             |
| ------------------ | ------ | -------------------------------------- |
| Scything Talons    | 4.5    | Primary melee, multi-hit               |
| Berserk Charge     | 4.0    | High damage charge (BlisteringAssault) |
| Bio-Plasmic Scream | 3.5    | Ranged AoE (SuppressiveFire)           |
| Rampage            | 3.0    | AoE melee when surrounded              |

## Encounter Frequency

Screamer-Killer appears **1 time per loop** with 2 Prime fights per loop - more than any other Tyranid boss.

## Prime: Neurothrope

| Attribute       | Value                                              |
| --------------- | -------------------------------------------------- |
| Role            | Synapse/heals for Screamer and adds                |
| Weakness        | CloseCombatWeakness, Movement 2, VulnerableToMelee |
| Modifier Impact | Standard threshold mechanics                       |

## Prime: Winged Prime

| Attribute       | Value                                                 |
| --------------- | ----------------------------------------------------- |
| Role            | Additional mobility threat                            |
| Weakness        | VulnerableToFlameAndBlast; FinalJustice death trigger |
| Modifier Impact | Standard threshold mechanics                          |

## Add Threat Assessment

| Unit            | Danger   | Notes                         |
| --------------- | -------- | ----------------------------- |
| Tyranid Warrior | **HIGH** | Synapse, ReinforcedHiveNode   |
| Barbgaunt       | Medium   | SuppressiveFire, HeavyWeapon  |
| Hormagaunt      | Medium   | AdrenalGlands, HungeringSwarm |
| Termagant       | Low      | HailOfLivingAmmunition        |
| Ripper Swarm    | Low      | Swarm fodder                  |
