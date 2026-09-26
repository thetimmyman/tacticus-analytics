# Ghazghkull Primes - Technical Reference

## Prime Overview

| Prime                | Unit ID                       | Role            | Key Passives                        |
| -------------------- | ----------------------------- | --------------- | ----------------------------------- |
| **Big Mek**          | GuildBoss4MiniBoss1OrksBigMek | Mechanic/Buffer | KustomForceField, BossAdjutant      |
| **Beast Snagga Nob** | GuildBoss4MiniBoss2OrksNob    | Melee Bruiser   | SmashaEad, UnbridledCarnageReworked |

---

## Big Mek Prime

### Quick Reference

| Attribute | Value                              |
| --------- | ---------------------------------- |
| Movement  | 3                                  |
| Traits    | Boss, GetStuckIn, Mechanic, Immune |

### Abilities

| Ability                | Effect                                           | Trigger                |
| ---------------------- | ------------------------------------------------ | ---------------------- |
| **Kustom Force Field** | Projects a damage-reducing shield on nearby Orks | Passive aura           |
| **Boss Adjutant**      | Provides stat buffs to Ghazghkull while alive    | Passive                |
| **Mechanic**           | Can repair damaged mechanical units              | Active on nearby mechs |

### Modifier Ladder (Applies to Ghazghkull)

| % HP Lost | Modifier             | Effect on Ghazghkull   |
| --------- | -------------------- | ---------------------- |
| 20%       | ProperKilly          | Enhanced attack damage |
| 40%       | KillaKanReduction    | Fewer Killa Kan spawns |
| 60%       | DaBossIsWatchin      | Buffs all Ork attacks  |
| 80%       | ProperKilly (Tier 2) | Massive damage boost   |
| 100%      | GrotTankReduction    | Fewer Grot Tank spawns |

---

## Beast Snagga Nob Prime

### Quick Reference

| Attribute | Value                                              |
| --------- | -------------------------------------------------- |
| Movement  | 4 (Fast)                                           |
| Traits    | Boss, GetStuckIn, BeastSnagga, Unstoppable, Immune |

### Abilities

| Ability                          | Effect                                            | Trigger      |
| -------------------------------- | ------------------------------------------------- | ------------ |
| **Smasha Ead**                   | Powerful single-target melee attack that can stun | On melee hit |
| **Unbridled Carnage (Reworked)** | Gains attack bonuses after killing enemies        | On kill      |

### Modifier Ladder (Applies to Ghazghkull)

| % HP Lost | Modifier                      | Effect on Ghazghkull      |
| --------- | ----------------------------- | ------------------------- |
| 20%       | ProphetOfGorkAndMork          | Enhanced WAAAGH! ability  |
| 40%       | StormboyzReduction            | Fewer Stormboy spawns     |
| 60%       | DaBossIsWatchin               | Buffs all Ork attacks     |
| 80%       | ProphetOfGorkAndMork (Tier 2) | Extended WAAAGH! duration |
| 100%      | OrkBoyzReduction              | Fewer Ork Boy spawns      |

---

## Threshold Ranges

**High Tier (Tier 4)**

```
Big Mek: 133k → 666k
Nob: 133k → 666k
```

**Low Tier (Tier 1-2)**

```
Big Mek: 33k → 166k
Nob: 33k → 166k
```

## Add Types

| Add Type   | Source      | Notes                     |
| ---------- | ----------- | ------------------------- |
| Killa Kans | Enemy pools | Explodes, Big Mek repairs |
| Grot Tanks | Enemy pools | Ramshackle, vehicle       |
| Stormboyz  | NPC slots   | Flying, backline threats  |
| Ork Boyz   | NPC slots   | fodder                    |
| Grots      | Enemy pools | Diminutive, swarm         |

## AI Behavior Weights

### Big Mek AI

| Action                      | Weight | Conditions                     |
| --------------------------- | ------ | ------------------------------ |
| KustomForceField (maintain) | 5.0    | Always if possible             |
| BossAdjutant (buff)         | 4.0    | Ghazghkull in range            |
| Repair (Mechanic)           | 4.0    | Damaged mechanical unit nearby |
| Direct attack               | 2.5    | Default action                 |

### Beast Snagga Nob AI

| Action                   | Weight  | Conditions        |
| ------------------------ | ------- | ----------------- |
| SmashaEad (charge)       | 4.5     | Target in range   |
| UnbridledCarnageReworked | Passive | Scales with kills |
| Melee attack             | 4.0     | Adjacent targets  |
| GetStuckIn (advance)     | 3.5     | Close distance    |
