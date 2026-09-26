# Tervigon (Leviathan) - Technical Reference

## Quick Reference

| Attribute      | Value               |
| -------------- | ------------------- |
| Banned Faction | Tyranids            |
| Boss Boards    | GB_02, GB_04, GB_05 |
| Movement       | 4 + Flying          |

## Abilities

| Ability                  | Trigger Condition                 |
| ------------------------ | --------------------------------- |
| Stranglethorn Cannon     | 2+ targets aligned within 5 tiles |
| Spawn Termagants (45/60) | Free pads around Tervigon/Warrior |
| Catalyst                 | Any ally lost 15%+ HP             |
| Massive Scything Talons  | Enemies adjacent                  |
| Synaptic Backlash        | Melee Gaunt kills debuff attacker |
| Synaptic Imperative      | Passive buffs after every cast    |

## Dual Threat Mechanic

Leviathan Tervigon combines **Stranglethorn** and **Spawn** pressure:

- Block spawn pads → Spawn utility = 0
- Stay spread → Stranglethorn can't cluster-hit
- Control both to force Catalyst-only rotation

## Catalyst Weight Formula

```
Catalyst weight = min(1, 0.15 × recentDamage)
- Fires on ANY ally that lost 15%+ HP
- ~2 turn cooldown
```

## Cooldowns

| Ability              | Cooldown                               |
| -------------------- | -------------------------------------- |
| Spawn Termagants     | ~1 turn (only fires if pads available) |
| Catalyst             | ~2 turns                               |
| Stranglethorn Cannon | ~1 turn                                |

## AI Ability Weights

| Ability                 | Weight | Conditions                    |
| ----------------------- | ------ | ----------------------------- |
| Spawn Termagants        | 5.0    | Highest priority if pads open |
| Stranglethorn Cannon    | 4.0    | Ranged AoE, 5-tile range      |
| Catalyst                | 4.0    | Fires on wounded ally         |
| Massive Scything Talons | 3.5    | Melee when engaged            |

## Pad Control Reference

```
PAD BLOCKING:
- 6 hexes around Tervigon
- 6 hexes around Warrior
- Block 4-5 total to neutralize spawn bucket

STRANGLETHORN RANGE:
- Fires through 5 tiles
```

## Prime: Warrior (Leviathan)

| Attribute       | Value                                            |
| --------------- | ------------------------------------------------ |
| Role            | Secondary spawn source; Synapse; Catalyst target |
| Weakness        | Extended Synapse buffs spawns                    |
| Modifier Impact | Stat reductions if killed past thresholds        |

## Prime Threshold Effects

```
Past 360 HP lost: -15% Gaunt/Talon stats
Past 1,080 HP lost: -20% reduction
```

## Encounter Frequency

Leviathan Tervigon appears **1 time per loop** with 2 Prime fights per loop.

## Add Threat Assessment

| Unit               | Danger   | Notes                                 |
| ------------------ | -------- | ------------------------------------- |
| Termagant (buffed) | **HIGH** | SynapticImperative makes them deadly! |
| Ripper Swarm       | Low      | Even fodder gets buffed               |

## Leviathan Tervigon Specialty

**Hybrid threat**: Has Stranglethorn (like Tyrants) AND spawns. Must control BOTH diagonal spacing AND pad blocking simultaneously.
