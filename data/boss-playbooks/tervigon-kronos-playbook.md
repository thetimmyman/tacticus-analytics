# Tervigon (Kronos) - Technical Reference

## Quick Reference

| Attribute      | Value                                 |
| -------------- | ------------------------------------- |
| Banned Faction | Tyranids                              |
| Boss Boards    | GB_05, GB_06 (narrow corridors)       |
| Movement       | 4 (prefers stationary bioweapon spam) |

## Abilities

| Ability                 | Trigger Condition                       |
| ----------------------- | --------------------------------------- |
| Bio Barrage             | Passive; splashes on every cast         |
| Catalyst                | Any ally damaged; applied frequently    |
| Spawn Termagants 2      | Cooldown only ~1 turn; constant spawns  |
| Massive Scything Talons | Passive melee when adjacent             |
| Synaptic Backlash       | Killing Gaunts in melee triggers debuff |

## Corridor Maps

Kronos Tervigon boards (GB_05/06) are **narrow corridors**:

- Termagant spawns flood chokepoints
- Bio Barrage splashes in tight spaces
- Melee kills trigger Synaptic Backlash

## Cooldowns

| Ability            | Cooldown                         |
| ------------------ | -------------------------------- |
| Spawn Termagants 2 | ~1 turn (nearly constant)        |
| Catalyst           | ~2 turns                         |
| Bio Barrage        | Passive (triggers on every cast) |

## AI Ability Weights

| Ability                 | Weight | Conditions                            |
| ----------------------- | ------ | ------------------------------------- |
| Spawn Termagants        | 5.0    | Highest priority, always if pads open |
| Massive Scything Talons | 3.5    | Melee when engaged                    |
| Brood Surge             | 4.0    | Mass buff to spawned units            |
| Stinger Salvo           | 3.0    | Ranged attack                         |

## Synaptic Backlash

```
Triggers when:
- Gaunt is killed in MELEE
- Affects the attacker

Effects:
- Stun or debuff applied
- Can chain if multiple melee kills
```

## Rotation Note

**Only 3 boss encounters** in Kronos rotation. This is the shortest Tervigon cycle.

## Prime: Warrior (Kronos)

| Attribute       | Value                                               |
| --------------- | --------------------------------------------------- |
| Role            | Synapse node; Catalyst target                       |
| Weakness        | Has own spawn ring                                  |
| Modifier Impact | Applies stat reductions to Tervigon's spawns/talons |

## Add Threat Assessment

| Unit                | Danger | Notes                            |
| ------------------- | ------ | -------------------------------- |
| Termagant (spawned) | Medium | Synaptic Backlash on melee kill! |
| Ripper Swarm        | Low    | Fodder                           |

## Kronos Tervigon Specialty

**Corridor spawns**: Narrow maps make spawn control critical. Focus on chokepoint blocking.
