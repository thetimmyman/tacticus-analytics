# Tervigon (Gorgon) - Technical Reference

## Quick Reference

| Attribute      | Value               |
| -------------- | ------------------- |
| Banned Faction | Tyranids            |
| Boss Boards    | GB_03, GB_04, GB_06 |
| Movement       | 4                   |

## Abilities

| Ability                 | Trigger Condition                        |
| ----------------------- | ---------------------------------------- |
| Spawn Termagants 3      | Free pads around Tervigon/Warrior        |
| Catalyst                | Any ally has taken damage                |
| Massive Scything Talons | Enemies adjacent; enhanced by thresholds |
| Brood Progenitor        | Passive; keeps Gaunts alive              |
| Synaptic Backlash       | Melee Gaunt kills debuff attacker        |

## Pad Control Mechanic

Gorgon Tervigon's AI is **gated by spawn pads**:

- `SpawnTermagants3` only fires if pads are available
- Body-blocking pads drives spawn utility to ZERO

```
Spawn utility = (available pads) × (brood deficit)

If available pads = 0 → Spawn utility = 0
If living Gaunts = maxSummons → brood deficit = 0
```

## Cooldowns

| Ability                 | Cooldown                               |
| ----------------------- | -------------------------------------- |
| Spawn Termagants 3      | ~1 turn (only fires if pads available) |
| Catalyst                | ~2 turns                               |
| Massive Scything Talons | Passive                                |

## AI Ability Weights

| Ability                 | Weight | Conditions                    |
| ----------------------- | ------ | ----------------------------- |
| Spawn Termagants 3      | 5.0    | Highest priority if pads open |
| Catalyst                | 4.0    | Fires on wounded ally         |
| Massive Scything Talons | 3.5    | Enhanced when adjacent        |
| Stinger Salvo           | 3.0    | Ranged attack                 |

## Prime: Warrior (Gorgon)

| Attribute       | Value                                             |
| --------------- | ------------------------------------------------- |
| Role            | Secondary spawn source; Catalyst target           |
| Weakness        | Second spawn ring (6 pads)                        |
| Modifier Impact | Applies stat reductions if killed past thresholds |

## Prime Threshold Effects

```
Kill Warrior EARLY (before thresholds):
- Removes second spawn ring
- No stat reduction applied

Kill Warrior LATE (past thresholds):
- Get -15%/-20% stat reductions
- Gaunts and Talons weaker
- BUT Warrior was spawning the whole time

Leave Warrior ALIVE:
- Can body-block Warrior's pads
- Control both spawn rings
```

## Add Threat Assessment

| Unit                | Danger | Notes                            |
| ------------------- | ------ | -------------------------------- |
| Termagant (spawned) | Medium | Synaptic Backlash on melee kill! |
| Ripper Swarm        | Low    | Fodder                           |

## Gorgon Tervigon Specialty

**Dual spawn rings**: Control BOTH Tervigon and Warrior pad zones. Pad blocking is more important than raw DPS.
