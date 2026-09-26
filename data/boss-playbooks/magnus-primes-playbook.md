# Magnus Primes - Technical Reference

## Prime Overview

| Prime               | Unit ID                                | Role            | Key Passives                      |
| ------------------- | -------------------------------------- | --------------- | --------------------------------- |
| **Sorcerer**        | GuildBoss9MiniBoss1ThousSorcerer       | Psychic buffer  | ArcaneShield, IllusionsOfTzeentch |
| **Infernal Master** | GuildBoss9MiniBoss2ThousInfernalMaster | Daemon summoner | InfernalPacts, ScreamerInvocation |

---

## Sorcerer Prime

### Quick Reference

| Attribute | Value                                      |
| --------- | ------------------------------------------ |
| Movement  | 3                                          |
| Traits    | Boss, Immune, WeaverOfFate, Flying, Psyker |
| Boards    | GB_Magnus_support_01, _02, _05, _06        |

### Abilities

| Ability                   | Effect                                                 | Trigger                      |
| ------------------------- | ------------------------------------------------------ | ---------------------------- |
| **Arcane Shield**         | Grants invulnerability saves to self and nearby allies | Activates when taking damage |
| **Illusions of Tzeentch** | Creates decoys or misdirects attacks                   | Defensive trigger            |

### Modifier Ladder (Applies to Magnus)

| % HP Lost | Modifier                   | Effect on Magnus         |
| --------- | -------------------------- | ------------------------ |
| 20%       | TreasonOfTzeentch          | Enhanced mind control    |
| 40%       | TerminatorUnitReduction    | Fewer Terminator escorts |
| 60%       | GazeOfMagnus               | Enhanced beam attack     |
| 60%       | TreasonOfTzeentch (Tier 2) | Multi-target possible    |
| 100%      | RubricMarineUnitReduction  | Fewer Rubric escorts     |

---

## Infernal Master Prime

### Quick Reference

| Attribute | Value                               |
| --------- | ----------------------------------- |
| Movement  | 3                                   |
| Traits    | Boss, Immune, WeaverOfFate, Psyker  |
| Boards    | GB_Magnus_support_01, _02, _05, _06 |

### Abilities

| Ability                 | Effect                                    | Trigger                       |
| ----------------------- | ----------------------------------------- | ----------------------------- |
| **Infernal Pacts**      | Summons Daemon reinforcements             | Periodically or when HP drops |
| **Screamer Invocation** | Calls Screamer Daemons to harass backline | Board control loss            |

### Modifier Ladder (Applies to Magnus)

| % HP Lost | Modifier                  | Effect on Magnus            |
| --------- | ------------------------- | --------------------------- |
| 20%       | BladeOfMagnus             | Enhanced melee cleave       |
| 40%       | TerminatorUnitReduction   | Fewer Terminator escorts    |
| 60%       | GazeOfMagnus              | Enhanced beam attack        |
| 80%       | BladeOfMagnus (Tier 2)    | +100% damage, cleave splash |
| 100%      | RubricMarineUnitReduction | Fewer Rubric escorts        |

---

## Threshold Ranges

**Season 1/3/4 Tier 4 (High Thresholds)**

```
Sorcerer: 120k → 600k
Infernal Master: 140k → 700k
```

**Season 4 Tier 3 (Low Thresholds)**

```
Sorcerer: 30k → 150k
Infernal Master: 35k → 175k
```

## Add Types

| Add Type       | Source                | Notes                     |
| -------------- | --------------------- | ------------------------- |
| Pink Horrors   | Infernal Master spawn | Split into Blues          |
| Blue Horrors   | Pink Horror deaths    | lower threat              |
| Screamers      | Screamer Invocation   | backline harassment       |
| Rubric Marines | NPC pools             | reduction thresholds help |
| Terminators    | NPC pools             | reduction thresholds help |

## AI Behavior Weights

### Sorcerer AI

| Action              | Weight | Conditions               |
| ------------------- | ------ | ------------------------ |
| ArcaneShield        | 4.0    | When Magnus below 50% HP |
| IllusionsOfTzeentch | 3.5    | Defensive buff priority  |
| Psychic attack      | 3.0    | When positioned          |
| Reposition          | 2.0    | When isolated            |

### Infernal Master AI

| Action                  | Weight | Conditions               |
| ----------------------- | ------ | ------------------------ |
| Infernal Pacts (summon) | 4.5    | Board control loss       |
| Screamer Invocation     | 4.0    | Backline exposed         |
| Direct attack           | 2.5    | When summons unnecessary |
