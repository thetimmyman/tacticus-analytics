# Hive Tyrant (Leviathan) - Technical Reference

## Quick Reference

| Attribute      | Value               |
| -------------- | ------------------- |
| Banned Faction | Tyranids            |
| Boss Boards    | GB_02, GB_04, GB_05 |
| Movement       | 4 + Flying          |

## Abilities

| Ability                | Trigger Condition                       |
| ---------------------- | --------------------------------------- |
| Stranglethorn Cannon   | Clustered targets; roots/knockback      |
| Synaptic Imperative    | Passive; grants AP after powers         |
| Catalyst               | Any Tyranid ally below 80% HP           |
| Call Ripper Swarms 1.0 | Low cost; fires almost every other turn |
| Prehensile Pincer Tail | Passive melee follow-ups                |

## Synaptic Imperative Mechanic

Leviathan's passive makes it uniquely aggressive:

- Grants action points after casting powers
- Stranglethorn hits → bonus AP → more attacks
- Creates snowball effect when not controlled

## Cooldowns

| Ability                | Cooldown |
| ---------------------- | -------- |
| Stranglethorn Cannon   | ~1 turn  |
| Catalyst               | ~2 turns |
| Call Ripper Swarms 1.0 | ~2 turns |

## AI Ability Weights

| Ability            | Weight | Conditions                      |
| ------------------ | ------ | ------------------------------- |
| Synapse Overload   | 4.5    | Mass buff to all Tyranids       |
| Monstrous Rending  | 3.5    | Melee with PrehensilePincerTail |
| Psychic Blast      | 3.0    | Ranged psychic damage           |
| Coordinated Strike | 3.5    | Commands adds to focus fire     |

## Threshold Note

Leviathan essentially has **all buffs active by 100k damage**. The 270-damage first threshold means you're fighting an enhanced boss from turn 1.

## Map Notes

- **GB_02 (open midfield)**: Easier diagonal splitting
- **GB_04 (dual lanes)**: Stranglethorn lanes are obvious
- **GB_05 (offset objectives)**: Use objectives as natural squad separators

## Prime: Warrior (Leviathan)

| Attribute       | Value                                                 |
| --------------- | ----------------------------------------------------- |
| Role            | Synapse node; Catalyst target; Imperative beneficiary |
| Weakness        | Extended Synapse range                                |
| Modifier Impact | Thresholds apply to Leviathan                         |

## Add Threat Assessment

| Unit                     | Danger   | Notes                           |
| ------------------------ | -------- | ------------------------------- |
| Hormagaunt (Leviathan)   | **HIGH** | AdrenalGlands + Leviathan buffs |
| Termagant (Leviathan)    | Medium   | Buffed ranged damage            |
| Ripper Swarm (Leviathan) | Low      | Even swarms get buffed          |

## Leviathan Strain Specialty

**Synapse buff focus**: SynapticImperative makes ALL Tyranid adds stronger. Expect buffed swarms from turn 1.
