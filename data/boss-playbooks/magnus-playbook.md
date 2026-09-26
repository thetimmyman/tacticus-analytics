# Magnus the Red - Technical Reference

## Quick Reference

| Attribute      | Value                                    |
| -------------- | ---------------------------------------- |
| Banned Faction | Thousand Sons                            |
| Boss Boards    | GB_Magnus_01, GB_Magnus_02, GB_Magnus_03 |
| Movement       | 5 tiles                                  |

## Abilities

| Ability              | Trigger Condition                                   |
| -------------------- | --------------------------------------------------- |
| Treason of Tzeentch  | High-value unit exposed; spikes at 120k/480k damage |
| Tzeentch's Firestorm | 3+ units clustered                                  |
| Blade of Magnus      | Adjacent enemies; enhanced at 140k/560k             |
| Gaze of Magnus       | Triggered passive                                   |
| Fire Tiles           | Persistent hazards; accelerate after turn 3         |

## Cooldowns

| Ability              | Cooldown  |
| -------------------- | --------- |
| Tzeentch's Firestorm | ~2 turns  |
| Treason of Tzeentch  | ~3 turns  |
| Blade of Magnus      | ~1 turn   |
| Gaze of Magnus       | Triggered |

## AI Ability Weights

```
Firestorm Turn 1: weight = 0.333 (1/3)
Firestorm Turn 2: weight = 0.5 (if unused)
Firestorm Turn 3+: weight = 1.0 minimum + clustering bonus

Treason base: weight = 6.28 (2π) minus movement penalty
- High weight when Magnus is already positioned
- Low weight when he needs to move first

Blade: weight = 1.0 minimum when adjacent
- Scales with multi-target opportunities
- Can exceed 5.0 in melee-heavy scenarios
```

## Prime: Sorcerer

| Attribute | Value                               |
| --------- | ----------------------------------- |
| Unit ID   | GuildBoss9MiniBoss1ThousSorcerer    |
| Boards    | GB_Magnus_support_01, _02, _05, _06 |

### Modifier Ladder (Applies to Magnus)

| % HP Lost | Modifier                   | Effect on Magnus         |
| --------- | -------------------------- | ------------------------ |
| 20%       | TreasonOfTzeentch          | Enhanced mind control    |
| 40%       | TerminatorUnitReduction    | Fewer Terminator escorts |
| 60%       | GazeOfMagnus               | Enhanced beam attack     |
| 80%       | TreasonOfTzeentch (Tier 2) | Multi-target possible    |
| 100%      | RubricMarineUnitReduction  | Fewer Rubric escorts     |

## Prime: Infernal Master

| Attribute | Value                                  |
| --------- | -------------------------------------- |
| Unit ID   | GuildBoss9MiniBoss2ThousInfernalMaster |
| Boards    | GB_Magnus_support_01, _02, _05, _06    |

### Modifier Ladder (Applies to Magnus)

| % HP Lost | Modifier                  | Effect on Magnus            |
| --------- | ------------------------- | --------------------------- |
| 20%       | BladeOfMagnus             | Enhanced melee cleave       |
| 40%       | TerminatorUnitReduction   | Fewer Terminator escorts    |
| 60%       | GazeOfMagnus              | Enhanced beam attack        |
| 80%       | BladeOfMagnus (Tier 2)    | +100% damage, cleave splash |
| 100%      | RubricMarineUnitReduction | Fewer Rubric escorts        |
